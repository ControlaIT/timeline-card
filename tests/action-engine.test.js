import { describe, it, expect, vi } from 'vitest';
import {
  DEFAULT_TAP_ACTION,
  handleTapAction,
  resolveActionConfig,
} from '../src/action-engine.js';

// Minimal stand-ins for the browser/HA objects the engine touches, so the
// navigate/url/confirm branches are exercisable without a DOM.
function makeNode() {
  const events = [];
  return {
    events,
    dispatchEvent(ev) {
      events.push({ type: ev.type, detail: ev.detail });
      return true;
    },
  };
}

function makeHass(user) {
  return { callService: vi.fn(), user };
}

function makeWin({ confirm = () => true } = {}) {
  const node = makeNode();
  return {
    ...node,
    confirm: vi.fn(confirm),
    open: vi.fn(),
    history: {
      state: { root: true },
      pushState: vi.fn(),
      replaceState: vi.fn(),
    },
  };
}

const ENTITY = 'binary_sensor.door';

function run(config, { hass = makeHass(), win = makeWin() } = {}) {
  const node = makeNode();
  const result = handleTapAction({
    config,
    node,
    hass,
    entityId: ENTITY,
    win,
  });
  return { result, node, hass, win };
}

describe('resolveActionConfig', () => {
  it('defaults to more-info, preserving the pre-option behaviour', () => {
    expect(resolveActionConfig(undefined)).toEqual(DEFAULT_TAP_ACTION);
    expect(resolveActionConfig(null)).toEqual(DEFAULT_TAP_ACTION);
  });

  it('falls back to the default for malformed config', () => {
    expect(resolveActionConfig({})).toEqual(DEFAULT_TAP_ACTION);
    expect(resolveActionConfig({ action: 42 })).toEqual(DEFAULT_TAP_ACTION);
    expect(resolveActionConfig(7)).toEqual(DEFAULT_TAP_ACTION);
  });

  it('accepts the bare-string shorthand', () => {
    expect(resolveActionConfig('none')).toEqual({ action: 'none' });
  });

  it('returns a full config untouched', () => {
    const cfg = { action: 'navigate', navigation_path: '/lovelace/0' };
    expect(resolveActionConfig(cfg)).toBe(cfg);
  });
});

describe('handleTapAction', () => {
  it('fires hass-more-info for the clicked entity by default', () => {
    const { result, node } = run(undefined);

    expect(result).toBe('more-info');
    expect(node.events).toEqual([
      { type: 'hass-more-info', detail: { entityId: ENTITY } },
    ]);
  });

  it('lets more-info target a different entity', () => {
    const { node } = run({ action: 'more-info', entity: 'light.kitchen' });

    expect(node.events[0].detail).toEqual({ entityId: 'light.kitchen' });
  });

  it('does nothing at all for none', () => {
    const { result, node, hass } = run({ action: 'none' });

    expect(result).toBe('none');
    expect(node.events).toHaveLength(0);
    expect(hass.callService).not.toHaveBeenCalled();
  });

  it('toggles the clicked entity', () => {
    const { result, hass } = run({ action: 'toggle' });

    expect(result).toBe('toggle');
    expect(hass.callService).toHaveBeenCalledWith('homeassistant', 'toggle', {
      entity_id: ENTITY,
    });
  });

  it('navigates by pushing state and announcing the change', () => {
    const { result, win } = run({
      action: 'navigate',
      navigation_path: '/lovelace/1',
    });

    expect(result).toBe('navigate');
    expect(win.history.pushState).toHaveBeenCalledWith(
      { root: true },
      '',
      '/lovelace/1'
    );
    expect(win.history.replaceState).not.toHaveBeenCalled();
    expect(win.events).toEqual([
      { type: 'location-changed', detail: { replace: false } },
    ]);
  });

  it('replaces history when navigation_replace is set', () => {
    const { win } = run({
      action: 'navigate',
      navigation_path: '/lovelace/1',
      navigation_replace: true,
    });

    expect(win.history.replaceState).toHaveBeenCalled();
    expect(win.history.pushState).not.toHaveBeenCalled();
    expect(win.events[0].detail).toEqual({ replace: true });
  });

  it('does nothing when navigate has no path', () => {
    const { result, win } = run({ action: 'navigate' });

    expect(result).toBeNull();
    expect(win.history.pushState).not.toHaveBeenCalled();
  });

  it('opens a url', () => {
    const { result, win } = run({
      action: 'url',
      url_path: 'https://example.com',
    });

    expect(result).toBe('url');
    expect(win.open).toHaveBeenCalledWith(
      'https://example.com',
      '_blank',
      'noreferrer'
    );
  });

  it('does nothing when url has no path', () => {
    const { result, win } = run({ action: 'url' });

    expect(result).toBeNull();
    expect(win.open).not.toHaveBeenCalled();
  });

  it('performs an action with its target and data', () => {
    const { result, hass } = run({
      action: 'perform-action',
      perform_action: 'light.turn_on',
      target: { entity_id: 'light.kitchen' },
      data: { brightness: 120 },
    });

    expect(result).toBe('perform-action');
    expect(hass.callService).toHaveBeenCalledWith(
      'light',
      'turn_on',
      { brightness: 120 },
      { entity_id: 'light.kitchen' }
    );
  });

  it('still accepts the pre-2024.8 call-service spelling', () => {
    const { result, hass } = run({
      action: 'call-service',
      service: 'light.turn_off',
      service_data: { transition: 2 },
    });

    expect(result).toBe('perform-action');
    expect(hass.callService).toHaveBeenCalledWith(
      'light',
      'turn_off',
      { transition: 2 },
      undefined
    );
  });

  it('does nothing for an action name that is not domain.service', () => {
    const { result, hass } = run({
      action: 'perform-action',
      perform_action: 'nonsense',
    });

    expect(result).toBeNull();
    expect(hass.callService).not.toHaveBeenCalled();
  });

  it('fires ll-custom for fire-dom-event', () => {
    const cfg = { action: 'fire-dom-event', foo: 'bar' };
    const { result, node } = run(cfg);

    expect(result).toBe('fire-dom-event');
    expect(node.events[0]).toEqual({ type: 'll-custom', detail: cfg });
  });

  it('returns null for an unknown action rather than guessing', () => {
    const { result, node } = run({ action: 'teleport' });

    expect(result).toBeNull();
    expect(node.events).toHaveLength(0);
  });

  describe('confirmation', () => {
    it('runs the action when confirmed', () => {
      const win = makeWin({ confirm: () => true });
      const { result, hass } = run(
        { action: 'toggle', confirmation: { text: 'Sure?' } },
        { win }
      );

      expect(win.confirm).toHaveBeenCalledWith('Sure?');
      expect(result).toBe('toggle');
      expect(hass.callService).toHaveBeenCalled();
    });

    it('aborts when declined', () => {
      const win = makeWin({ confirm: () => false });
      const { result, hass } = run(
        { action: 'toggle', confirmation: {} },
        { win }
      );

      expect(result).toBeNull();
      expect(hass.callService).not.toHaveBeenCalled();
    });

    it('skips the prompt for an exempt user', () => {
      const win = makeWin({ confirm: () => false });
      const hass = makeHass({ id: 'user-1' });
      const { result } = run(
        {
          action: 'toggle',
          confirmation: { exemptions: [{ user: 'user-1' }] },
        },
        { hass, win }
      );

      expect(win.confirm).not.toHaveBeenCalled();
      expect(result).toBe('toggle');
    });

    it('still prompts a user who is not exempt', () => {
      const win = makeWin({ confirm: () => false });
      const hass = makeHass({ id: 'user-2' });
      const { result } = run(
        {
          action: 'toggle',
          confirmation: { exemptions: [{ user: 'user-1' }] },
        },
        { hass, win }
      );

      expect(win.confirm).toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('never prompts for none, which does nothing anyway', () => {
      const win = makeWin({ confirm: () => false });
      const { result } = run({ action: 'none', confirmation: {} }, { win });

      expect(win.confirm).not.toHaveBeenCalled();
      expect(result).toBe('none');
    });
  });
});
