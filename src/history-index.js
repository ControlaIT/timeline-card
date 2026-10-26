// ------------------------------------
// POINT-IN-TIME HISTORY LOOKUP
// ------------------------------------
// Answers "what was this entity's state at 10:11?" over the history the card
// already downloaded, so a `state_map` label can reference another entity and
// still show what was true when the event happened rather than what is true now.
//
// Built from the RAW history response, ahead of the synthetic row at the start
// of the window that transformHistory() marks `contextOnly` (never rendered):
// that row is exactly the value an entity carried into the range, so for an
// entity that didn't change during the whole window it's the only value there
// is.

// How long after an event a referenced entity may still change and count as
// the value at that event. A template sensor derived from the event's own
// entity is written a few milliseconds after it (Sercotel 204: 2.4 ms); 2 s
// covers that without reaching unrelated changes.
export const REFERENCE_LOOKAHEAD_MS = 2000;

function toMillis(value) {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

/**
 * How far past an event at `time` a referenced value may still be taken: up to
 * REFERENCE_LOOKAHEAD_MS, but short of `nextEventTime` (the same entity's next
 * row, if any) — a change from there on belongs to that next event. Without
 * the cap, two events a second apart would both show the second one's value.
 */
export function referenceLookahead(time, nextEventTime) {
  if (nextEventTime == null) return REFERENCE_LOOKAHEAD_MS;

  const gap = toMillis(nextEventTime) - toMillis(time) - 1;
  if (!Number.isFinite(gap)) return REFERENCE_LOOKAHEAD_MS;

  return Math.min(REFERENCE_LOOKAHEAD_MS, Math.max(0, gap));
}

/**
 * @param {Array<Array<object>>} seriesList history/period's response: one array
 *   of state rows per entity.
 */
export function buildHistoryIndex(seriesList = []) {
  const byEntity = new Map();

  for (const series of seriesList) {
    if (!Array.isArray(series) || series.length === 0) continue;

    const entityId = series[0]?.entity_id;
    if (!entityId) continue;

    const rows = series
      .map((row) => ({ at: toMillis(row.last_changed), row }))
      .filter((entry) => Number.isFinite(entry.at))
      .sort((a, b) => a.at - b.at);

    if (rows.length) byEntity.set(entityId, rows);
  }

  return {
    /**
     * The last state at or before `time`, or null when the entity has no
     * history in the window or its first row is still in the future — better
     * nothing than a value the entity hadn't taken yet.
     *
     * `lookaheadMs` also accepts a value taken up to that long AFTER `time`.
     * Entities derived from the event's own entity (a template sensor over a
     * climate's `temperature`) are written a few milliseconds after it, so at
     * the event's exact timestamp they still hold the previous value.
     */
    at(entityId, time, lookaheadMs = 0) {
      const rows = byEntity.get(entityId);
      if (!rows) return null;

      const target = toMillis(time) + Math.max(0, lookaheadMs);
      if (!Number.isFinite(target)) return null;

      let low = 0;
      let high = rows.length - 1;
      let found = -1;

      while (low <= high) {
        const mid = (low + high) >> 1;
        if (rows[mid].at <= target) {
          found = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }

      return found === -1 ? null : rows[found].row;
    },

    /**
     * Timestamp (ms) of the entity's first row strictly after `time`, or null
     * when there is none — the bound for referenceLookahead().
     */
    nextAfter(entityId, time) {
      const rows = byEntity.get(entityId);
      if (!rows) return null;

      const target = toMillis(time);
      if (!Number.isFinite(target)) return null;

      let low = 0;
      let high = rows.length - 1;
      let found = -1;

      while (low <= high) {
        const mid = (low + high) >> 1;
        if (rows[mid].at > target) {
          found = mid;
          high = mid - 1;
        } else {
          low = mid + 1;
        }
      }

      return found === -1 ? null : rows[found].at;
    },
  };
}
