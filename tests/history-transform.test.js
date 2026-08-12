import { describe, it, expect } from 'vitest';
import { transformHistory } from '../src/history-transform.js';

const mockI18n = {
  getLocalizedState: (_entityId, state) => state,
};

const mockHassStates = {};

const entities = [{ entity: 'climate.x' }];

describe('transformHistory', () => {
  it('marks the synthetic window-start row contextOnly instead of dropping it', () => {
    // history/period backfills a row per entity at exactly `start`, carrying
    // whatever value the entity held going into the window — see
    // docs/issues/rolling-window-restart-artifact-boundary.md.
    const start = new Date('2026-08-09T15:30:00Z');
    const data = [
      [
        {
          entity_id: 'climate.x',
          state: 'cool',
          last_changed: start.toISOString(),
        },
        {
          entity_id: 'climate.x',
          state: 'unavailable',
          last_changed: '2026-08-09T15:32:14Z',
        },
        {
          entity_id: 'climate.x',
          state: 'cool',
          last_changed: '2026-08-09T15:39:41Z',
        },
      ],
    ];

    const result = transformHistory(
      { data, start },
      entities,
      mockHassStates,
      mockI18n
    );

    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ raw_state: 'cool', contextOnly: true });
    expect(result[1].contextOnly).toBeUndefined();
    expect(result[2].contextOnly).toBeUndefined();
  });

  it('does not mark a real row that merely happens to share the start time', () => {
    // Not testable in practice (HA never emits a real change at the exact
    // query boundary), but the check is by identity of timestamp, so this
    // documents the intended behaviour rather than guarding a real edge case.
    const start = new Date('2026-08-09T15:30:00Z');
    const data = [
      [
        {
          entity_id: 'climate.x',
          state: 'heat',
          last_changed: '2026-08-09T15:31:00Z',
        },
      ],
    ];

    const result = transformHistory(
      { data, start },
      entities,
      mockHassStates,
      mockI18n
    );

    expect(result).toHaveLength(1);
    expect(result[0].contextOnly).toBeUndefined();
  });

  it('skips entities that are fetched only for state_map resolution', () => {
    const start = new Date('2026-08-09T15:30:00Z');
    const data = [
      [
        {
          entity_id: 'sensor.other',
          state: '21',
          last_changed: start.toISOString(),
        },
      ],
    ];

    const result = transformHistory(
      { data, start },
      entities,
      mockHassStates,
      mockI18n
    );

    expect(result).toHaveLength(0);
  });
});
