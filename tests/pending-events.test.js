import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TranslationEngine } from '../src/translation-engine.js';
import {
  findListed,
  insertByTime,
  orderPendingEvents,
} from '../src/pending-events.js';

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

// A card still waiting for its initial history: live events are buffered.
function setup(limit = 20, entity = {}) {
  const card = new TimelineCard();
  card.setConfig({
    hours: 12,
    limit,
    show_logbook_entries: true,
    entities: [{ entity: DOOR, ...entity }],
  });
  card.render = vi.fn();
  card.i18n = new TranslationEngine({ 'en-us': {} });
  const listeners = {};
  card.hassInst = {
    states: {
      [DOOR]: state('off', -1000),
      [TARGET]: state('25', -1000, TARGET),
    },
    connection: {
      subscribeEvents(callback, eventType) {
        listeners[eventType] = callback;
        return Promise.resolve(() => {});
      },
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
    listeners.logbook_entry({
      data: { entity_id: DOOR, name: 'Door', message },
      time_fired: stamp(offset),
    });
  }

  return { card, emit, log };
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
