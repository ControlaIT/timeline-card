// ------------------------------------
// LOGBOOK TRANSFORM
// ------------------------------------
// Normalises a logbook entry into the same item shape state-transform.js
// produces, so the renderer needs no branch of its own and the layout is
// unchanged. transformState() can't be reused: it reads `state` and
// `last_changed`, neither of which a logbook entry has.

import { getEntityName } from './name-engine.js';
import { getCustomConfig } from './config-engine.js';
import { getLogbookIcon, getLogbookIconColor } from './icon-engine.js';

/**
 * True for entries written by the `logbook.log` service.
 *
 * `logbook/get_events` returns three shapes over the same channel:
 *
 *   state change      { state, entity_id, when }
 *   automation fired  { name, message, source, entity_id, domain, when }
 *   logbook.log       { name, message, domain, entity_id, when }
 *
 * State changes already reach the timeline through `history/period`, so
 * admitting them here would double every row — hence `state == null`.
 *
 * `source` is what separates the other two: HA synthesises it for an
 * automation/script trigger ("state of binary_sensor.x") and never sets it on a
 * `logbook.log`. Filtering on it keeps the "triggered by state of…" noise out
 * even when an `automation.*` entity is deliberately configured on the card.
 */
export function isCustomLogbookEntry(entry) {
  return (
    entry != null &&
    entry.message != null &&
    entry.state == null &&
    !entry.source &&
    typeof entry.entity_id === 'string'
  );
}

/**
 * `when` changed format across HA versions — an ISO string in older releases,
 * an epoch-seconds float in current ones (verified live: 1785511704.8064444).
 * Both have to keep working; returns ms, or 0 for anything unparseable.
 */
export function logbookEntryTime(entry) {
  if (typeof entry?.when === 'number') return entry.when * 1000;
  const parsed = Date.parse(entry?.when);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * `name` and `message` map onto the two text rows the card already draws: a
 * name as primary text, the message as secondary.
 *
 * The configured `name` wins over the entry's own. `logbook.log` requires a
 * `name` argument, so every entry carries one whether or not it was chosen with
 * this card in mind — letting it through would break the name column into a
 * different label per row for what is one entity, which is what the reader uses
 * to tell rows apart. Falling back to `entry.name` before `friendly_name` keeps
 * the entry's label for entities configured without one.
 */
export function transformLogbookEntry(entry, hass, entities, timeMs) {
  const entityId = entry.entity_id;
  const cfg = getCustomConfig(entityId, entities);
  const stateObj = hass?.states?.[entityId];

  return {
    id: entityId,
    name:
      cfg.name || entry.name || getEntityName(entityId, entities, hass?.states),
    icon: getLogbookIcon(stateObj, cfg),
    icon_color: getLogbookIconColor(cfg),
    entity_picture:
      stateObj?.attributes?.entity_picture ||
      stateObj?.attributes?.entity_picture_local ||
      null,
    state: entry.message,
    // No state to map, filter or colour by. Every consumer that keys off
    // `raw_state` checks `kind` first and lets these through untouched.
    raw_state: null,
    time: new Date(timeMs ?? logbookEntryTime(entry)),
    entityCfg: cfg,
    kind: 'logbook',
  };
}

/**
 * Whether logbook entries are shown, with the usual precedence:
 * entity → card → default (off). Opt-in, so existing cards are unaffected.
 */
export function shouldShowLogbook(cfg, globalConfig = {}) {
  return (
    cfg?.show_logbook_entries ?? globalConfig.show_logbook_entries ?? false
  );
}

/**
 * Raw `logbook/get_events` response → timeline items, ready to be concatenated
 * onto the history items before filterHistory() sorts and limits them all
 * together.
 */
export function transformLogbook(entries, entities, hass, globalConfig = {}) {
  if (!Array.isArray(entries)) return [];

  const items = [];

  for (const entry of entries) {
    if (!isCustomLogbookEntry(entry)) continue;

    const cfg = getCustomConfig(entry.entity_id, entities);
    if (!shouldShowLogbook(cfg, globalConfig)) continue;

    const timeMs = logbookEntryTime(entry);
    if (!timeMs) continue;

    items.push(transformLogbookEntry(entry, hass, entities, timeMs));
  }

  return items;
}
