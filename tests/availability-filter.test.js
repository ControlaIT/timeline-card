import { describe, it, expect } from 'vitest';
import {
  createUnavailableGapTracker,
  isUnavailableState,
  shouldIgnoreUnavailable,
  stripUnavailableArtifacts,
} from '../src/availability-filter.js';
import { filterHistory } from '../src/history-filter.js';

// All fixtures are OLDEST first, which is what stripUnavailableArtifacts()
// expects (filterHistory sorts that way before calling it).
const restartBurst = [
  { id: 'binary_sensor.door', raw_state: 'off', time: 1000 },
  { id: 'binary_sensor.door', raw_state: 'unavailable', time: 2000 },
  { id: 'binary_sensor.door', raw_state: 'off', time: 2100 },
];

describe('isUnavailableState', () => {
  it('matches unavailable and unknown only', () => {
    expect(isUnavailableState('unavailable')).toBe(true);
    expect(isUnavailableState('unknown')).toBe(true);
    expect(isUnavailableState('off')).toBe(false);
    expect(isUnavailableState(undefined)).toBe(false);
  });
});

describe('shouldIgnoreUnavailable', () => {
  it('defaults to enabled', () => {
    expect(shouldIgnoreUnavailable(undefined, {})).toBe(true);
  });

  it('lets the card config turn it off', () => {
    expect(
      shouldIgnoreUnavailable(undefined, { ignore_unavailable: false })
    ).toBe(false);
  });

  it('lets an entity override the card config in both directions', () => {
    expect(
      shouldIgnoreUnavailable(
        { ignore_unavailable: false },
        { ignore_unavailable: true }
      )
    ).toBe(false);
    expect(
      shouldIgnoreUnavailable(
        { ignore_unavailable: true },
        { ignore_unavailable: false }
      )
    ).toBe(true);
  });
});

describe('stripUnavailableArtifacts', () => {
  it('drops the unavailable gap and the unchanged value that comes back after it', () => {
    const result = stripUnavailableArtifacts(restartBurst, []);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ raw_state: 'off', time: 1000 });
  });

  it('keeps a real change that happened while the entity was away', () => {
    const items = [
      { id: 'binary_sensor.door', raw_state: 'on', time: 1000 },
      { id: 'binary_sensor.door', raw_state: 'unavailable', time: 2000 },
      { id: 'binary_sensor.door', raw_state: 'off', time: 2100 },
    ];

    const result = stripUnavailableArtifacts(items, []);

    expect(result.map((r) => r.raw_state)).toEqual(['on', 'off']);
  });

  it('keeps the first real value when the window opens on an unavailable entity', () => {
    const items = [
      { id: 'binary_sensor.door', raw_state: 'unknown', time: 1000 },
      { id: 'binary_sensor.door', raw_state: 'off', time: 1100 },
    ];

    expect(stripUnavailableArtifacts(items, [])).toHaveLength(1);
    expect(stripUnavailableArtifacts(items, [])[0].raw_state).toBe('off');
  });

  it('collapses a run of several unavailable rows into one gap', () => {
    const items = [
      { id: 'binary_sensor.door', raw_state: 'off', time: 1000 },
      { id: 'binary_sensor.door', raw_state: 'unavailable', time: 2000 },
      { id: 'binary_sensor.door', raw_state: 'unknown', time: 2050 },
      { id: 'binary_sensor.door', raw_state: 'off', time: 2100 },
    ];

    expect(stripUnavailableArtifacts(items, [])).toHaveLength(1);
  });

  it('tracks the gap per entity, so one restart does not swallow another entity', () => {
    const items = [
      { id: 'binary_sensor.a', raw_state: 'off', time: 1000 },
      { id: 'binary_sensor.b', raw_state: 'on', time: 1010 },
      { id: 'binary_sensor.a', raw_state: 'unavailable', time: 2000 },
      { id: 'binary_sensor.a', raw_state: 'off', time: 2100 },
      { id: 'binary_sensor.b', raw_state: 'off', time: 2200 },
    ];

    const result = stripUnavailableArtifacts(items, []);

    // a's restart artifact is gone; b never went unavailable, so its genuine
    // on → off change survives.
    expect(result.map((r) => `${r.id}:${r.raw_state}`)).toEqual([
      'binary_sensor.a:off',
      'binary_sensor.b:on',
      'binary_sensor.b:off',
    ]);
  });

  it('does NOT collapse a repeated value when no gap separates it', () => {
    // This filter only undoes artifacts introduced by an unavailable/unknown
    // gap. Repeats with no gap are dropped one layer later, by the
    // logbook-parity rule in collapseDuplicates() — see the filterHistory
    // tests in history-filter.test.js.
    const items = [
      { id: 'binary_sensor.door', raw_state: 'off', time: 1000 },
      { id: 'binary_sensor.door', raw_state: 'off', time: 1100 },
    ];

    expect(stripUnavailableArtifacts(items, [])).toHaveLength(2);
  });

  it('passes everything through when disabled on the card', () => {
    const result = stripUnavailableArtifacts(restartBurst, [], {
      ignore_unavailable: false,
    });

    expect(result).toHaveLength(3);
  });

  it('passes everything through for an entity that opts out', () => {
    const entities = [
      { entity: 'binary_sensor.door', ignore_unavailable: false },
    ];

    expect(stripUnavailableArtifacts(restartBurst, entities)).toHaveLength(3);
  });

  it('a contextOnly row seeds lastShownState but is never emitted itself', () => {
    // Regression for the rolling-window boundary bug: the window opens with
    // the entity already in a gap, so the only clue that 15:39 is a flicker
    // (not a real change) is the value the entity carried into the window —
    // exactly what history-transform.js marks contextOnly.
    const items = [
      { id: 'climate.x', raw_state: 'cool', time: 500, contextOnly: true },
      { id: 'climate.x', raw_state: 'unavailable', time: 1000 },
      { id: 'climate.x', raw_state: 'cool', time: 2000 },
    ];

    expect(stripUnavailableArtifacts(items, [])).toHaveLength(0);
  });

  it('a contextOnly row does not suppress a real change across the gap', () => {
    const items = [
      { id: 'climate.x', raw_state: 'cool', time: 500, contextOnly: true },
      { id: 'climate.x', raw_state: 'unavailable', time: 1000 },
      { id: 'climate.x', raw_state: 'heat', time: 2000 },
    ];

    const result = stripUnavailableArtifacts(items, []);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ raw_state: 'heat', time: 2000 });
  });

  it('never emits the contextOnly row even with ignore_unavailable off', () => {
    const items = [
      { id: 'climate.x', raw_state: 'cool', time: 500, contextOnly: true },
      { id: 'climate.x', raw_state: 'heat', time: 2000 },
    ];

    const result = stripUnavailableArtifacts(items, [], {
      ignore_unavailable: false,
    });

    expect(result.map((r) => r.time)).toEqual([2000]);
  });
});

describe('createUnavailableGapTracker', () => {
  it('drops the unavailable event and the unchanged value that returns after it', () => {
    const t = createUnavailableGapTracker();

    expect(t.keep('binary_sensor.door', 'off', 'unavailable')).toBe(false);
    expect(t.keep('binary_sensor.door', 'unavailable', 'off')).toBe(false);
  });

  it('keeps a value that genuinely changed across the gap', () => {
    const t = createUnavailableGapTracker();

    expect(t.keep('binary_sensor.door', 'on', 'unavailable')).toBe(false);
    expect(t.keep('binary_sensor.door', 'unavailable', 'off')).toBe(true);
  });

  it('does not let a run of gap states overwrite the pre-gap value', () => {
    const t = createUnavailableGapTracker();

    t.keep('binary_sensor.door', 'off', 'unavailable');
    t.keep('binary_sensor.door', 'unavailable', 'unknown');

    // Still compared against `off`, not against `unavailable`.
    expect(t.keep('binary_sensor.door', 'unknown', 'off')).toBe(false);
  });

  it('clears the gap after the first event back, so later repeats are kept', () => {
    const t = createUnavailableGapTracker();

    t.keep('binary_sensor.door', 'off', 'unavailable');
    expect(t.keep('binary_sensor.door', 'unavailable', 'off')).toBe(false);
    // A genuine off → on → off later on is unaffected.
    expect(t.keep('binary_sensor.door', 'off', 'on')).toBe(true);
    expect(t.keep('binary_sensor.door', 'on', 'off')).toBe(true);
  });

  it('tracks gaps per entity', () => {
    const t = createUnavailableGapTracker();

    t.keep('binary_sensor.a', 'off', 'unavailable');

    // b never went through a gap, so its change is untouched.
    expect(t.keep('binary_sensor.b', 'on', 'off')).toBe(true);
    expect(t.keep('binary_sensor.a', 'unavailable', 'off')).toBe(false);
  });

  it('keeps ordinary transitions when no gap ever happened', () => {
    const t = createUnavailableGapTracker();

    expect(t.keep('binary_sensor.door', 'off', 'on')).toBe(true);
  });
});

describe('filterHistory + restart artifacts', () => {
  it('hides the restart burst by default, with no options set', () => {
    const result = filterHistory(restartBurst, [], 100, {});

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ raw_state: 'off', time: 1000 });
  });

  it('regression: collapse_duplicates alone could not remove the burst', () => {
    // The `unavailable` in the middle breaks the consecutive run, so the
    // duplicate collapser never sees two adjacent `off` entries.
    const entities = [
      { entity: 'binary_sensor.door', ignore_unavailable: false },
    ];

    const result = filterHistory(restartBurst, entities, 100, {
      collapse_duplicates: true,
    });

    expect(result).toHaveLength(3);
  });

  it('still collapses genuine duplicates when both options are on', () => {
    const items = [
      { id: 'binary_sensor.door', raw_state: 'off', time: 1000 },
      { id: 'binary_sensor.door', raw_state: 'off', time: 1100 },
      { id: 'binary_sensor.door', raw_state: 'unavailable', time: 2000 },
      { id: 'binary_sensor.door', raw_state: 'off', time: 2100 },
    ];

    const result = filterHistory(items, [], 100, {
      collapse_duplicates: true,
    });

    expect(result).toHaveLength(1);
    expect(result[0].time).toBe(1000);
  });

  it('regression: a flicker landing right on the window edge is still hidden', () => {
    // docs/issues/rolling-window-restart-artifact-boundary.md — the window's
    // start falls between the pre-gap value and the `unavailable`, so the
    // pre-gap `cool` itself is out of range. Only the contextOnly row (what
    // history-transform.js backfills from history/period's synthetic start
    // row) lets the filter recognise the 2000 `cool` as the same flicker it
    // would catch with a wider window.
    const items = [
      {
        id: 'climate.ona_alanda_108_global_climate',
        raw_state: 'cool',
        time: 500,
        contextOnly: true,
      },
      {
        id: 'climate.ona_alanda_108_global_climate',
        raw_state: 'unavailable',
        time: 1000,
      },
      {
        id: 'climate.ona_alanda_108_global_climate',
        raw_state: 'cool',
        time: 2000,
      },
    ];

    const result = filterHistory(items, [], 100, {});

    expect(result).toHaveLength(0);
  });

  it('keeps a logbook entry sitting inside a restart artifact sequence', () => {
    const items = [
      { id: 'binary_sensor.door', raw_state: 'off', time: 1000 },
      { id: 'binary_sensor.door', raw_state: 'unavailable', time: 2000 },
      {
        id: 'binary_sensor.door',
        raw_state: null,
        state: 'HA volvió',
        time: 2050,
        kind: 'logbook',
      },
      { id: 'binary_sensor.door', raw_state: 'off', time: 2100 },
    ];

    const result = filterHistory(items, [], 100, {});

    // The `unavailable` row and the unchanged `off` coming back are stripped as
    // restart noise; the message recorded in between is not state churn and
    // stays.
    expect(result.map((i) => i.time)).toEqual([2050, 1000]);
  });
});
