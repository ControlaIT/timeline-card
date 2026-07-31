// A key written with no value (`off:` in YAML) parses as null, which would blank
// the label instead of falling through to the next source. An explicit empty
// string is a real choice — "show nothing for this state" — so only null and a
// missing key count as unset.
function readLabel(map, key) {
  if (!map || !Object.prototype.hasOwnProperty.call(map, key)) return undefined;
  const label = map[key];
  return label == null ? undefined : label;
}

export class TranslationEngine {
  constructor(translations) {
    this.translations = translations; // { en-us: {...}, de: {...} }
    this.langCode = 'en-us'; // fallback
    this.active = translations['en-us']; // active translation table
  }

  // Loads translation object based on a language like 'de-DE'
  async load(lang) {
    const key = lang.toLowerCase();
    const short = key.substring(0, 2);

    this.active =
      this.translations[key] ||
      this.translations[short] ||
      this.translations['en-us'];

    this.langCode = key;
  }

  // e.g. t("status.open", { n: 5 })
  t(path, vars = {}) {
    const parts = path.split('.');
    let node = this.active;

    for (const p of parts) {
      if (!node[p]) return path;
      node = node[p];
    }

    if (typeof node === 'string') {
      return node.replace(/\{(\w+)\}/g, (_, v) => vars[v] ?? `{${v}}`);
    }

    return node;
  }

  // Applies YAML state_map (exact state → `default`) → then locale → then
  // fallback
  getLocalizedState(entity_id, state, cfg) {
    const map = cfg?.state_map;

    // YAML override for this exact state
    const exact = readLabel(map, state);
    if (exact !== undefined) return exact;

    // YAML catch-all: one label for every state the map doesn't name — the same
    // `default` key `icon_map` already uses. It comes before the locale table
    // because it was written for this entity, and paired with a `{state}`
    // placeholder it turns an open-ended state (a number, a PMS status code)
    // into a single template instead of one line per possible value.
    const fallback = readLabel(map, 'default');
    if (fallback !== undefined) return fallback;

    // JSON translation
    const translated = this.t(`status.${state}`);
    if (translated !== `status.${state}`) {
      return translated;
    }

    return state;
  }
}
