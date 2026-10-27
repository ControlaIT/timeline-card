import { REFERENCE_LOOKAHEAD_MS } from './history-index.js';
import { collectReferencedEntities } from './placeholder-engine.js';

// Keep each live row's reference values separate from current hass.states.
// Only a reference event inside its window may change its label/extra text.
export function createLiveReferenceTracker() {
  const pending = new Map();

  return {
    track(item, states, transform) {
      const ids = collectReferencedEntities([item.entityCfg]);
      if (!ids.length) return;

      const values = new Map(ids.map((id) => [id, states[id] ?? null]));
      pending.set(item, { values, transform });
    },

    // A logbook entry closes previous rows without supplying a state value.
    // Attribute-only updates may change references but do not open a new row.
    update({ entityId, time, items, newState, closePrevious = true }) {
      if (!Number.isFinite(time)) return false;

      const retained = new Set(items);
      let changed = false;

      for (const [item, entry] of pending) {
        const elapsed = time - item.time.getTime();
        if (
          !retained.has(item) ||
          elapsed > REFERENCE_LOOKAHEAD_MS ||
          (closePrevious && item.id === entityId && elapsed >= 0)
        ) {
          pending.delete(item);
          continue;
        }
        if (elapsed < 0 || !entry.values.has(entityId)) continue;
        if (newState === undefined) continue;

        entry.values.set(entityId, newState);
        const updated = entry.transform((id) => entry.values.get(id) ?? null);
        if (item.state !== updated.state || item.extra !== updated.extra) {
          item.state = updated.state;
          item.extra = updated.extra;
          changed = true;
        }
      }

      return changed;
    },

    clear() {
      pending.clear();
    },
  };
}
