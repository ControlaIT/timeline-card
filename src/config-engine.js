// ------------------------------------
// CUSTOM CONFIG FETCH
// ------------------------------------
// Returns the per-entity configuration object for a given entity_id,
// or an empty object if none is found.
export function getCustomConfig(entity_id, entities) {
  return entities.find((e) => e.entity === entity_id) || {};
}

// ------------------------------------
// CSS LENGTH OPTIONS
// ------------------------------------
// Normalises a length option (`event_width`, `max_height`) to a CSS length.
// A bare number — or a string holding only digits, which is what the UI
// editor's number inputs and hand-written YAML both produce — means pixels;
// anything else is passed through as authored, so `220`, `"220"`, `"220px"`
// and `"14rem"` all work.
//
// Returns null for empty/invalid input, which callers treat as "unset" rather
// than writing an invalid CSS declaration.
export function toCssLength(value) {
  if (value == null) return null;

  if (typeof value === 'number') {
    return Number.isFinite(value) ? `${value}px` : null;
  }

  const text = `${value}`.trim();
  if (!text) return null;

  return /^\d+(\.\d+)?$/.test(text) ? `${text}px` : text;
}
