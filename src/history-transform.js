import { transformState } from './state-transform.js';
import { referenceLookahead } from './history-index.js';

/**
 * Transform HA history API result into a unified flat list
 * of timeline entries.
 *
 * `index` is the point-in-time lookup over the same response (see
 * history-index.js). Each entry resolves its `state_map` placeholders against
 * the values other entities held at that entry's own timestamp, so a past event
 * reports what was true when it happened — allowing a short lookahead
 * (referenceLookahead()) for entities HA writes just after the event's own.
 *
 * `history/period` backfills a synthetic first row per entity, timestamped
 * exactly at the query's `start`, carrying whatever value the entity held going
 * into the window. It is marked `contextOnly` rather than dropped: it's never a
 * real event to render, but it's exactly "the value this entity had before the
 * window" that stripUnavailableArtifacts() (availability-filter.js) needs to
 * judge a value returning right at the window's edge — see
 * docs/issues/rolling-window-restart-artifact-boundary.md.
 */
export function transformHistory(
  historyData,
  entities,
  hassStates,
  i18n,
  index
) {
  const { data, start } = historyData;

  // Entities fetched only to be referenced by a label don't get timeline rows
  // of their own.
  const shown = new Set(entities.map((e) => e.entity));

  let flat = [];

  data.forEach((entityList) => {
    if (!Array.isArray(entityList) || entityList.length === 0) return;
    if (!shown.has(entityList[0]?.entity_id)) return;

    entityList.forEach((entry) => {
      const lookahead = index
        ? referenceLookahead(
            entry.last_changed,
            index.nextAfter(entry.entity_id, entry.last_changed)
          )
        : 0;
      const resolveEntity = index
        ? (entityId) => index.at(entityId, entry.last_changed, lookahead)
        : undefined;

      // Use unified transform for both history and live events
      const item = transformState(
        entry.entity_id,
        entry, // entry itself is a state object
        { states: hassStates },
        entities,
        i18n,
        resolveEntity
      );

      if (item) {
        if (item.time.getTime() === start.getTime()) {
          item.contextOnly = true;
        }
        flat.push(item);
      }
    });
  });

  return flat;
}
