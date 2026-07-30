import { describe, it, expect } from 'vitest';
import { getCustomConfig, toCssLength } from '../src/config-engine.js';

describe('getCustomConfig', () => {
  it('returns the matching entity config', () => {
    const entities = [{ entity: 'light.a', name: 'A' }, { entity: 'light.b' }];

    expect(getCustomConfig('light.a', entities)).toMatchObject({ name: 'A' });
  });

  it('returns an empty object for an unconfigured entity', () => {
    expect(getCustomConfig('light.missing', [])).toEqual({});
  });
});

describe('toCssLength', () => {
  it('treats a bare number as pixels', () => {
    expect(toCssLength(220)).toBe('220px');
  });

  it('treats a digits-only string as pixels', () => {
    // What the editor's number input and hand-written YAML both produce.
    expect(toCssLength('220')).toBe('220px');
    expect(toCssLength(' 220 ')).toBe('220px');
    expect(toCssLength('12.5')).toBe('12.5px');
  });

  it('passes an authored unit through untouched', () => {
    expect(toCssLength('220px')).toBe('220px');
    expect(toCssLength('14rem')).toBe('14rem');
    expect(toCssLength('50%')).toBe('50%');
    expect(toCssLength('min(320px, 90%)')).toBe('min(320px, 90%)');
  });

  it('returns null for unset values, so callers can skip the declaration', () => {
    expect(toCssLength(undefined)).toBeNull();
    expect(toCssLength(null)).toBeNull();
    expect(toCssLength('')).toBeNull();
    expect(toCssLength('   ')).toBeNull();
  });

  it('returns null for a non-finite number', () => {
    expect(toCssLength(NaN)).toBeNull();
    expect(toCssLength(Infinity)).toBeNull();
  });

  it('keeps 0 as a real length rather than dropping it as falsy', () => {
    expect(toCssLength(0)).toBe('0px');
  });
});
