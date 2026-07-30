import { describe, expect, it } from 'vitest';
import { getCachedHistory, setCachedHistory } from '../src/history-cache.js';

const entities = [{ entity: 'binary_sensor.door' }];
const options = { ignore_unavailable: true };

describe('history cache', () => {
  it('does not share filtered history with a card that keeps availability events', () => {
    const filtered = [{ raw_state: 'off' }];
    const raw = [{ raw_state: 'off' }, { raw_state: 'unavailable' }];

    setCachedHistory(entities, 12, 'en-us', filtered, options);
    setCachedHistory(entities, 12, 'en-us', raw, {
      ignore_unavailable: false,
    });

    expect(getCachedHistory(entities, 12, 'en-us', options)).toEqual(filtered);
    expect(
      getCachedHistory(entities, 12, 'en-us', { ignore_unavailable: false })
    ).toEqual(raw);
  });

  it('does not share history between different per-entity filters', () => {
    setCachedHistory(entities, 12, 'en-us', ['off'], options);

    expect(
      getCachedHistory(
        [{ entity: 'binary_sensor.door', include_states: ['on'] }],
        12,
        'en-us',
        options
      )
    ).toBeNull();
  });
});
