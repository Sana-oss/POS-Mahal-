// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * A production build with no Supabase configuration must stop.
 *
 * Without this, a deploy that forgot its environment variables runs local-only
 * and silently: the POS looks healthy, sales complete, and every one is written
 * to a single browser's localStorage instead of the shop's database. For a
 * multi-shop deployment that is the worst possible failure, because RLS is the
 * only thing separating one owner's books from another's, and a local-only
 * deploy has no RLS at all - the data is simply gone when that browser's cache
 * is cleared.
 *
 * So this asserts the guard is in place, in the one place that matters: ahead of
 * everything else, and gated on PROD so local development is unaffected.
 */

const configured = vi.hoisted(() => ({ value: false }));

vi.mock('../lib/supabase', () => ({
  get isSupabaseConfigured() {
    return configured.value;
  },
  get supabase() {
    return configured.value ? { auth: { getSession: vi.fn() } } : null;
  },
  requireSupabase: () => null,
}));

vi.mock('../lib/dataSource', () => ({
  bootstrapFromCloud: vi.fn().mockResolvedValue(undefined),
  refreshFromCloud: vi.fn().mockResolvedValue(undefined),
  unbindShop: vi.fn(),
  onSessionEnded: vi.fn(),
  isCloudActive: () => false,
  getSyncStatus: () => ({ state: 'ready', pending: 0, error: null, lastSyncAt: 0 }),
  subscribeSyncStatus: () => () => {},
}));

/** Read the guard out of App.tsx without mounting the whole app. */
async function readAppSource() {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  return readFileSync(join(process.cwd(), 'src', 'App.tsx'), 'utf8');
}

describe('production deploy guard', () => {
  beforeEach(() => {
    configured.value = false;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('App stops when a production build has no cloud configuration', async () => {
    const source = await readAppSource();
    expect(source).toMatch(/import\.meta\.env\.PROD\s*&&\s*!\s*isSupabaseConfigured/);
  });

  it('the guard names the two variables needed to fix it', async () => {
    const source = await readAppSource();
    expect(source).toMatch(/VITE_SUPABASE_URL/);
    expect(source).toMatch(/VITE_SUPABASE_ANON_KEY/);
  });

  it('the guard runs before the sign-in wall, not after', async () => {
    // After the wall would be unreachable: with no configuration the app never
    // renders LoginView, so a later guard would never fire.
    const source = await readAppSource();
    const guard = source.indexOf('import.meta.env.PROD && !isSupabaseConfigured');
    const signInWall = source.indexOf('if (isSupabaseConfigured && !session)');
    expect(guard).toBeGreaterThan(-1);
    expect(signInWall).toBeGreaterThan(-1);
    expect(guard, 'the deploy guard must precede the sign-in wall').toBeLessThan(signInWall);
  });

  it('is scoped to production so local development still works offline', async () => {
    // The guard must be conjoined with PROD, not unconditional. An unconditional
    // early return would break the documented local-only mode, where running
    // without Supabase is a supported configuration.
    const source = await readAppSource();
    expect(source).toMatch(/import\.meta\.env\.PROD\s*&&\s*!\s*isSupabaseConfigured/);
    expect(source).not.toMatch(/^\s*if \(!isSupabaseConfigured\)\s*\{?\s*$/m);
  });
});
