import { describe, it, expect } from 'vitest';
import { transformHistory } from '../src/history-transform.js';
import { buildHistoryIndex } from '../src/history-index.js';

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

  describe('state_map placeholders of another entity', () => {
    const stateMapI18n = {
      getLocalizedState: (_entityId, state, cfg) =>
        cfg.state_map?.[state] ?? state,
    };
    // Sercotel 204, 22/10/2026: the target-temperature template sensor follows
    // the climate 2.4 ms later.
    const start = new Date('2026-10-22T22:00:00Z');
    const climate = 'climate.sercotel_granadasuites_204_global_climate';
    const target =
      'sensor.sercotel_granadasuites_204_climate_target_temperature';
    const roomEntities = [
      { entity: climate, state_map: { heat: `Heat - {${target}} °C` } },
    ];

    const run = (targetChangedAt) => {
      const data = [
        [
          {
            entity_id: climate,
            state: 'off',
            last_changed: start.toISOString(),
          },
          {
            entity_id: climate,
            state: 'heat',
            last_changed: '2026-10-22T22:58:16.822630Z',
          },
        ],
        [
          {
            entity_id: target,
            state: '25.0',
            last_changed: start.toISOString(),
          },
          { entity_id: target, state: '16.0', last_changed: targetChangedAt },
        ],
      ];

      const items = transformHistory(
        { data, start },
        roomEntities,
        mockHassStates,
        stateMapI18n,
        buildHistoryIndex(data)
      );
      return items.find((i) => !i.contextOnly).state;
    };

    it('takes a value the referenced entity took just after the event', () => {
      expect(run('2026-10-22T22:58:16.825013Z')).toBe('Heat - 16.0 °C');
    });

    it('ignores a change of the referenced entity well after the event', () => {
      expect(run('2026-10-22T22:58:30.000000Z')).toBe('Heat - 25.0 °C');
    });

    it("doesn't lend the next event's value to the one before it", () => {
      // Two setpoints a second apart, each followed 2 ms later by the sensor:
      // within 2 s of the first event, but past the second one.
      const data = [
        [
          {
            entity_id: climate,
            state: 'off',
            last_changed: start.toISOString(),
          },
          {
            entity_id: climate,
            state: 'heat',
            last_changed: '2026-10-22T22:58:16.000Z',
          },
          {
            entity_id: climate,
            state: 'heat',
            last_changed: '2026-10-22T22:58:17.000Z',
          },
        ],
        [
          {
            entity_id: target,
            state: '25.0',
            last_changed: start.toISOString(),
          },
          {
            entity_id: target,
            state: '16.0',
            last_changed: '2026-10-22T22:58:16.002Z',
          },
          {
            entity_id: target,
            state: '21.0',
            last_changed: '2026-10-22T22:58:17.002Z',
          },
        ],
      ];

      const items = transformHistory(
        { data, start },
        roomEntities,
        mockHassStates,
        stateMapI18n,
        buildHistoryIndex(data)
      );

      expect(items.filter((i) => !i.contextOnly).map((i) => i.state)).toEqual([
        'Heat - 16.0 °C',
        'Heat - 21.0 °C',
      ]);
    });
  });
});
