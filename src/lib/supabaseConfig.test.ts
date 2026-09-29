import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The password-recovery flow depends on Supabase parsing the reset token out of
 * the URL fragment. When that is off, the emailed link opens the app and does
 * nothing at all - no error, no prompt, just the login screen - which reads as
 * "the link is broken" rather than "we never read the token".
 *
 * No other test can catch a regression here: the recovery tests drive the auth
 * event directly rather than arriving through a URL. So this checks the actual
 * installed SDK default, which is the thing the feature rests on.
 *
 * The option is deliberately not passed explicitly. In @supabase/supabase-js
 * 2.117 the runtime accepts `detectSessionInUrl` but `SupabaseClientOptions` does
 * not declare it, so passing it fails `tsc`. Asserting the shipped default is
 * the honest check; asserting a string we control would prove nothing.
 */

const sdk = readFileSync(
  join(process.cwd(), 'node_modules', '@supabase', 'supabase-js', 'dist', 'index.cjs'),
  'utf8'
);

const ourClient = readFileSync(join(process.cwd(), 'src', 'lib', 'supabase.ts'), 'utf8');

/**
 * The SDK's own default block, and nothing else.
 *
 * A bare `/detectSessionInUrl:\s*true/` over the whole file is satisfied by the
 * JSDoc examples further down, which mention the option as it can be passed. That
 * version of this test stayed green after the real default was flipped to false,
 * which is the failure mode this file exists to prevent. So the default is read
 * out of the actual declaration.
 */
function defaultAuthOptions(): string {
  const start = sdk.indexOf('const DEFAULT_AUTH_OPTIONS');
  expect(start, 'DEFAULT_AUTH_OPTIONS not found in the installed SDK').toBeGreaterThan(-1);
  const open = sdk.indexOf('{', start);
  const close = sdk.indexOf('}', open);
  return sdk.slice(open, close + 1);
}

describe('supabase client configuration', () => {
  it('the installed SDK enables session detection from the URL by default', () => {
    // This is the behaviour the recovery link depends on. If an upgrade flips it,
    // this fails and the reset flow is fixed rather than shipped broken.
    expect(defaultAuthOptions()).toMatch(/detectSessionInUrl:\s*true/);
  });

  it('the SDK default is not merely mentioned in documentation', () => {
    // Guards the guard: a whole-file regex would pass on the JSDoc examples even
    // if the declaration said false.
    expect(defaultAuthOptions()).not.toMatch(/detectSessionInUrl:\s*false/);
  });

  it('does not disable URL session detection in our client', () => {
    expect(ourClient).not.toMatch(/detectSessionInUrl:\s*false/);
  });

  it('passes no auth options that would switch the default off', () => {
    // e.g. an `auth: { ... }` block carrying flowType or storage overrides.
    expect(ourClient).not.toMatch(/createClient\([^)]*,\s*\{/s);
  });

  it('builds the client from the two env values', () => {
    expect(ourClient).toMatch(/VITE_SUPABASE_URL/);
    expect(ourClient).toMatch(/VITE_SUPABASE_ANON_KEY/);
  });

  it('stays null in local-only mode rather than constructing a broken client', () => {
    // createClient throws on an empty URL at import time, which would crash the
    // app before React ever renders.
    expect(ourClient).toMatch(/isSupabaseConfigured\s*\?/);
  });
});
