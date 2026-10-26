// The card renders through innerHTML templates, so every value that comes from
// Home Assistant — states, friendly names, logbook messages, placeholder
// results — goes through here first. Any of those can carry markup: a
// `logbook.log` call or a text sensor is enough to inject an `<img onerror>`.

const ENTITIES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escape a value for use as HTML text or inside a quoted attribute. null and
 * undefined render as empty rather than as the words "null"/"undefined".
 */
export function escapeHtml(value) {
  if (value == null) return '';
  return String(value).replace(/[&<>"']/g, (ch) => ENTITIES[ch]);
}
