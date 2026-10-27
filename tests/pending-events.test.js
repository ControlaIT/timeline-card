import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TranslationEngine } from '../src/translation-engine.js';
import {
  findListed,
  insertByTime,
  orderPendingEvents,
} from '../src/pending-events.js';
import { latestStateTime, windowEnd } from '../src/server-clock.js';
import {
  logbookItemKey,
  logbookKey,
  streamStartTime,
} from '../src/logbook-stream.js';

vi.mock('../src/editor/timeline-card-editor.js', () => ({}));
vi.mock('../src/timeline-card.css', () => ({ default: '' }));

let TimelineCard;

beforeAll(async () => {
  vi.stubGlobal(
    'HTMLElement',
    class {
      style = { setProperty() {}, removeProperty() {} };
    }
  );
  vi.stubGlobal('window', { customCards: [] });
  vi.stubGlobal('customElements', {
    define(name, constructor) {
      if (name === 'timeline-card') TimelineCard = constructor;
    },
  });
  await import('../src/timeline-card.js');
});

afterAll(() => vi.unstubAllGlobals());

const DOOR = 'binary_sensor.door';
const TARGET = 'sensor.target';
const BASE = Date.parse('2026-10-26T12:00:00Z');
const stamp = (offset) => new Date(BASE + offset).toISOString();
const state = (value, offset, entity_id = DOOR) => ({
  entity_id,
  state: value,
  last_changed: stamp(offset),
  last_updated: stamp(offset),
  attributes: {},
});

// A logbook.log entry as logbook/get_events and logbook/event_stream send it.
const logEntry = (offset, message = 'Checked') => ({
  entity_id: DOOR,
  name: 'Door',
  message,
  when: (BASE + offset + 0.4) / 1000,
});

// A card still waiting for its initial history: live events are buffered.
function setup(
  limit = 20,
  entity = {},
  { streamError, historyRows = [], logbookEntries = [], others = [] } = {}
) {
  const card = new TimelineCard();
  card.setConfig({
    hours: 12,
    limit,
    show_logbook_entries: true,
    entities: [{ entity: DOOR, ...entity }, ...others],
  });
  card.render = vi.fn();
  card.i18n = new TranslationEngine({ 'en-us': {} });
  const listeners = {};
  const requests = [];
  const unsubscribed = [];
  card.hassInst = {
    states: {
      [DOOR]: state('off', -1000),
      [TARGET]: state('25', -1000, TARGET),
    },
    connection: {
      subscribeEvents(callback, eventType) {
        requests.push({ type: 'subscribe_events', event_type: eventType });
        listeners[eventType] = callback;
        return Promise.resolve(() => unsubscribed.push(eventType));
      },
      subscribeMessage(callback, message) {
        requests.push(message);
        if (streamError) return Promise.reject(streamError);
        listeners[message.type] = callback;
        return Promise.resolve(() => unsubscribed.push(message.type));
      },
    },
    // What refreshInForeground() fetches: history/period and logbook/get_events.
    callApi: (method, path) => {
      requests.push({ type: 'history/period', path });
      return Promise.resolve([historyRows]);
    },
    callWS: (message) => {
      requests.push(message);
      return Promise.resolve(logbookEntries);
    },
  };
  card.startLiveEvents();

  function emit(value, offset, entityId = DOOR) {
    const old_state = card.hassInst.states[entityId];
    const new_state = state(value, offset, entityId);
    listeners.state_changed({
      data: { entity_id: entityId, old_state, new_state },
      time_fired: stamp(offset),
    });
    card.hassInst.states[entityId] = new_state;
  }

  function log(offset, message = 'Checked') {
    listeners['logbook/event_stream']({ events: [logEntry(offset, message)] });
  }

  // A raw batch, as logbook/event_stream sends it.
  function stream(events) {
    listeners['logbook/event_stream']({ events });
  }

  return { card, emit, log, stream, requests, unsubscribed };
}

describe('replaying events buffered during the initial load', () => {
  it('interleaves state changes and logbook entries by time', () => {
    const { card, emit, log } = setup();
    emit('on', 2000);
    log(1000);
    card._markHistoryReady();

    expect(card.items.map((i) => i.time.getTime() - BASE)).toEqual([
      2000, 1000,
    ]);
  });

  it("doesn't let an older logbook entry push a newer state change past the limit", () => {
    const { card, emit, log } = setup(1);
    emit('on', 2000);
    log(1000);
    card._markHistoryReady();

    expect(card.items).toHaveLength(1);
    expect(card.items[0]).toMatchObject({ raw_state: 'on' });
  });

  it('skips a logbook entry the history response already carried', () => {
    const { card, log } = setup();
    log(1000);
    // History fetched after the event fired: it brings the same entry, timed
    // from the epoch-float `when`, which can sit a fraction of a ms away.
    card.items = [
      {
        id: DOOR,
        kind: 'logbook',
        state: 'Checked',
        raw_state: null,
        time: new Date(BASE + 1000.6),
      },
    ];
    card._markHistoryReady();

    expect(card.items).toHaveLength(1);
  });

  it('skips a state change the history response already carried', () => {
    const { card, emit } = setup();
    emit('on', 1000);
    card.items = [
      { id: DOOR, raw_state: 'on', state: 'on', time: new Date(BASE + 1000) },
    ];
    card._markHistoryReady();

    expect(card.items).toHaveLength(1);
  });

  it('places a buffered event older than a history row below it', () => {
    // The logbook request failed (or ended earlier): the history carries a
    // state change at 2000 ms, the buffer a message from 1000 ms.
    const { card, log } = setup();
    log(1000);
    card.items = [
      { id: DOOR, raw_state: 'on', state: 'on', time: new Date(BASE + 2000) },
    ];
    card._markHistoryReady();

    expect(card.items.map((i) => i.time.getTime() - BASE)).toEqual([
      2000, 1000,
    ]);
  });

  it('keeps tracking a history row the replay found, so a later reference updates it', () => {
    // The history row was built before the sensor's write 3 ms later reached
    // the recorder, so it still reads 25 °C.
    const { card, emit } = setup(20, {
      state_map: { on: 'On {sensor.target} °C' },
    });
    emit('on', 0);
    emit('16', 3, TARGET);
    const historyRow = {
      id: DOOR,
      raw_state: 'on',
      state: 'On 25 °C',
      extra: '',
      time: new Date(BASE),
      entityCfg: card.entities[0],
    };
    card.items = [historyRow];
    card._markHistoryReady();

    expect(card.items).toEqual([historyRow]);
    expect(historyRow.state).toBe('On 16 °C');
  });

  it('still replays an event the history response missed', () => {
    const { card, emit, log } = setup();
    emit('on', 1000);
    log(1500);
    card.items = [
      { id: DOOR, raw_state: 'on', state: 'on', time: new Date(BASE + 1000) },
    ];
    card._markHistoryReady();

    expect(card.items.map((i) => i.kind ?? 'state')).toEqual([
      'logbook',
      'state',
    ]);
  });
});

describe('live events after the initial load', () => {
  it('keeps two identical logbook messages a millisecond apart', () => {
    const { card, log } = setup();
    card._historyReady = true;
    log(1000);
    log(1001);

    expect(card.items).toHaveLength(2);
  });
});

describe('live logbook subscription', () => {
  it('uses logbook/event_stream, not a bus subscription non-admins are denied', () => {
    const { requests } = setup();

    expect(requests).toContainEqual({
      type: 'logbook/event_stream',
      start_time: expect.any(String),
      entity_ids: [DOOR],
    });
    expect(requests).not.toContainEqual(
      expect.objectContaining({ event_type: 'logbook_entry' })
    );
  });

  it('admits only logbook.log entries for configured entities from a batch', () => {
    const { card, stream } = setup();
    card._historyReady = true;
    const when = (offset) => (BASE + offset) / 1000;
    stream([
      { entity_id: DOOR, state: 'on', when: when(1000) },
      {
        entity_id: DOOR,
        name: 'Door automation',
        message: 'triggered by state of binary_sensor.door',
        source: 'state of binary_sensor.door',
        when: when(1100),
      },
      {
        entity_id: 'light.other',
        name: 'Other',
        message: 'Hi',
        when: when(1200),
      },
      { entity_id: DOOR, name: 'Door', message: 'First', when: when(1300) },
      { entity_id: DOOR, name: 'Door', message: 'Second', when: when(1400) },
    ]);

    expect(card.items.map((i) => [i.state, i.time.getTime() - BASE])).toEqual([
      ['Second', 1400],
      ['First', 1300],
    ]);
  });

  it('drops both subscriptions when the card is unmounted', async () => {
    const { card, unsubscribed } = setup();
    card.disconnectedCallback();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(unsubscribed.sort()).toEqual([
      'logbook/event_stream',
      'state_changed',
    ]);
  });

  it('handles a rejected subscription instead of leaving it unhandled', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { card } = setup(20, {}, { streamError: new Error('Unauthorized') });

    await expect(card.logbookUnsub).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(
      'timeline-card: logbook/event_stream failed',
      expect.any(Error)
    );
    expect(() => card.disconnectedCallback()).not.toThrow();
    warn.mockRestore();
  });
});

describe('logbook stream overlap', () => {
  it('ignores entries the stream replays after a reconnect', () => {
    const { card, log } = setup();
    card._historyReady = true;
    log(1000);
    log(2000, 'Other');
    // Reconnected: same subscribe message, same start_time, same entries.
    log(1000);
    log(2000, 'Other');

    expect(card.items.map((i) => i.state)).toEqual(['Other', 'Checked']);
  });

  it('still admits a genuinely new entry with the same message', () => {
    const { card, log } = setup();
    card._historyReady = true;
    log(1000);
    log(1000);
    log(1001);

    expect(card.items).toHaveLength(2);
  });

  it('keeps two different messages within the same millisecond', () => {
    const { card, log } = setup();
    card._historyReady = true;
    log(1000, 'First');
    log(1000, 'Second');

    expect(card.items.map((i) => i.state)).toEqual(['Second', 'First']);
  });

  it('keeps entries of two entities within the same millisecond', () => {
    const { card, stream } = setup(20, {}, { others: [{ entity: TARGET }] });
    card._historyReady = true;
    stream([logEntry(1000), { ...logEntry(1000), entity_id: TARGET }]);

    expect(card.items.map((i) => i.id)).toEqual([TARGET, DOOR]);
  });

  it('admits an older entry that arrives late without having been shown', () => {
    const { card, log } = setup();
    card._historyReady = true;
    log(2000, 'Newer');
    log(1000, 'Older, delayed');

    expect(card.items.map((i) => i.state)).toEqual(['Newer', 'Older, delayed']);
  });

  it('ignores a late initial batch already brought by the history load', async () => {
    const { card, log } = setup(20, {}, { logbookEntries: [logEntry(1000)] });
    await card.refreshInForeground();
    // The subscribe's catch-up batch lands after the history load.
    log(1000);
    log(1500, 'After the load');

    expect(card.items.map((i) => i.state)).toEqual([
      'After the load',
      'Checked',
    ]);
  });

  it('keeps tracking a history logbook row the stream re-sends', async () => {
    const { card, log, emit } = setup(
      20,
      { extra_text: '{sensor.target} °C' },
      { logbookEntries: [logEntry(0)] }
    );
    log(0);
    emit('16', 3, TARGET);
    await card.refreshInForeground();

    expect(card.items).toHaveLength(1);
    expect(card.items[0].extra).toBe('16 °C');
  });

  it('starts the stream on the server clock, not a browser running ahead', () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE + 10 * 60 * 1000); // browser 10 min ahead
    try {
      const { requests } = setup();
      const stream = requests.find((r) => r.type === 'logbook/event_stream');

      // The newest last_updated HA has sent (the door's, at BASE - 1000).
      expect(stream.start_time).toBe(stamp(-1000));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('initial load window on the server clock', () => {
  it('ends at the newest last_updated when the browser runs behind', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE - 22 * 1000); // browser 22 s behind
    try {
      const { card, requests } = setup();
      await card.refreshInForeground();
      const logbook = requests.find((r) => r.type === 'logbook/get_events');
      const history = requests.find((r) => r.type === 'history/period');

      // The newest last_updated HA has sent (the door's, at BASE - 1000) is
      // also where the logbook stream starts: no gap between the two.
      expect(logbook.end_time).toBe(stamp(-1000));
      expect(history.path).toContain(`end_time=${stamp(-1000)}`);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the rows from just before an HA restart on the reload after it', async () => {
    const { card } = setup();
    const rows = [state('on', 1000), state('off', 5000)];
    const entries = [logEntry(4500, 'Before the restart')];
    // Answer like HA does: only what happened by `end_time`.
    card.hassInst.callApi = (method, path) => {
      const end = Date.parse(path.match(/end_time=([^&]+)/)[1]);
      return Promise.resolve([
        rows.filter((row) => Date.parse(row.last_changed) <= end),
      ]);
    };
    card.hassInst.callWS = (message) =>
      Promise.resolve(
        entries.filter((e) => e.when * 1000 <= Date.parse(message.end_time))
      );
    // HA came back at +24 s and re-announced every state; the browser runs
    // 22 s behind, so its "now" is still before the last rows.
    card.hassInst.states[DOOR] = state('off', 24000);
    vi.useFakeTimers();
    vi.setSystemTime(BASE + 26000 - 22000);
    try {
      await card.refreshInBackground();
    } finally {
      vi.useRealTimers();
    }

    expect(card.items.map((i) => i.state)).toEqual(
      expect.arrayContaining(['Before the restart'])
    );
    expect(card.items.map((i) => i.time.toISOString())).toEqual(
      expect.arrayContaining([stamp(5000), stamp(1000)])
    );
  });

  it('keeps the rows it has when a refresh fails while HA is down', async () => {
    const { card, log } = setup();
    card._historyReady = true;
    log(1000);
    card.hassInst.callApi = () => Promise.reject({ code: 'connection_lost' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(card.refreshInBackground()).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledWith(
        'timeline-card: refresh failed',
        expect.anything()
      );
    } finally {
      warn.mockRestore();
    }

    expect(card.items.map((i) => i.state)).toEqual(['Checked']);
  });

  it('keeps the browser clock when it runs ahead', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE + 10 * 1000);
    try {
      const { card, requests } = setup();
      await card.refreshInForeground();
      const logbook = requests.find((r) => r.type === 'logbook/get_events');

      expect(logbook.end_time).toBe(stamp(10 * 1000));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('server-clock helpers', () => {
  it('latestStateTime skips unreadable times', () => {
    expect(
      latestStateTime({
        a: { last_updated: stamp(5) },
        b: { last_updated: 'garbage' },
        c: {},
      })
    ).toBe(BASE + 5);
    expect(latestStateTime(undefined)).toBe(Number.NEGATIVE_INFINITY);
  });

  it('windowEnd takes the later of both clocks', () => {
    const states = { a: { last_updated: stamp(5) } };
    expect(windowEnd(states, BASE).toISOString()).toBe(stamp(5));
    expect(windowEnd(states, BASE + 9).toISOString()).toBe(stamp(9));
    expect(windowEnd({}, BASE).toISOString()).toBe(stamp(0));
  });
});

describe('logbook-stream helpers', () => {
  it('logbookKey identifies an entry by entity, millisecond and message', () => {
    const key = logbookKey(DOOR, BASE + 1000.4, 'Checked');
    expect(logbookKey(DOOR, BASE + 1000.9, 'Checked')).toBe(key);
    expect(logbookKey(DOOR, BASE + 1001, 'Checked')).not.toBe(key);
    expect(logbookKey(TARGET, BASE + 1000.4, 'Checked')).not.toBe(key);
    expect(logbookKey(DOOR, BASE + 1000.4, 'Other')).not.toBe(key);
  });

  it('logbookItemKey matches the key of the entry a cached row came from', () => {
    const row = { id: DOOR, state: 'Checked', time: new Date(BASE + 1000) };
    expect(logbookItemKey(row)).toBe(
      logbookKey(DOOR, BASE + 1000.4, 'Checked')
    );
  });

  it('streamStartTime falls back to the given clock without states', () => {
    expect(streamStartTime({}, BASE)).toBe(stamp(0));
    expect(streamStartTime({ a: { last_updated: 'garbage' } }, BASE)).toBe(
      stamp(0)
    );
  });
});

describe('orderPendingEvents', () => {
  it('sorts oldest first, keeping arrival order for equal times', () => {
    const events = [
      { time: 30, n: 1 },
      { time: 10, n: 2 },
      { time: 30, n: 3 },
    ];

    expect(orderPendingEvents(events).map((e) => e.n)).toEqual([2, 1, 3]);
  });

  it('puts an event with an unreadable time last', () => {
    const events = [
      { time: NaN, n: 1 },
      { time: 10, n: 2 },
    ];

    expect(orderPendingEvents(events).map((e) => e.n)).toEqual([2, 1]);
  });
});

describe('findListed', () => {
  const at = (ms) => new Date(BASE + ms);
  const stateItem = { id: DOOR, raw_state: 'on', time: at(0) };
  const logItem = { id: DOOR, kind: 'logbook', state: 'Hi', time: at(0) };

  it('returns the row that is the same event', () => {
    expect(findListed([stateItem], { ...stateItem })).toBe(stateItem);
    expect(findListed([logItem], { ...logItem, time: at(1) })).toBe(logItem);
  });

  it('tells apart a different time, value, entity or kind', () => {
    const misses = [
      { ...stateItem, time: at(2) },
      { ...stateItem, raw_state: 'off' },
      { ...stateItem, id: 'x.y' },
      { ...logItem, raw_state: 'on' },
    ];
    for (const item of misses) {
      expect(findListed([stateItem], item)).toBeUndefined();
    }
    expect(findListed([logItem], { ...logItem, state: 'Bye' })).toBeUndefined();
  });
});

describe('insertByTime', () => {
  const row = (ms, n) => ({ n, time: new Date(BASE + ms) });

  it('inserts newest first, at its place', () => {
    const items = [row(3000, 'a'), row(1000, 'b')];
    insertByTime(items, row(2000, 'new'));

    expect(items.map((i) => i.n)).toEqual(['a', 'new', 'b']);
  });

  it('goes to the top when newest and to the bottom when oldest', () => {
    const items = [row(2000, 'a')];
    insertByTime(items, row(3000, 'top'));
    insertByTime(items, row(1000, 'bottom'));

    expect(items.map((i) => i.n)).toEqual(['top', 'a', 'bottom']);
  });

  it('goes ahead of rows with the same instant', () => {
    const items = [row(2000, 'a')];
    insertByTime(items, row(2000, 'later'));

    expect(items.map((i) => i.n)).toEqual(['later', 'a']);
  });
});
