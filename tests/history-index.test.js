import { describe, it, expect } from 'vitest';
import { buildHistoryIndex } from '../src/history-index.js';

const row = (entity_id, state, last_changed) => ({
  entity_id,
  state,
  last_changed,
  attributes: { humidity: state },
});

const series = [
  [
    row('sensor.temp', '19', '2026-07-30T09:00:00Z'),
    row('sensor.temp', '21', '2026-07-30T10:00:00Z'),
    row('sensor.temp', '24', '2026-07-30T11:00:00Z'),
  ],
  [row('sensor.other', 'x', '2026-07-30T09:30:00Z')],
];

const at = (iso) => new Date(iso);

describe('buildHistoryIndex', () => {
  it('returns the value in force at that moment, not the latest one', () => {
    const index = buildHistoryIndex(series);

    expect(index.at('sensor.temp', at('2026-07-30T10:30:00Z')).state).toBe(
      '21'
    );
  });

  it('returns the row exactly on its own timestamp', () => {
    const index = buildHistoryIndex(series);

    expect(index.at('sensor.temp', at('2026-07-30T10:00:00Z')).state).toBe(
      '21'
    );
  });

  it('returns the last known value for a time after every row', () => {
    const index = buildHistoryIndex(series);

    expect(index.at('sensor.temp', at('2026-07-30T23:00:00Z')).state).toBe(
      '24'
    );
  });

  it('returns null before the entity has any value', () => {
    const index = buildHistoryIndex(series);

    expect(index.at('sensor.temp', at('2026-07-30T08:00:00Z'))).toBeNull();
  });

  it('returns null for an entity it has no history for', () => {
    const index = buildHistoryIndex(series);

    expect(index.at('sensor.missing', at('2026-07-30T10:00:00Z'))).toBeNull();
  });

  it('keeps series independent', () => {
    const index = buildHistoryIndex(series);

    expect(index.at('sensor.other', at('2026-07-30T23:00:00Z')).state).toBe(
      'x'
    );
  });

  it('exposes the whole row, so attributes are reachable', () => {
    const index = buildHistoryIndex(series);

    expect(
      index.at('sensor.temp', at('2026-07-30T10:30:00Z')).attributes
    ).toEqual({ humidity: '21' });
  });

  it('sorts rows that arrive out of order', () => {
    const index = buildHistoryIndex([
      [
        row('sensor.t', 'late', '2026-07-30T12:00:00Z'),
        row('sensor.t', 'early', '2026-07-30T08:00:00Z'),
      ],
    ]);

    expect(index.at('sensor.t', at('2026-07-30T09:00:00Z')).state).toBe(
      'early'
    );
  });

  it('accepts a timestamp as well as a Date', () => {
    const index = buildHistoryIndex(series);

    expect(
      index.at('sensor.temp', at('2026-07-30T10:30:00Z').getTime()).state
    ).toBe('21');
  });

  it('survives empty, malformed and undated input', () => {
    expect(buildHistoryIndex().at('a.b', Date.now())).toBeNull();
    expect(buildHistoryIndex([]).at('a.b', Date.now())).toBeNull();
    expect(buildHistoryIndex([[], null]).at('a.b', Date.now())).toBeNull();

    const undated = buildHistoryIndex([[row('sensor.t', 'v', 'not-a-date')]]);
    expect(undated.at('sensor.t', Date.now())).toBeNull();
  });

  it('returns null for an invalid lookup time', () => {
    const index = buildHistoryIndex(series);

    expect(index.at('sensor.temp', new Date('nonsense'))).toBeNull();
  });
});
