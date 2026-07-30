// ------------------------------------
// AVAILABILITY / RESTART-ARTIFACT FILTER
// ------------------------------------
// Home Assistant's own logbook never shows the state churn produced by a
// restart. Its SQL filter (components/logbook/queries/common.py) keeps a row
// only when `OLD_STATE.state_id IS NOT NULL AND States.state != OLD_STATE.state`
// — so a row with no previous state is dropped, which is exactly what a
// re-announced entity looks like after HA rebuilds its state machine.
//
// The `history/period` REST API gives us no `old_state`, so that rule can't be
// applied directly here. What a restart *does* leave in the history is a
// recognisable shape: the entity drops to `unavailable`/`unknown` while HA is
// down and then comes back reporting the value it already had.
//
//     off (10:00) → unavailable (12:00) → off (12:01)
//
// `collapse_duplicates` can never remove that trailing `off`: it collapses
// consecutive runs of one value, and the `unavailable` in the middle breaks the
// run, leaving three distinct consecutive states.

const UNAVAILABLE_STATES = new Set(['unavailable', 'unknown']);

export function isUnavailableState(rawState) {
  return UNAVAILABLE_STATES.has(rawState);
}

// Resolves the option with the usual precedence: entity → card → default (on).
export function shouldIgnoreUnavailable(cfg, globalConfig = {}) {
  return cfg?.ignore_unavailable ?? globalConfig.ignore_unavailable ?? true;
}

/**
 * Drops `unavailable`/`unknown` entries and the restart artifacts they leave
 * behind, per entity.
 *
 * Expects `items` sorted OLDEST first, so "the value this entity had before it
 * went away" is well defined.
 *
 * The de-duplication after a gap is deliberately narrow: an entry is dropped
 * only when it repeats the last shown value *and* the entity passed through an
 * unavailable/unknown gap in between. A plain repeated value with no gap is
 * left alone — that stays the job of `collapse_duplicates`.
 */
export function stripUnavailableArtifacts(items, entities, globalConfig = {}) {
  const lastShownState = {};
  const gapSinceLastShown = {};

  return items.filter((item) => {
    const cfg = entities.find((e) => e.entity === item.id);

    if (!shouldIgnoreUnavailable(cfg, globalConfig)) return true;

    if (isUnavailableState(item.raw_state)) {
      // The entity went away. Remember it, so we can recognise an unchanged
      // value coming back on the other side as a restart artifact.
      gapSinceLastShown[item.id] = true;
      return false;
    }

    const cameBackUnchanged =
      gapSinceLastShown[item.id] && lastShownState[item.id] === item.raw_state;

    gapSinceLastShown[item.id] = false;

    if (cameBackUnchanged) return false;

    lastShownState[item.id] = item.raw_state;
    return true;
  });
}

/**
 * Live-event counterpart of stripUnavailableArtifacts().
 *
 * A live `state_changed` carries `old_state`, so a restart is usually caught by
 * the `old_state === null` rule alone. But an entity that merely drops off and
 * recovers — a device losing and regaining its connection, an integration
 * reload that keeps the entity registered — produces a fully-formed
 * `off → unavailable → off` sequence where every event has a real `old_state`.
 * The return leg is a genuine state transition as far as the event stream is
 * concerned, so it needs the same gap tracking the history path does.
 *
 * Returns a stateful `keep(entityId, oldStateValue, newStateValue)` predicate.
 */
export function createUnavailableGapTracker() {
  const preGapState = {};

  return {
    keep(entityId, oldStateValue, newStateValue) {
      if (isUnavailableState(newStateValue)) {
        // Only record the value from the edge of the gap, so a run of
        // unavailable → unknown doesn't overwrite it with another gap state.
        if (!isUnavailableState(oldStateValue)) {
          preGapState[entityId] = oldStateValue;
        }
        return false;
      }

      if (entityId in preGapState) {
        const before = preGapState[entityId];
        delete preGapState[entityId];
        if (before === newStateValue) return false;
      }

      return true;
    },
  };
}
