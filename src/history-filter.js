import {
  shouldIgnoreUnavailable,
  stripUnavailableArtifacts,
} from './availability-filter.js';

// ------------------------------------
// NEW: Collapse consecutive duplicates
// ------------------------------------
function collapseDuplicates(list, entities, globalConfig) {
  const collapsed = [];
  const lastStates = {};
  const latestCandidates = {};

  for (const item of list) {
    // Logbook entries all share `raw_state: null`, so any run of them would
    // read as one repeated value and collapse into a single row — losing every
    // message but the first. They aren't duplicates: two `logbook.log` calls
    // are two distinct events even when the text matches.
    if (item.kind === 'logbook') {
      collapsed.push(item);
      continue;
    }

    const cfg = entities.find((e) => e.entity === item.id) || {};

    // Entity → YAML → fallback to global
    const collapse =
      cfg.collapse_duplicates ?? globalConfig.collapse_duplicates ?? false;

    if (!collapse) {
      // Logbook parity, second half of the rule quoted in availability-filter.js:
      // `States.state != OLD_STATE.state`. A row repeating the previous value of
      // the same entity is not a state change, whatever produced it — and on
      // every restart the recorder writes exactly such a row for each entity as
      // HA rebuilds its state machine. With no `unavailable` row in between (a
      // clean shutdown records none for entities that don't publish
      // availability) stripUnavailableArtifacts() can't see it, and it surfaces
      // as a phantom event: "Door: closed" for a door that never opened.
      //
      // processLiveEvent() already drops the live equivalent unconditionally, so
      // history has to match. This is not the same thing as collapse_duplicates
      // — that one is a display preference about runs of real events, which is
      // why it stays opt-in — so this is gated on the restart-artifact switch
      // instead, and `ignore_unavailable: false` still restores the raw feed.
      if (
        shouldIgnoreUnavailable(cfg, globalConfig) &&
        lastStates[item.id] === item.raw_state
      ) {
        continue;
      }

      lastStates[item.id] = item.raw_state;
      collapsed.push(item);
      continue;
    }

    const keepMode =
      cfg.collapse_duplicates_keep ??
      globalConfig.collapse_duplicates_keep ??
      'earliest';

    const lastState = lastStates[item.id];

    if (keepMode === 'latest') {
      if (item.raw_state !== lastState) {
        // State changed: flush the previous run's latest candidate
        if (latestCandidates[item.id] !== undefined) {
          collapsed.push(latestCandidates[item.id]);
        }
        lastStates[item.id] = item.raw_state;
      }
      // Always track the most recent item as the candidate for this run
      latestCandidates[item.id] = item;
    } else {
      // 'earliest' mode: keep the first item in each consecutive run
      if (item.raw_state !== lastState) {
        collapsed.push(item);
        lastStates[item.id] = item.raw_state;
      }
    }
  }

  // Flush any remaining 'latest' candidates (last run of each entity)
  for (const candidate of Object.values(latestCandidates)) {
    collapsed.push(candidate);
  }

  // Re-sort after inserting flushed candidates (they may be out of order)
  collapsed.sort((a, b) => a.time - b.time);

  return collapsed;
}

export function passesValueFilter(raw_state, cfg) {
  const hasMin = cfg?.min_value != null;
  const hasMax = cfg?.max_value != null;
  if (!hasMin && !hasMax) return true;
  const num = parseFloat(raw_state);
  if (isNaN(num)) return false;
  if (hasMin && num < cfg.min_value) return false;
  if (hasMax && num > cfg.max_value) return false;
  return true;
}

export function filterHistory(items, entities, limit, globalConfig = {}) {
  // `include_states` / `exclude_states` / `min_value` / `max_value` all select
  // on the state a row reports. A logbook entry reports none, so there is
  // nothing for them to match — and left to run, `include_states` would reject
  // every one of them (`include.includes(null)` is false) while `min_value`
  // would too (`parseFloat(null)` is NaN). Filtering by state is a statement
  // about state rows; these pass through it.
  let filtered = items.filter((ev) => {
    if (ev.kind === 'logbook') return true;

    const cfg = entities.find((e) => e.entity === ev.id);
    const include = Array.isArray(cfg?.include_states)
      ? cfg.include_states
      : null;
    const exclude = Array.isArray(cfg?.exclude_states)
      ? cfg.exclude_states
      : null;

    if (include) return include.includes(ev.raw_state);
    if (exclude) return !exclude.includes(ev.raw_state);
    return true;
  });

  // Value-based filter (min_value / max_value)
  filtered = filtered.filter((ev) => {
    if (ev.kind === 'logbook') return true;
    const cfg = entities.find((e) => e.entity === ev.id);
    return passesValueFilter(ev.raw_state, cfg);
  });

  // Sort (OLDEST first) to keep the earliest event when collapsing
  filtered = filtered.sort((a, b) => a.time - b.time);

  // Drop unavailable/unknown entries and the restart artifacts they leave
  // behind. Must run on the oldest-first list and before collapseDuplicates,
  // which cannot see through the gap an `unavailable` opens in a run.
  filtered = stripUnavailableArtifacts(filtered, entities, globalConfig);

  // NEW: collapse duplicates
  filtered = collapseDuplicates(filtered, entities, globalConfig);

  // Sort back to NEWEST first for display
  filtered = filtered.reverse();

  // Apply limit
  return filtered.slice(0, limit);
}
