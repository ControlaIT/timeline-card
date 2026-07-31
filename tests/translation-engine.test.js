import { describe, it, expect } from 'vitest';
import { TranslationEngine } from '../src/translation-engine.js';

const translations = {
  'en-us': { status: { on: 'On', off: 'Off' } },
  es: { status: { on: 'Encendido', off: 'Apagado' } },
};

const engine = () => new TranslationEngine(translations);

describe('getLocalizedState', () => {
  it('prefers an exact state_map entry over the locale table', () => {
    const i18n = engine();
    expect(i18n.getLocalizedState('light.a', 'on', { state_map: {} })).toBe(
      'On'
    );
    expect(
      i18n.getLocalizedState('light.a', 'on', { state_map: { on: 'Opened' } })
    ).toBe('Opened');
  });

  it('falls back to the locale table, then to the raw state', () => {
    const i18n = engine();
    expect(i18n.getLocalizedState('light.a', 'off')).toBe('Off');
    expect(i18n.getLocalizedState('sensor.a', 'brewing')).toBe('brewing');
  });

  describe('state_map default', () => {
    it('labels any state the map does not name', () => {
      const cfg = { state_map: { default: 'Cambiado' } };
      const i18n = engine();

      expect(i18n.getLocalizedState('sensor.a', 'brewing', cfg)).toBe(
        'Cambiado'
      );
      // Even one the locale table knows: the map was written for this entity.
      expect(i18n.getLocalizedState('sensor.a', 'on', cfg)).toBe('Cambiado');
    });

    it('yields to an exact match for the state', () => {
      const cfg = { state_map: { cleaning: 'Limpieza', default: 'Ocupada' } };
      const i18n = engine();

      expect(i18n.getLocalizedState('sensor.a', 'cleaning', cfg)).toBe(
        'Limpieza'
      );
      expect(i18n.getLocalizedState('sensor.a', 'dirty', cfg)).toBe('Ocupada');
    });

    it('is left to the interpolation step, placeholders and all', () => {
      // The engine hands the template on untouched; state-transform resolves it.
      const cfg = { state_map: { default: 'Estado {state}' } };
      expect(engine().getLocalizedState('sensor.a', 'x', cfg)).toBe(
        'Estado {state}'
      );
    });

    it('does not fire when the key is written with no value', () => {
      // `default:` alone in YAML parses as null, which is a half-written config,
      // not a request to blank every label.
      const cfg = { state_map: { default: null } };
      expect(engine().getLocalizedState('sensor.a', 'on', cfg)).toBe('On');
    });

    it('ignores keys the map only inherits from Object', () => {
      // A state named `constructor` would otherwise render as a function.
      const cfg = { state_map: { default: 'Otro' } };
      expect(engine().getLocalizedState('sensor.a', 'constructor', cfg)).toBe(
        'Otro'
      );
    });

    it('keeps an explicitly empty label', () => {
      const cfg = { state_map: { on: '', default: 'Otro' } };
      expect(engine().getLocalizedState('light.a', 'on', cfg)).toBe('');
    });
  });
});
