/**
 * @param {string[]} extraEntityIds entities referenced by `state_map` labels but
 *   not shown themselves. Fetched in the same request so their values can be
 *   resolved at each event's point in time; transformHistory() skips them when
 *   building the timeline.
 */
export async function fetchHistory(hass, entities, hours, extraEntityIds = []) {
  const end = new Date();
  const start = new Date(end.getTime() - hours * 60 * 60 * 1000);

  const startTime = start.toISOString();
  const endTime = end.toISOString();

  const ids = new Set(entities.map((e) => e.entity));
  for (const id of extraEntityIds) ids.add(id);
  const entityParam = [...ids].join(',');

  const data = await hass.callApi(
    'GET',
    `history/period/${startTime}?filter_entity_id=${entityParam}&end_time=${endTime}`
  );

  return { data, start };
}
