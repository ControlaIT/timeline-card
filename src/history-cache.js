// Simple in-memory history cache.
// Keyed by: entity configuration + history options + hours + language.
// Cached data expires after a configurable duration.

const CACHE_TTL = 60 * 1000; // 1 minute (customize)

const cache = new Map();

function buildKey(entities, hours, lang, options = {}) {
  const entityConfig = [...entities].sort((a, b) =>
    a.entity.localeCompare(b.entity)
  );
  const historyOptions = {
    collapse_duplicates: options.collapse_duplicates,
    collapse_duplicates_keep: options.collapse_duplicates_keep,
    ignore_unavailable: options.ignore_unavailable,
  };

  return `${JSON.stringify(entityConfig)}__${JSON.stringify(historyOptions)}__${hours}__${lang}`;
}

export function getCachedHistory(entities, hours, lang, options) {
  const key = buildKey(entities, hours, lang, options);
  const entry = cache.get(key);

  if (!entry) return null;

  const isExpired = Date.now() - entry.timestamp > CACHE_TTL;
  if (isExpired) {
    cache.delete(key);
    return null;
  }

  return entry.data;
}

export function setCachedHistory(entities, hours, lang, data, options) {
  const key = buildKey(entities, hours, lang, options);

  cache.set(key, {
    data,
    timestamp: Date.now(),
  });
}
