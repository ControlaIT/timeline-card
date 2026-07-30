// ------------------------------------
// POINT-IN-TIME HISTORY LOOKUP
// ------------------------------------
// Answers "what was this entity's state at 10:11?" over the history the card
// already downloaded, so a `state_map` label can reference another entity and
// still show what was true when the event happened rather than what is true now.
//
// Built from the RAW history response, before transformHistory() drops the
// synthetic row at the start of the window: that row is exactly the value an
// entity carried into the range, so for an entity that didn't change during the
// whole window it's the only value there is.

function toMillis(value) {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
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
     */
    at(entityId, time) {
      const rows = byEntity.get(entityId);
      if (!rows) return null;

      const target = toMillis(time);
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
  };
}
