import { describe, it, expect } from 'vitest';
import {
  isCustomLogbookEntry,
  logbookEntryTime,
  transformLogbookEntry,
  shouldShowLogbook,
  transformLogbook,
} from '../src/logbook-transform.js';

// Payloads captured verbatim from a live `logbook/get_events` call against the
// Numa Granada Vega installation, so the shapes tested here are the shapes HA
// actually sends rather than ones inferred from its type definitions.

const MANUAL_ENTRY = {
  name: 'Esto es una prueba',
  message: 'Mensaje de prueba',
  domain: 'binary_sensor',
  entity_id: 'binary_sensor.numa_granadavega_401_motion_group',
  when: 1785511704.8064444,
  context_user_id: '6713e463ca334090be34f9d32cac33b4',
  context_domain: 'logbook',
  context_service: 'log',
  context_event_type: 'call_service',
};

// Same service, called from an automation rather than by hand — still a
// logbook.log, so it must be admitted just like the manual one.
const AUTOMATION_ISSUED_ENTRY = {
  name: 'Granada Vega 401',
  message:
    'Movimiento interno sin apertura de puerta tras marcarse vacía. Sensor(es) activo(s):  binary_sensor.numa_granadavega_401_living_pir_occupancy',
  domain: 'binary_sensor',
  entity_id: 'binary_sensor.numa_granadavega_401_motion_group',
  when: 1785497942.4375117,
  context_event_type: 'automation_triggered',
  context_domain: 'automation',
  context_name: 'Granada Vega 401 – Metric: False Empty Motion Recovery',
};

// An automation firing. Carries `source`, which is what marks it as synthesised
// by HA rather than written by logbook.log.
const AUTOMATION_TRIGGER_ENTRY = {
  name: 'Granada Vega 403 – Door Opens to Uncertain',
  message:
    'triggered by state of binary_sensor.numa_granadavega_403_entrance_contact_door',
  source: 'state of binary_sensor.numa_granadavega_403_entrance_contact_door',
  entity_id: 'automation.granada_vega_403_door_opens_to_uncertain',
  context_id: '01KZ1ZZQ9SDSCHG5EY7B99QJ8Z',
  domain: 'automation',
  when: 1785699753.2738605,
};

const STATE_ENTRY = {
  state: 'on',
  entity_id: 'binary_sensor.numa_granadavega_401_motion_group',
  when: 1785698983.8211472,
};

describe('isCustomLogbookEntry', () => {
  it('accepts a logbook.log entry called by hand', () => {
    expect(isCustomLogbookEntry(MANUAL_ENTRY)).toBe(true);
  });

  it('accepts a logbook.log entry issued by an automation', () => {
    expect(isCustomLogbookEntry(AUTOMATION_ISSUED_ENTRY)).toBe(true);
  });

  it('rejects an automation trigger, which carries `source`', () => {
    expect(isCustomLogbookEntry(AUTOMATION_TRIGGER_ENTRY)).toBe(false);
  });

  it('rejects a state change, which history/period already provides', () => {
    expect(isCustomLogbookEntry(STATE_ENTRY)).toBe(false);
  });

  it('rejects an entry with no entity_id to attach to', () => {
    expect(isCustomLogbookEntry({ name: 'x', message: 'y' })).toBe(false);
  });

  it('rejects null/undefined without throwing', () => {
    expect(isCustomLogbookEntry(null)).toBe(false);
    expect(isCustomLogbookEntry(undefined)).toBe(false);
  });
});

describe('logbookEntryTime', () => {
  it('reads the epoch-seconds float current HA versions send', () => {
    expect(logbookEntryTime(MANUAL_ENTRY)).toBe(1785511704.8064444 * 1000);
  });

  it('still reads the ISO string older HA versions sent', () => {
    const iso = '2026-07-31T15:28:24.806444+00:00';
    expect(logbookEntryTime({ when: iso })).toBe(Date.parse(iso));
  });

  it('returns 0 for an unparseable value rather than an Invalid Date', () => {
    expect(logbookEntryTime({ when: 'not-a-date' })).toBe(0);
    expect(logbookEntryTime({})).toBe(0);
  });
});

describe('transformLogbookEntry', () => {
  const hass = {
    states: {
      'binary_sensor.numa_granadavega_401_motion_group': {
        entity_id: 'binary_sensor.numa_granadavega_401_motion_group',
        state: 'off',
        attributes: { friendly_name: 'Motion 401', icon: 'mdi:motion-sensor' },
      },
    },
  };

  it('maps name to the primary row and message to the secondary one', () => {
    const item = transformLogbookEntry(MANUAL_ENTRY, hass, []);

    expect(item.name).toBe('Esto es una prueba');
    expect(item.state).toBe('Mensaje de prueba');
    expect(item.id).toBe('binary_sensor.numa_granadavega_401_motion_group');
    expect(item.time.toISOString()).toBe('2026-07-31T15:28:24.806Z');
  });

  it('lets the configured name win, keeping the name column consistent', () => {
    // logbook.log requires a `name`, so an entry always carries one — here the
    // literal word 'climate', which would otherwise label this row differently
    // from every state row of the same entity.
    const item = transformLogbookEntry(
      { ...MANUAL_ENTRY, name: 'climate' },
      hass,
      [
        {
          entity: 'binary_sensor.numa_granadavega_401_motion_group',
          name: 'Movimiento 401',
        },
      ]
    );

    expect(item.name).toBe('Movimiento 401');
  });

  it("keeps the entry's name when the entity is configured without one", () => {
    const item = transformLogbookEntry(MANUAL_ENTRY, hass, [
      { entity: 'binary_sensor.numa_granadavega_401_motion_group' },
    ]);

    expect(item.name).toBe('Esto es una prueba');
  });

  it('carries no raw_state, and marks itself so state filters skip it', () => {
    const item = transformLogbookEntry(MANUAL_ENTRY, hass, []);

    expect(item.raw_state).toBeNull();
    expect(item.kind).toBe('logbook');
  });

  it("falls back to HA's friendly_name when neither has one", () => {
    const item = transformLogbookEntry(
      { ...MANUAL_ENTRY, name: undefined },
      hass,
      [{ entity: 'binary_sensor.numa_granadavega_401_motion_group' }]
    );

    expect(item.name).toBe('Motion 401');
  });

  it('prefers logbook_icon, then the entity icon, over the HA one', () => {
    const withOverride = transformLogbookEntry(MANUAL_ENTRY, hass, [
      {
        entity: 'binary_sensor.numa_granadavega_401_motion_group',
        logbook_icon: 'mdi:bell',
        icon: 'mdi:eye',
      },
    ]);
    expect(withOverride.icon).toBe('mdi:bell');

    const fromHa = transformLogbookEntry(MANUAL_ENTRY, hass, []);
    expect(fromHa.icon).toBe('mdi:motion-sensor');
  });

  it('never resolves an icon_map, which has no state to key on', () => {
    const item = transformLogbookEntry(MANUAL_ENTRY, hass, [
      {
        entity: 'binary_sensor.numa_granadavega_401_motion_group',
        icon_map: { on: 'mdi:run', off: 'mdi:sleep' },
      },
    ]);

    // 'off' is the entity's current state, but it is not the entry's state —
    // the entry has none. The HA icon is used instead of guessing.
    expect(item.icon).toBe('mdi:motion-sensor');
  });

  it('accepts an explicit timestamp, for bus events that have no `when`', () => {
    const item = transformLogbookEntry(
      { name: 'Live', message: 'Just fired', entity_id: 'binary_sensor.x' },
      hass,
      [],
      1785511704806
    );

    expect(item.time.getTime()).toBe(1785511704806);
  });

  it('resolves an unknown entity without throwing', () => {
    const item = transformLogbookEntry(
      { name: 'X', message: 'Y', entity_id: 'sensor.not_in_hass' },
      { states: {} },
      []
    );

    expect(item.name).toBe('X');
    expect(item.icon).toBe('mdi:message-text');
    expect(item.entity_picture).toBeNull();
  });
});

describe('shouldShowLogbook', () => {
  it('is off unless asked for', () => {
    expect(shouldShowLogbook({}, {})).toBe(false);
  });

  it('lets an entity opt in on a card that has not', () => {
    expect(shouldShowLogbook({ show_logbook_entries: true }, {})).toBe(true);
  });

  it('lets an entity opt out of a card that has opted in', () => {
    expect(
      shouldShowLogbook(
        { show_logbook_entries: false },
        { show_logbook_entries: true }
      )
    ).toBe(false);
  });
});

describe('transformLogbook', () => {
  const hass = { states: {} };
  const entities = [
    { entity: 'binary_sensor.numa_granadavega_401_motion_group' },
    { entity: 'automation.granada_vega_403_door_opens_to_uncertain' },
  ];
  const raw = [
    STATE_ENTRY,
    MANUAL_ENTRY,
    AUTOMATION_TRIGGER_ENTRY,
    AUTOMATION_ISSUED_ENTRY,
  ];

  it('keeps only the logbook.log entries, even with an automation configured', () => {
    const items = transformLogbook(raw, entities, hass, {
      show_logbook_entries: true,
    });

    expect(items).toHaveLength(2);
    expect(items.map((i) => i.state)).toEqual([
      MANUAL_ENTRY.message,
      AUTOMATION_ISSUED_ENTRY.message,
    ]);
  });

  it('returns nothing while the option is off', () => {
    expect(transformLogbook(raw, entities, hass, {})).toEqual([]);
  });

  it('drops entries whose timestamp could not be read', () => {
    const items = transformLogbook(
      [{ ...MANUAL_ENTRY, when: 'garbage' }],
      entities,
      hass,
      { show_logbook_entries: true }
    );

    expect(items).toEqual([]);
  });

  it('tolerates a non-array response', () => {
    expect(transformLogbook(undefined, entities, hass, {})).toEqual([]);
    expect(transformLogbook(null, entities, hass, {})).toEqual([]);
  });
});
