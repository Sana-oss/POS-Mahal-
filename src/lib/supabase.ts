import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Supabase is OPTIONAL.
 *
 * When VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are supplied the app runs in
 * cloud mode: auth + multi-shop RLS via Supabase. When they are absent the app
 * runs in local-only mode and every feature still works, because the business
 * data lives in localStorage (see lib/store.ts).
 *
 * createClient() throws "supabaseUrl is required." on an empty URL, so the
 * client must never be constructed unconditionally - that crashes the app at
 * import time, before React ever renders.
 */
export const isSupabaseConfigured = Boolean(
  import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY
);

/**
 * null in local-only mode.
 *
 * The password-recovery flow relies on the SDK's `detectSessionInUrl`, which
 * defaults to true and reads the reset token out of the URL fragment. It is not
 * passed explicitly: in @supabase/supabase-js 2.117 the runtime accepts it but
 * `SupabaseClientOptions` does not declare it, so passing it fails `tsc`. Leaving
 * it to the default is the only option the type system allows here, and
 * src/lib/supabaseConfig.test.ts pins the behaviour so a future upgrade that
 * changes the default is caught rather than discovered when a reset link opens
 * the app and silently does nothing.
 */
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)
  : null;

/**
 * For call sites that only run in cloud mode. Throws a descriptive error instead
 * of failing with a null dereference.
 */
export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable cloud mode.'
    );
  }
  return supabase;
}

