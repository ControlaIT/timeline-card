/**
 * Fetches logbook entries over the WebSocket API.
 *
 * A `logbook.log` call writes to the logbook, not to the state machine, so it
 * never appears in the `history/period` response fetchHistory() reads — the two
 * are separate sources and both are needed.
 *
 * `entity_ids` deliberately excludes the `state_map`-referenced entities the
 * history request carries along: those exist to resolve a label's placeholders,
 * not to produce rows of their own.
 *
 * Returns `[]` rather than throwing. The logbook is the secondary source here;
 * a WS failure (an unsupported HA version, the recorder being disabled) must
 * not take the history render down with it.
 */
export async function fetchLogbook(hass, entities, hours) {
  const end = new Date();
  const start = new Date(end.getTime() - hours * 60 * 60 * 1000);

  const entityIds = [...new Set(entities.map((e) => e.entity))];
  if (entityIds.length === 0) return [];

  try {
    const entries = await hass.callWS({
      type: 'logbook/get_events',
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      entity_ids: entityIds,
    });

    return Array.isArray(entries) ? entries : [];
  } catch (err) {
    console.warn('timeline-card: logbook/get_events failed', err);
    return [];
  }
}
