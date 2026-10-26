import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TranslationEngine } from '../src/translation-engine.js';

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

const OWNER = 'climate.room';
const TARGET = 'sensor.target';
const HUMIDITY = 'sensor.humidity';
const stamp = (offset) =>
  new Date(Date.parse('2026-10-26T12:00:00Z') + offset).toISOString();
const state = (entity_id, value, offset, attributes = {}) => ({
  entity_id,
  state: value,
  last_changed: stamp(offset),
  last_updated: stamp(offset),
  attributes,
});

function setup(overrides = {}) {
  const card = new TimelineCard();
  card.setConfig({
    hours: 12,
    limit: 20,
    entities: [
      {
        entity: OWNER,
        state_map: { heat: 'Heat {sensor.target} °C' },
        extra_text: '{temperature} °C · {sensor.humidity}%',
        ...overrides,
      },
    ],
  });
  card.render = vi.fn();
  card.i18n = new TranslationEngine({ 'en-us': {} });
  const listeners = {};
  card.hassInst = {
    states: {
      [OWNER]: state(OWNER, 'off', -1000),
      [TARGET]: state(TARGET, '25', -1000),
      [HUMIDITY]: state(HUMIDITY, '40', -1000),
    },
    connection: {
      subscribeEvents(callback, eventType) {
        listeners[eventType] = callback;
        return Promise.resolve(() => {});
      },
    },
  };
  card._historyReady = true;
  card.startLiveEvents();

  function emit(
    entityId,
    value,
    offset,
    attributes = {},
    lastChanged = offset
  ) {
    const old_state = card.hassInst.states[entityId];
    const new_state = {
      ...state(entityId, value, offset, attributes),
      last_changed: stamp(lastChanged),
    };
    // Keep hass.states stale: the state_changed payload must be sufficient,
    // independent of the ordering of HA's separate entity subscription.
    listeners.state_changed({
      data: { entity_id: entityId, old_state, new_state },
      time_fired: stamp(offset),
    });
    card.hassInst.states[entityId] = new_state;
  }

  function log(offset, message = 'Setpoint applied') {
    listeners.logbook_entry({
      data: { entity_id: OWNER, name: 'Room', message },
      time_fired: stamp(offset),
    });
  }

  return { card, emit, log };
}

describe('live referenced values', () => {
  it('recalculates a label when a reference-only sensor follows the event', () => {
    const { card, emit } = setup();
    emit(OWNER, 'heat', 0, { temperature: 16 });
    expect(card.items[0].state).toBe('Heat 25 °C');
    emit(TARGET, '16', 3);

    expect(card.items).toHaveLength(1);
    expect(card.items[0]).toMatchObject({
      state: 'Heat 16 °C',
      extra: '16 °C · 40%',
      raw_state: 'heat',
    });
    expect(card.items[0].time.toISOString()).toBe(stamp(0));
    expect(card.render).toHaveBeenCalledTimes(2);
  });

  it('refreshes referenced attributes even when their state did not change', () => {
    const { card, emit } = setup({ extra_text: '{sensor.target.humidity}%' });
    card.hassInst.states[TARGET].attributes = { humidity: 30 };
    emit(OWNER, 'heat', 0);
    emit(TARGET, '25', 3, { humidity: 48 }, -1000);

    expect(card.items[0].extra).toBe('48%');
  });

  it('accepts the end of the margin and ignores subsequent reference changes', () => {
    const { card, emit } = setup();
    emit(OWNER, 'heat', 0);
    emit(TARGET, '16', 2000);
    expect(card.items[0].state).toBe('Heat 16 °C');
    emit(TARGET, '21', 2001);

    expect(card.items[0].state).toBe('Heat 16 °C');
  });

  it('ignores a reference update older than the row', () => {
    const { card, emit } = setup();
    emit(OWNER, 'heat', 0);
    emit(TARGET, '16', -1);

    expect(card.items[0].state).toBe('Heat 25 °C');
  });

  it('does not borrow unrelated current values when recalculating a row', () => {
    const { card, emit } = setup();
    emit(OWNER, 'heat', 0, { temperature: 16 });
    card.hassInst.states[HUMIDITY] = state(HUMIDITY, '99', 10000);
    card.hassInst.states[OWNER] = state(OWNER, 'heat', 10000, {
      temperature: 30,
    });
    emit(TARGET, '16', 3);

    expect(card.items[0]).toMatchObject({
      state: 'Heat 16 °C',
      extra: '16 °C · 40%',
    });
  });

  it('closes the previous row at the next state event, even if it is filtered', () => {
    const { card, emit } = setup({ include_states: ['heat'] });
    emit(OWNER, 'heat', 0);
    emit(TARGET, '16', 3);
    emit(OWNER, 'off', 1000);
    emit(TARGET, '21', 1003);

    expect(card.items).toHaveLength(1);
    expect(card.items[0].state).toBe('Heat 16 °C');
  });

  it('keeps the window open across owner attribute updates that create no row', () => {
    const { card, emit } = setup();
    emit(OWNER, 'heat', 0, { temperature: 16 });
    emit(OWNER, 'heat', 1, { temperature: 21 }, 0);
    emit(TARGET, '16', 3);

    expect(card.items).toHaveLength(1);
    expect(card.items[0]).toMatchObject({
      state: 'Heat 16 °C',
      extra: '16 °C · 40%',
    });
  });

  it('closes a state row at the next logbook entry and updates only its extra text', () => {
    const { card, emit, log } = setup({
      show_logbook_entries: true,
      extra_text: '{sensor.target} °C',
    });
    emit(OWNER, 'heat', 0);
    emit(TARGET, '16', 3);
    log(1000);
    emit(TARGET, '21', 1003);

    expect(card.items[0]).toMatchObject({
      kind: 'logbook',
      state: 'Setpoint applied',
      raw_state: null,
      extra: '21 °C',
    });
    expect(card.items[1]).toMatchObject({
      state: 'Heat 16 °C',
      extra: '16 °C',
    });
  });

  it('closes a logbook row at the next state event', () => {
    const { card, emit, log } = setup({
      show_logbook_entries: true,
      extra_text: '{sensor.target} °C',
    });
    log(0);
    emit(TARGET, '16', 3);
    emit(OWNER, 'heat', 1000);
    emit(TARGET, '21', 1003);

    expect(card.items[0].extra).toBe('21 °C');
    expect(card.items[1].extra).toBe('16 °C');
  });

  it('does not overwrite history rows or revive rows removed by a refresh', () => {
    const { card, emit } = setup();
    emit(OWNER, 'heat', 0);
    const historyItem = { ...card.items[0] };
    card.items = [historyItem];
    emit(TARGET, '16', 3);

    expect(card.items).toEqual([historyItem]);
    expect(historyItem.state).toBe('Heat 25 °C');
  });

  it('replays reference-only events buffered during the initial load', () => {
    const { card, emit } = setup();
    card._historyReady = false;
    emit(OWNER, 'heat', 0);
    emit(TARGET, '16', 3);
    emit(TARGET, '21', 5000);
    card._markHistoryReady();

    expect(card.items).toHaveLength(1);
    expect(card.items[0].state).toBe('Heat 16 °C');
  });

  it('stops tracking references when disconnected', () => {
    const { card, emit } = setup();
    emit(OWNER, 'heat', 0);
    card.disconnectedCallback();
    emit(TARGET, '16', 3);

    expect(card.items[0].state).toBe('Heat 25 °C');
  });
});
