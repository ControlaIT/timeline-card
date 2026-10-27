// Live events that arrive while the initial history load is still in flight
// are buffered and replayed once it lands (see _markHistoryReady() in
// timeline-card.js). Two things make that replay subtle:
//
// - Order. The buffer replays oldest first across BOTH sources, and each event
//   goes in at its place by time (insertByTime()) rather than at the top: an
//   event can be older than rows the history already brought — the logbook is
//   a separate request with its own "now", and an empty one when it fails.
//   Inserted at the top, an older message would sit above a newer state change
//   and, with a small `limit`, cut it off.
//
// - Overlap. The subscriptions open before the history request is sent, so an
//   event fired in between is in the buffer AND in the history response.
//   Replaying it as-is would draw it twice. Only the replay checks this, and
//   only against the rows that were there before it started: two live
//   `logbook.log` calls with the same message are two events, however close.

/**
 * Buffered `{ time, ... }` records, oldest first. Stable, so events sharing a
 * timestamp keep their arrival order; one whose time couldn't be read goes
 * last, the way processLogbookEvent() already stamps it with `Date.now()`.
 */
export function orderPendingEvents(events) {
  const key = (event) =>
    Number.isFinite(event.time) ? event.time : Number.POSITIVE_INFINITY;

  return [...events].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    return ka === kb ? 0 : ka < kb ? -1 : 1;
  });
}

/**
 * The row in `items` that is the same event as `item`, if any — not just the
 * same value: same entity, same kind, same instant and same state (or message).
 *
 * The instant is compared within 1 ms: a logbook entry's `when` is an epoch
 * float with sub-millisecond digits, and a state row's time comes from an ISO
 * string truncated to the millisecond — close enough to land on either side.
 */
export function findListed(items, item) {
  const time = item.time.getTime();
  const isLogbook = item.kind === 'logbook';

  return items.find(
    (other) =>
      other.id === item.id &&
      (other.kind === 'logbook') === isLogbook &&
      Math.abs(other.time.getTime() - time) <= 1 &&
      (isLogbook
        ? other.state === item.state
        : other.raw_state === item.raw_state)
  );
}

/**
 * Insert `item` into `items` (newest first) at its place by time. Ahead of rows
 * with the same instant, since it arrived after them.
 */
export function insertByTime(items, item) {
  const time = item.time.getTime();
  const index = items.findIndex((other) => other.time.getTime() <= time);
  items.splice(index === -1 ? items.length : index, 0, item);
}
