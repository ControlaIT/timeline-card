import { describe, it, expect } from 'vitest';
import {
  groupItemsByDay,
  formatDayLabel,
  formatDayDate,
} from '../src/day-engine.js';

function fakeI18n(overrides = {}) {
  const table = {
    'ui.today': 'Today',
    'ui.yesterday': 'Yesterday',
    ...overrides,
  };
  return {
    t(path) {
      return path in table ? table[path] : path;
    },
  };
}

describe('groupItemsByDay', () => {
  it('groups already-sorted (newest-first) items by calendar day', () => {
    const items = [
      { id: 'a', time: new Date(2026, 6, 29, 11, 0) },
      { id: 'b', time: new Date(2026, 6, 29, 9, 0) },
      { id: 'c', time: new Date(2026, 6, 28, 23, 0) },
    ];

    const groups = groupItemsByDay(items);

    expect(groups).toHaveLength(2);
    expect(groups[0].items).toHaveLength(2);
    expect(groups[1].items).toHaveLength(1);
    expect(groups[1].items[0].id).toBe('c');
  });

  it('returns an empty array for no items', () => {
    expect(groupItemsByDay([])).toEqual([]);
  });

  it('keeps a single group when every item is on the same day', () => {
    const items = [
      { id: 'a', time: new Date(2026, 6, 29, 23, 59) },
      { id: 'b', time: new Date(2026, 6, 29, 0, 1) },
    ];
    expect(groupItemsByDay(items)).toHaveLength(1);
  });
});

describe('formatDayLabel', () => {
  it('returns the localized "today" label for the same calendar day as now', () => {
    const now = new Date(2026, 6, 29, 8, 0);
    const date = new Date(2026, 6, 29, 23, 0);
    expect(formatDayLabel(date, fakeI18n(), 'en-US', now)).toBe('Today');
  });

  it('returns the localized "yesterday" label for the day before now', () => {
    const now = new Date(2026, 6, 29, 8, 0);
    const date = new Date(2026, 6, 28, 1, 0);
    expect(formatDayLabel(date, fakeI18n(), 'en-US', now)).toBe('Yesterday');
  });

  it('falls back to the capitalized weekday name for older days', () => {
    const now = new Date(2026, 6, 29, 8, 0);
    const date = new Date(2026, 6, 20, 12, 0);
    const label = formatDayLabel(date, fakeI18n(), 'en-US', now);
    expect(label[0]).toBe(label[0].toUpperCase());
  });

  it('uses the date_format.weekday Intl options when the locale provides them', () => {
    const now = new Date(2026, 6, 29, 8, 0);
    const date = new Date(2026, 6, 20, 12, 0);
    const i18n = fakeI18n({ 'date_format.weekday': { weekday: 'short' } });
    const label = formatDayLabel(date, i18n, 'en-US', now);
    expect(label.length).toBeLessThanOrEqual(4);
  });
});

describe('formatDayDate', () => {
  it('formats a long-form date using date_format.day_full when provided', () => {
    const date = new Date(2026, 6, 29, 12, 0);
    const i18n = fakeI18n({
      'date_format.day_full': {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      },
    });
    const formatted = formatDayDate(date, i18n, 'en-US');
    expect(formatted).toMatch(/2026/);
    expect(formatted).toMatch(/July/);
  });

  it('falls back to a sensible default when date_format.day_full is missing', () => {
    const date = new Date(2026, 6, 29, 12, 0);
    const formatted = formatDayDate(date, fakeI18n(), 'en-US');
    expect(formatted).toMatch(/2026/);
  });
});
