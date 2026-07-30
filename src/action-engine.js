// ------------------------------------
// TAP ACTION
// ------------------------------------
// Implements Home Assistant's `tap_action` contract. The frontend's own
// handleAction() lives inside the HA bundle and isn't reachable from a custom
// card; the published `custom-card-helpers` package wraps it, but its last
// release predates both `perform-action` (the 2024.8 rename of `call-service`)
// and `assist`, so it would need patching anyway.
//
// Nothing here is invented: every action is a DOM event the frontend already
// listens for, or a `hass` call, and the config schema is HA's verbatim — the
// same YAML any built-in card takes.
//
// `win` is injectable purely so the navigate/url/confirm branches are testable
// without a DOM.

export const DEFAULT_TAP_ACTION = { action: 'more-info' };

/**
 * Normalises a raw `tap_action` value into an action config.
 *
 * Missing or malformed config falls back to `more-info`, which is what the card
 * did unconditionally before the option existed. A bare string (`tap_action:
 * none`) is accepted as shorthand for `{ action: none }` — HA always writes the
 * object form, but the shorthand is an easy thing to hand-write.
 */
export function resolveActionConfig(raw) {
  if (raw == null) return { ...DEFAULT_TAP_ACTION };
  if (typeof raw === 'string') return { action: raw };
  if (typeof raw !== 'object' || typeof raw.action !== 'string') {
    return { ...DEFAULT_TAP_ACTION };
  }
  return raw;
}

export function fireEvent(node, type, detail = {}) {
  node.dispatchEvent(
    new CustomEvent(type, { detail, bubbles: true, composed: true })
  );
}

// A user listed in `confirmation.exemptions` skips the prompt.
function isExempt(confirmation, hass) {
  const userId = hass?.user?.id;
  if (!userId) return false;
  return (confirmation.exemptions || []).some((e) => e.user === userId);
}

/**
 * Runs a tap action. Returns the action it performed, or null when it did
 * nothing (unknown action, missing required field, declined confirmation), so
 * callers and tests can tell the difference.
 */
export function handleTapAction({
  config,
  node,
  hass,
  entityId,
  win = globalThis,
}) {
  const cfg = resolveActionConfig(config);
  const action = cfg.action;

  if (action === 'none') return 'none';

  if (cfg.confirmation && !isExempt(cfg.confirmation, hass)) {
    const text =
      cfg.confirmation.text || `Are you sure you want to run "${action}"?`;
    if (!win.confirm(text)) return null;
  }

  switch (action) {
    case 'more-info':
      fireEvent(node, 'hass-more-info', { entityId: cfg.entity || entityId });
      return 'more-info';

    case 'toggle':
      hass.callService('homeassistant', 'toggle', {
        entity_id: cfg.entity || entityId,
      });
      return 'toggle';

    case 'navigate': {
      if (!cfg.navigation_path) return null;
      const replace = !!cfg.navigation_replace;
      win.history[replace ? 'replaceState' : 'pushState'](
        win.history.state ?? null,
        '',
        cfg.navigation_path
      );
      // How the frontend router learns the URL changed under it.
      fireEvent(win, 'location-changed', { replace });
      return 'navigate';
    }

    case 'url': {
      if (!cfg.url_path) return null;
      win.open(cfg.url_path, '_blank', 'noreferrer');
      return 'url';
    }

    // `call-service` is the pre-2024.8 spelling, still accepted by HA.
    case 'perform-action':
    case 'call-service': {
      const name = cfg.perform_action || cfg.service;
      if (typeof name !== 'string' || !name.includes('.')) return null;
      const [domain, service] = name.split('.', 2);
      hass.callService(
        domain,
        service,
        cfg.data ?? cfg.service_data,
        cfg.target
      );
      return 'perform-action';
    }

    case 'assist':
      // No `dialogImport` — a custom card can't import the frontend's dialog
      // module, so this relies on the dialog already being registered.
      fireEvent(node, 'show-dialog', {
        dialogTag: 'ha-voice-command-dialog',
        dialogParams: {
          pipeline_id: cfg.pipeline_id ?? 'last_used',
          start_listening: cfg.start_listening ?? false,
        },
      });
      return 'assist';

    case 'fire-dom-event':
      fireEvent(node, 'll-custom', cfg);
      return 'fire-dom-event';

    default:
      return null;
  }
}
