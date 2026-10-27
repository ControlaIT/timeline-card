import { describe, it, expect } from 'vitest';
import { escapeHtml } from '../src/html-escape.js';

describe('escapeHtml', () => {
  it('neutralises markup from a logbook message or a state', () => {
    expect(escapeHtml('<img src=x onerror="alert(1)">')).toBe(
      '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'
    );
  });

  it("can't break out of a quoted attribute", () => {
    expect(escapeHtml(`x" onclick='y'`)).toBe('x&quot; onclick=&#39;y&#39;');
  });

  it('escapes ampersands first, without double-escaping its own output', () => {
    expect(escapeHtml('a & b &lt;')).toBe('a &amp; b &amp;lt;');
  });

  it('leaves plain text, accents and units untouched', () => {
    expect(escapeHtml('Heat - 16.0 °C · Habitación 204')).toBe(
      'Heat - 16.0 °C · Habitación 204'
    );
  });

  it('renders null and undefined as empty, and stringifies numbers', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(21.5)).toBe('21.5');
  });
});
