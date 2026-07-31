import { describe, it, expect } from 'vitest';
import { transformState } from '../src/state-transform.js';
import { TranslationEngine } from '../src/translation-engine.js';

// Mock dependencies
const mockI18n = {
  getLocalizedState: (entityId, state) => {
    // Simple mock: return the state as is, or capitalize it
    return state;
  },
};

const mockHass = {
  states: {
    'sensor.temp': {
      entity_id: 'sensor.temp',
      attributes: { friendly_name: 'Temperature' },
    },
    'switch.light': {
      entity_id: 'switch.light',
      attributes: { friendly_name: 'Living Room Light' },
    },
  },
};

describe('transformState', () => {
  it('should transform a simple state correctly', () => {
    const entityId = 'switch.light';
    const now = new Date().toISOString();
    const newState = {
      state: 'on',
      last_changed: now,
      attributes: { friendly_name: 'Living Room Light' },
    };
    const entities = []; // No custom config

    const result = transformState(
      entityId,
      newState,
      mockHass,
      entities,
      mockI18n
    );

    expect(result).toMatchObject({
      id: 'switch.light',
      name: 'Living Room Light', // Derived from hass state
      raw_state: 'on',
      state: 'on', // From mockI18n
    });
    expect(result.time).toBeInstanceOf(Date);
    expect(result.time.toISOString()).toBe(now);
  });

  it('should append unit_of_measurement if present', () => {
    const entityId = 'sensor.temp';
    const newState = {
      state: '22.5',
      last_changed: new Date().toISOString(),
      attributes: {
        friendly_name: 'Temperature',
        unit_of_measurement: '°C',
      },
    };
    const entities = [];

    const result = transformState(
      entityId,
      newState,
      mockHass,
      entities,
      mockI18n
    );

    expect(result.state).toBe('22.5 °C');
    expect(result.raw_state).toBe('22.5');
  });

  it('should use custom name from configuration', () => {
    const entityId = 'switch.light';
    const newState = {
      state: 'off',
      last_changed: new Date().toISOString(),
      attributes: { friendly_name: 'Living Room Light' },
    };

    // Config overrides name
    const entities = [{ entity: 'switch.light', name: 'My Custom Lamp' }];

    const result = transformState(
      entityId,
      newState,
      mockHass,
      entities,
      mockI18n
    );

    expect(result.name).toBe('My Custom Lamp');
  });

  it('should return null if newState is invalid', () => {
    const result = transformState(
      'sensor.unknown',
      null,
      mockHass,
      [],
      mockI18n
    );
    expect(result).toBeNull();
  });

  describe('state_map placeholders', () => {
    // The real engine, so state_map labels reach the interpolation path.
    const i18n = {
      getLocalizedState: (_entityId, state, cfg) =>
        cfg?.state_map?.[state] ?? state,
    };

    const climate = {
      state: 'cool',
      last_changed: new Date().toISOString(),
      attributes: { friendly_name: 'AC', temperature: 24 },
    };

    it('fills an own attribute into the label', () => {
      const entities = [
        {
          entity: 'climate.salon',
          state_map: { cool: 'Cool {temperature}°C' },
        },
      ];

      const result = transformState(
        'climate.salon',
        climate,
        mockHass,
        entities,
        i18n
      );

      expect(result.state).toBe('Cool 24°C');
      expect(result.raw_state).toBe('cool'); // filters still see the raw value
    });

    it('resolves another entity through the injected resolver', () => {
      const entities = [
        {
          entity: 'climate.salon',
          state_map: { cool: 'Cool {sensor.salon_temp}°C' },
        },
      ];

      const result = transformState(
        'climate.salon',
        climate,
        mockHass,
        entities,
        i18n,
        (id) => (id === 'sensor.salon_temp' ? { state: '21.5' } : null)
      );

      expect(result.state).toBe('Cool 21.5°C');
    });

    it('does not append unit_of_measurement to a templated label', () => {
      // Otherwise a sensor label reads "23 grados °C".
      const entities = [
        { entity: 'sensor.temp', state_map: { 23: '{state} grados' } },
      ];

      const result = transformState(
        'sensor.temp',
        {
          state: '23',
          last_changed: new Date().toISOString(),
          attributes: { unit_of_measurement: '°C' },
        },
        mockHass,
        entities,
        i18n
      );

      expect(result.state).toBe('23 grados');
    });

    it('still appends the unit to a plain mapped label', () => {
      const entities = [
        { entity: 'sensor.temp', state_map: { 23: 'Templado' } },
      ];

      const result = transformState(
        'sensor.temp',
        {
          state: '23',
          last_changed: new Date().toISOString(),
          attributes: { unit_of_measurement: '°C' },
        },
        mockHass,
        entities,
        i18n
      );

      expect(result.state).toBe('Templado °C');
    });
  });

  describe('state_map default', () => {
    // The real engine, so the catch-all is resolved the way the card does it.
    const i18n = new TranslationEngine({ 'en-us': { status: {} } });

    const reading = (state, attributes = {}) => ({
      state,
      last_changed: new Date().toISOString(),
      attributes,
    });

    it('labels a state the map does not name, placeholders included', () => {
      const entities = [
        {
          entity: 'sensor.temp',
          state_map: { 0: 'Sin consumo', default: '{state} en curso' },
        },
      ];

      const result = transformState(
        'sensor.temp',
        reading('42'),
        mockHass,
        entities,
        i18n
      );

      expect(result.state).toBe('42 en curso');
      expect(result.raw_state).toBe('42');
    });

    it('leaves an exactly mapped state alone', () => {
      const entities = [
        {
          entity: 'sensor.temp',
          state_map: { 0: 'Sin consumo', default: '{state} en curso' },
        },
      ];

      const result = transformState(
        'sensor.temp',
        reading('0'),
        mockHass,
        entities,
        i18n
      );

      expect(result.state).toBe('Sin consumo');
    });

    it('appends the unit to a plain catch-all label', () => {
      const entities = [
        { entity: 'sensor.temp', state_map: { default: 'Medido' } },
      ];

      const result = transformState(
        'sensor.temp',
        reading('42', { unit_of_measurement: '°C' }),
        mockHass,
        entities,
        i18n
      );

      expect(result.state).toBe('Medido °C');
    });

    it('does not append a unit to an empty label', () => {
      // Otherwise blanking a state's label leaves a stray " °C" on the row.
      const entities = [{ entity: 'sensor.temp', state_map: { 42: '' } }];

      const result = transformState(
        'sensor.temp',
        reading('42', { unit_of_measurement: '°C' }),
        mockHass,
        entities,
        i18n
      );

      expect(result.state).toBe('');
    });
  });
});
