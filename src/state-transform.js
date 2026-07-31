// state-transform.js
//
// Shared transformer for both:
//  - History events (batch)
//  - Live WebSocket events (single state_changed)
//
// Produces the unified timeline item format.
//

import { getEntityName } from './name-engine.js';
import { getCustomConfig } from './config-engine.js';
import { getIconForEntity, getIconColor } from './icon-engine.js';
import { hasPlaceholders, interpolate } from './placeholder-engine.js';

export function transformState(
  entityId,
  newState,
  hass,
  entities,
  i18n,
  resolveEntity
) {
  if (!newState) return null;

  const cfg = getCustomConfig(entityId, entities);
  const rawState = newState.state;
  const unit = newState.attributes?.unit_of_measurement;
  const entity_picture =
    newState.attributes?.entity_picture ||
    newState.attributes?.entity_picture_local ||
    null;

  const name = getEntityName(entityId, entities, hass.states);
  const icon = getIconForEntity(hass.states[entityId], cfg, rawState);
  const icon_color = getIconColor(cfg, rawState);

  const label = i18n.getLocalizedState(entityId, rawState, cfg);

  // A label with placeholders spells out its own formatting, units included, so
  // appending unit_of_measurement on top of it would double up ("23 grados °C").
  const templated = hasPlaceholders(label);
  const localizedState = templated
    ? interpolate(label, {
        state: rawState,
        attributes: newState.attributes,
        resolveEntity,
      })
    : label;

  // An empty label is a deliberate "show nothing for this state", so it gets no
  // unit either — otherwise the row would read as a bare " °C".
  const stateWithUnit =
    unit && !templated && typeof localizedState === 'string' && localizedState
      ? `${localizedState} ${unit}`
      : localizedState;

  return {
    id: entityId,
    name,
    icon,
    icon_color,
    entity_picture,
    state: stateWithUnit,
    raw_state: rawState,
    time: new Date(newState.last_changed), // must be Date() for relative_time

    // NEW: expose entity config for the renderer (colors etc.)
    entityCfg: cfg,
  };
}
