// ------------------------------------
// DAY GROUPING
// ------------------------------------
// Splits an already-sorted item list into per-calendar-day groups, so the
// timeline can render each day as its own independent segment (own header,
// own line) instead of one continuous line across the whole history window.

function isSameCalendarDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function dayKey(date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

// Groups items by calendar day, preserving their existing order. Assumes
// items are already sorted so each day's items are contiguous (true for
// both the newest-first default order and a caller-reversed oldest-first
// order) — it does not re-sort.
export function groupItemsByDay(items) {
  const groups = [];
  let current = null;

  for (const item of items) {
    const key = dayKey(item.time);
    if (!current || current.key !== key) {
      current = { key, date: item.time, items: [] };
      groups.push(current);
    }
    current.items.push(item);
  }

  return groups;
}

// "Today" / "Yesterday" / capitalized weekday name for older days.
export function formatDayLabel(date, i18n, langCode, now = new Date()) {
  if (isSameCalendarDay(date, now)) return i18n.t('ui.today');

  const yesterday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - 1
  );
  if (isSameCalendarDay(date, yesterday)) return i18n.t('ui.yesterday');

  const options = i18n.t('date_format.weekday');
  const opts =
    options && typeof options === 'object' ? options : { weekday: 'long' };
  const label = date.toLocaleDateString(langCode, opts);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// Long-form date (e.g. "July 29, 2026") for the day header, next to the
// relative label from formatDayLabel().
export function formatDayDate(date, i18n, langCode) {
  const options = i18n.t('date_format.day_full');
  const opts =
    options && typeof options === 'object'
      ? options
      : { day: 'numeric', month: 'long', year: 'numeric' };
  return date.toLocaleDateString(langCode, opts);
}
