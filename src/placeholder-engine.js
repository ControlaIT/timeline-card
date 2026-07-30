// ------------------------------------
// STATE LABEL PLACEHOLDERS
// ------------------------------------
// Lets a `state_map` label pull in live values instead of being a fixed string:
//
//   state_map:
//     cool: 'Cool {temperature}°C'                 ← own attribute
//     heat: 'Heat {sensor.salon_temp}°C'           ← another entity's state
//     dry:  'Dry {sensor.salon_clima.humidity}%'   ← another entity's attribute
//
// Deliberately NOT Jinja. Home Assistant's template engine only knows the
// present — there is no way to ask it to render "as of 10:11" — so a template on
// a three-hour-old event would quietly report today's value. Every value here is
// resolved at the event's own point in time instead (see history-index.js), so a
// past event shows what was true when it happened.
//
// A token is read by its dots, since an attribute name has none and an
// `entity_id` always has exactly one:
//
//   {state}                  the event's own raw state
//   {temperature}            an attribute of the entity the event belongs to
//   {sensor.x}               another entity's state
//   {sensor.x.humidity}      another entity's attribute
//
// Anything that can't be resolved renders as empty rather than leaving the
// braces on screen — a missing sensor should not look like a config typo in the
// middle of a timeline.

const PLACEHOLDER = /\{([\w.]+)\}/g;

export function hasPlaceholders(text) {
  if (typeof text !== 'string') return false;
  PLACEHOLDER.lastIndex = 0;
  return PLACEHOLDER.test(text);
}

/**
 * Splits a token into what it refers to.
 *
 * Returns one of:
 *   { kind: 'own-state' }
 *   { kind: 'own-attribute', attribute }
 *   { kind: 'entity-state', entityId }
 *   { kind: 'entity-attribute', entityId, attribute }
 */
export function parseToken(token) {
  const parts = token.split('.');

  if (parts.length === 1) {
    return token === 'state'
      ? { kind: 'own-state' }
      : { kind: 'own-attribute', attribute: token };
  }

  const entityId = `${parts[0]}.${parts[1]}`;

  if (parts.length === 2) return { kind: 'entity-state', entityId };

  // Keep any remaining dots — attribute names may contain them.
  return {
    kind: 'entity-attribute',
    entityId,
    attribute: parts.slice(2).join('.'),
  };
}

function stringify(value) {
  if (value == null) return '';
  if (typeof value === 'object') return '';
  return `${value}`;
}

/**
 * Replaces every `{token}` in `text`.
 *
 * `resolveEntity(entityId)` returns a state object (`{ state, attributes }`) for
 * another entity, or null. It's injected rather than reading `hass.states`
 * directly so history events can resolve against the values of their own moment
 * while live events resolve against the current ones.
 */
export function interpolate(text, { state, attributes, resolveEntity } = {}) {
  if (typeof text !== 'string') return text;

  return text.replace(PLACEHOLDER, (_match, token) => {
    const ref = parseToken(token);

    switch (ref.kind) {
      case 'own-state':
        return stringify(state);

      case 'own-attribute':
        return stringify(attributes?.[ref.attribute]);

      case 'entity-state':
        return stringify(resolveEntity?.(ref.entityId)?.state);

      case 'entity-attribute':
        return stringify(
          resolveEntity?.(ref.entityId)?.attributes?.[ref.attribute]
        );

      default:
        return '';
    }
  });
}

/**
 * Every external entity referenced by any entity's `state_map`.
 *
 * The card fetches history for exactly the entities it was configured with, so
 * without this a referenced sensor would have no history to resolve against.
 * Collected up front in setConfig() and added to the same history request.
 */
export function collectReferencedEntities(entities = []) {
  const found = new Set();

  for (const cfg of entities) {
    for (const label of Object.values(cfg?.state_map || {})) {
      if (typeof label !== 'string') continue;

      for (const [, token] of label.matchAll(PLACEHOLDER)) {
        const ref = parseToken(token);
        if (ref.kind === 'entity-state' || ref.kind === 'entity-attribute') {
          found.add(ref.entityId);
        }
      }
    }
  }

  return [...found];
}
