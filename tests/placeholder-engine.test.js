import { describe, it, expect } from 'vitest';
import {
  collectReferencedEntities,
  hasPlaceholders,
  interpolate,
  parseToken,
} from '../src/placeholder-engine.js';

const externals = {
  'sensor.salon_temp': { state: '21.5', attributes: { humidity: 48 } },
};

const ctx = {
  state: 'cool',
  attributes: { temperature: 24, friendly_name: 'AC' },
  resolveEntity: (id) => externals[id] ?? null,
};

describe('hasPlaceholders', () => {
  it('detects a token', () => {
    expect(hasPlaceholders('Cool {temperature}°C')).toBe(true);
    expect(hasPlaceholders('{sensor.x.humidity}')).toBe(true);
  });

  it('is false for plain labels and non-strings', () => {
    expect(hasPlaceholders('Cool')).toBe(false);
    expect(hasPlaceholders('100% {}')).toBe(false);
    expect(hasPlaceholders(undefined)).toBe(false);
    expect(hasPlaceholders(42)).toBe(false);
  });

  it('is not affected by regex lastIndex between calls', () => {
    // A shared /g regex keeps state across .test() calls if not reset.
    const label = 'a {x} b {y}';
    expect(hasPlaceholders(label)).toBe(true);
    expect(hasPlaceholders(label)).toBe(true);
    expect(hasPlaceholders(label)).toBe(true);
  });
});

describe('parseToken', () => {
  it('reads a token by its dots', () => {
    expect(parseToken('state')).toEqual({ kind: 'own-state' });
    expect(parseToken('temperature')).toEqual({
      kind: 'own-attribute',
      attribute: 'temperature',
    });
    expect(parseToken('sensor.x')).toEqual({
      kind: 'entity-state',
      entityId: 'sensor.x',
    });
    expect(parseToken('sensor.x.humidity')).toEqual({
      kind: 'entity-attribute',
      entityId: 'sensor.x',
      attribute: 'humidity',
    });
  });

  it('keeps dots inside an attribute name', () => {
    expect(parseToken('sensor.x.a.b')).toMatchObject({
      entityId: 'sensor.x',
      attribute: 'a.b',
    });
  });
});

describe('interpolate', () => {
  it('resolves the entity own attribute', () => {
    expect(interpolate('Cool {temperature}°C', ctx)).toBe('Cool 24°C');
  });

  it('resolves the raw state', () => {
    expect(interpolate('[{state}]', ctx)).toBe('[cool]');
  });

  it('resolves another entity state', () => {
    expect(interpolate('Heat {sensor.salon_temp}°C', ctx)).toBe('Heat 21.5°C');
  });

  it('resolves another entity attribute', () => {
    expect(interpolate('{sensor.salon_temp.humidity}%', ctx)).toBe('48%');
  });

  it('resolves several tokens in one label', () => {
    expect(interpolate('{state} {temperature}/{sensor.salon_temp}', ctx)).toBe(
      'cool 24/21.5'
    );
  });

  it('renders a missing attribute as empty, not as leftover braces', () => {
    expect(interpolate('Cool {nope}°C', ctx)).toBe('Cool °C');
  });

  it('renders an unknown entity as empty', () => {
    expect(interpolate('{sensor.ghost}', ctx)).toBe('');
    expect(interpolate('{sensor.ghost.humidity}', ctx)).toBe('');
  });

  it('renders an object-valued attribute as empty rather than [object Object]', () => {
    const withObject = {
      ...ctx,
      attributes: { nested: { a: 1 } },
    };
    expect(interpolate('{nested}', withObject)).toBe('');
  });

  it('keeps a zero-valued attribute', () => {
    expect(
      interpolate('{temperature}', { attributes: { temperature: 0 } })
    ).toBe('0');
  });

  it('works with no context at all', () => {
    expect(interpolate('{temperature}')).toBe('');
  });

  it('leaves a non-string untouched', () => {
    expect(interpolate(undefined, ctx)).toBeUndefined();
  });

  it('leaves text with no tokens alone', () => {
    expect(interpolate('Cool', ctx)).toBe('Cool');
  });
});

describe('collectReferencedEntities', () => {
  it('finds external entities across state maps', () => {
    const entities = [
      {
        entity: 'climate.salon',
        state_map: {
          cool: 'Cool {sensor.salon_temp}°C',
          dry: 'Dry {sensor.salon_clima.humidity}%',
        },
      },
      {
        entity: 'binary_sensor.door',
        state_map: { on: 'Open ({sensor.porch}) ' },
      },
    ];

    expect(collectReferencedEntities(entities).sort()).toEqual([
      'sensor.porch',
      'sensor.salon_clima',
      'sensor.salon_temp',
    ]);
  });

  it('ignores own attributes and plain labels', () => {
    const entities = [
      {
        entity: 'climate.salon',
        state_map: { cool: 'Cool {temperature}°C', off: 'Apagado' },
      },
    ];

    expect(collectReferencedEntities(entities)).toEqual([]);
  });

  it('de-duplicates an entity referenced more than once', () => {
    const entities = [
      { entity: 'a.b', state_map: { x: '{sensor.t}' } },
      { entity: 'c.d', state_map: { y: '{sensor.t}', z: '{sensor.t.attr}' } },
    ];

    expect(collectReferencedEntities(entities)).toEqual(['sensor.t']);
  });

  it('copes with entities that have no state_map', () => {
    expect(collectReferencedEntities([{ entity: 'a.b' }])).toEqual([]);
    expect(collectReferencedEntities()).toEqual([]);
  });
});
