import { describe, it, expect } from 'vitest';
import { validateNewPassword, MIN_PASSWORD_LENGTH } from './password';

describe('validateNewPassword', () => {
  it('accepts a long enough matching pair', () => {
    expect(validateNewPassword('secret123', 'secret123')).toBeNull();
  });

  it('rejects an empty password', () => {
    expect(validateNewPassword('', '')).toMatch(/اكتب/);
  });

  it('rejects a password under the Supabase minimum', () => {
    const short = 'a'.repeat(MIN_PASSWORD_LENGTH - 1);
    expect(validateNewPassword(short, short)).toMatch(/قصيرة/);
  });

  it('accepts one exactly at the minimum', () => {
    const exact = 'a'.repeat(MIN_PASSWORD_LENGTH);
    expect(validateNewPassword(exact, exact)).toBeNull();
  });

  it('rejects a mismatch', () => {
    expect(validateNewPassword('secret123', 'secret124')).toMatch(/غير متطابقتين/);
  });

  it('reports the length problem before the mismatch', () => {
    // Both are wrong; the cashier should hear the one they can act on first.
    const short = 'a'.repeat(3);
    expect(validateNewPassword(short, 'totally-different')).toMatch(/قصيرة/);
  });

  it('keeps the rule equal to what Supabase enforces', () => {
    // Supabase's minimum is 6. If this drifts, the client accepts a password
    // the server then refuses, and the cashier gets a round trip for nothing.
    expect(MIN_PASSWORD_LENGTH).toBe(6);
  });
});
