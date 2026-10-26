import { describe, it, expect } from 'vitest';
import {
  buildHistoryIndex,
  referenceLookahead,
  REFERENCE_LOOKAHEAD_MS,
} from '../src/history-index.js';

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

  describe('lookahead', () => {
    // Sercotel 204: the template sensor follows the climate 2.4 ms later.
    const derived = [
      [
        row('sensor.target', '25.0', '2026-10-22T22:00:00.000Z'),
        row('sensor.target', '16.0', '2026-10-22T22:58:16.825Z'),
        row('sensor.target', '21.0', '2026-10-22T23:10:00.000Z'),
      ],
    ];
    const event = at('2026-10-22T22:58:16.822Z');

    it('without it, misses a change made just after the time', () => {
      const index = buildHistoryIndex(derived);

      expect(index.at('sensor.target', event).state).toBe('25.0');
    });

    it('takes a change made within the margin after the time', () => {
      const index = buildHistoryIndex(derived);

      expect(index.at('sensor.target', event, 2000).state).toBe('16.0');
    });

    it('ignores a change made beyond the margin', () => {
      const index = buildHistoryIndex(derived);

      expect(
        index.at('sensor.target', at('2026-10-22T23:09:00.000Z'), 2000).state
      ).toBe('16.0');
    });

    it('returns a first row that falls inside the margin', () => {
      const index = buildHistoryIndex(derived);

      expect(
        index.at('sensor.target', at('2026-10-22T21:59:59.000Z'), 2000).state
      ).toBe('25.0');
    });

    it('treats a negative margin as none', () => {
      const index = buildHistoryIndex(derived);

      expect(index.at('sensor.target', event, -5000).state).toBe('25.0');
    });
  });

  describe('nextAfter', () => {
    it('returns the first row strictly after the time', () => {
      const index = buildHistoryIndex(series);

      expect(index.nextAfter('sensor.temp', at('2026-07-30T10:00:00Z'))).toBe(
        at('2026-07-30T11:00:00Z').getTime()
      );
    });

    it('returns null after the last row, for an unknown entity or a bad time', () => {
      const index = buildHistoryIndex(series);

      expect(
        index.nextAfter('sensor.temp', at('2026-07-30T11:00:00Z'))
      ).toBeNull();
      expect(
        index.nextAfter('sensor.missing', at('2026-07-30T10:00:00Z'))
      ).toBeNull();
      expect(index.nextAfter('sensor.temp', new Date('nonsense'))).toBeNull();
    });
  });
});

describe('referenceLookahead', () => {
  const t = at('2026-10-22T22:58:16.000Z');

  it('allows the full margin when nothing follows', () => {
    expect(referenceLookahead(t, null)).toBe(REFERENCE_LOOKAHEAD_MS);
  });

  it('stops short of the next event', () => {
    expect(referenceLookahead(t, t.getTime() + 1000)).toBe(999);
  });

  it('keeps the full margin when the next event is further away', () => {
    expect(referenceLookahead(t, t.getTime() + 60000)).toBe(
      REFERENCE_LOOKAHEAD_MS
    );
  });

  it('allows nothing when the next event shares the millisecond', () => {
    expect(referenceLookahead(t, t.getTime())).toBe(0);
  });
});
