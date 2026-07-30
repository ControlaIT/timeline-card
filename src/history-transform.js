import { transformState } from './state-transform.js';

/**
 * Transform HA history API result into a unified flat list
 * of timeline entries.
 *
 * `index` is the point-in-time lookup over the same response (see
 * history-index.js). Each entry resolves its `state_map` placeholders against
 * the values other entities held at that entry's own timestamp, so a past event
 * reports what was true when it happened.
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
      const resolveEntity = index
        ? (entityId) => index.at(entityId, entry.last_changed)
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
        flat.push(item);
      }
    });
  });

  // Remove synthetic "range start"
  return flat.filter((e) => e.time.getTime() !== start.getTime());
}
