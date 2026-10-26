// Live logbook rows come from `logbook/event_stream`, which doesn't only send
// what happens from now on: on every subscribe it first sends what happened
// since `start_time`. And home-assistant-js-websocket re-sends the very same
// subscribe message after a reconnect, so the stream replays every entry since
// the card loaded. Both overlap with rows the card already has.
//
// The card remembers every entry it has covered — from the history load, the
// cache and the stream itself — by what identifies it: entity, instant and
// message. A time alone isn't enough: two entities, or two different messages,
// can share a millisecond, and an older entry can arrive late without ever
// having been shown. The one case still merged is the same message for the
// same entity within the same millisecond, which nothing in the entry tells
// apart from a replay of itself.

/**
 * Identity of a logbook entry. The time is truncated to the millisecond so the
 * epoch-float `when` of a stream entry matches a cached row whose time was
 * stored as a whole-millisecond Date.
 */
export function logbookKey(entityId, timeMs, message) {
  return `${entityId}\n${Math.floor(timeMs)}\n${message}`;
}

/** logbookKey() of a timeline row built by transformLogbookEntry(). */
export function logbookItemKey(item) {
  return logbookKey(item.id, item.time.getTime(), item.state);
}

/**
 * `start_time` for the subscription, on the server's clock: the newest
 * `last_updated` among the states HA has sent. HA rejects a `start_time` in its
 * future (`invalid_start_time`), so the browser's clock running ahead would
 * otherwise cost the live logbook for good. Starting a little early is
 * harmless: whatever the stream sends from before the history load is already
 * remembered as covered. Falls back to the browser clock only when there are
 * no states to read.
 */
export function streamStartTime(states, fallbackMs = Date.now()) {
  let latest = Number.NEGATIVE_INFINITY;
  for (const state of Object.values(states ?? {})) {
    const time = Date.parse(state?.last_updated);
    if (Number.isFinite(time)) latest = Math.max(latest, time);
  }
  return new Date(Number.isFinite(latest) ? latest : fallbackMs).toISOString();
}
