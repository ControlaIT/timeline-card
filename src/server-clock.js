// The card's requests carry times, and the browser's clock isn't Home
// Assistant's: it can run seconds or minutes ahead or behind. The only server
// time the card has without asking is in the states HA has sent — the newest
// `last_updated` is a moment the server has already reached.

/** The newest `last_updated` (ms) among `states`, or -Infinity without one. */
export function latestStateTime(states) {
  let latest = Number.NEGATIVE_INFINITY;
  for (const state of Object.values(states ?? {})) {
    const time = Date.parse(state?.last_updated);
    if (Number.isFinite(time)) latest = Math.max(latest, time);
  }
  return latest;
}

/**
 * End of the history and logbook window: the browser's clock, or the server's
 * where that is later. With the browser behind, ending at its "now" would leave
 * out what happened since then on the server — and the logbook stream only
 * picks up from the newest `last_updated` (streamStartTime()), so those entries
 * would show only after the next refresh. Running past the server's real "now"
 * is harmless: there is nothing there yet.
 */
export function windowEnd(states, nowMs = Date.now()) {
  return new Date(Math.max(nowMs, latestStateTime(states)));
}
