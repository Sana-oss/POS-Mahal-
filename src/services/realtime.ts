/**
 * Mahall POS - Live sync between registers
 * ---------------------------------------------------------------------------
 * A second register (another cashier, another device, another tab) used to see
 * another cashier's writes only after a manual refresh or after its own next
 * write, which re-pulled the affected slices. This subscribes to Postgres change
 * feeds for the business tables and re-pulls the render cache when they move.
 *
 * Two deliberate design choices:
 *
 * 1. RE-PULL, DON'T PATCH. A single sale touches products, sales, sale_items,
 *    stock_movements and customers in one transaction, and only the server knows
 *    the resulting weighted average cost, invoice number and customer balance.
 *    Applying the raw change rows would re-introduce exactly the client-side
 *    financial computation this app is built to avoid, so the change is treated
 *    purely as a signal to re-read.
 *
 * 2. DEBOUNCE. One transaction produces one event per table, so a single sale
 *    arrives as a burst of ~5 callbacks. Without coalescing, each one would pull
 *    the full snapshot.
 *
 * Delivery is scoped by RLS: every subscribed table has a
 * `shop_id = get_user_shop_id()` policy, so a client only receives changes for
 * the shop its own token resolves to. The filter below is a further narrowing,
 * not the security boundary.
 */

import { supabase } from '../lib/supabase';

/** Tables whose movement means the render cache is stale. */
const WATCHED_TABLES = [
  'products',
  'sales',
  'sale_items',
  'purchases',
  'purchase_items',
  'customers',
  'customer_payments',
  'stock_movements',
  'expenses',
] as const;

/** Coalesce the per-table burst from a single transaction into one re-pull. */
const DEBOUNCE_MS = 400;

type Channel = ReturnType<NonNullable<typeof supabase>['channel']>;

/**
 * One live-subscription session.
 *
 * The debounce flags used to be module globals, but they belong to a *session*.
 * Sharing them meant that re-binding mid-pull (a shop switch, a re-auth) left the
 * previous pull's `finally` clearing the `inFlight` of the new pull, so the next
 * change started a second concurrent snapshot pull. Scoping the flags to the
 * session and ignoring any session that is no longer current makes a stale
 * completion harmless.
 */
interface Session {
  channel: Channel | null;
  timer: ReturnType<typeof setTimeout> | null;
  onChange: (() => void) | null;
  inFlight: boolean;
  queuedWhileInFlight: boolean;
}

let session: Session | null = null;

/**
 * Start listening for another register's writes.
 *
 * @param shopId  the bound shop; also used to narrow the change filter
 * @param handler called (debounced, at most once per burst) when anything moved
 */
export function startRealtime(shopId: string, handler: () => void): void {
  if (!supabase) return;
  stopRealtime();

  const s: Session = {
    channel: null,
    timer: null,
    onChange: handler,
    inFlight: false,
    queuedWhileInFlight: false,
  };
  session = s;

  const ch = supabase.channel(`shop:${shopId}`);

  for (const table of WATCHED_TABLES) {
    ch.on(
      'postgres_changes',
      { event: '*', schema: 'public', table, filter: `shop_id=eq.${shopId}` },
      () => scheduleReload(s)
    );
  }

  ch.subscribe();
  s.channel = ch;
}

/** Stop listening. Safe to call when not started. */
export function stopRealtime(): void {
  const s = session;
  // Dropping the reference is what invalidates the session: a pull still settling
  // from it can only mutate its own detached flags, and any scheduleReload() it
  // triggers is ignored as stale.
  session = null;
  if (!s) return;

  if (s.timer) {
    clearTimeout(s.timer);
    s.timer = null;
  }
  s.onChange = null;

  if (s.channel && supabase) {
    // removeChannel is async; the caller does not need to await it, and the
    // channel is detached from the client immediately so no further callback
    // can reach the (now null) handler.
    void supabase.removeChannel(s.channel);
    s.channel = null;
  }
}

function scheduleReload(s: Session): void {
  // A change arriving on a channel that has since been stopped or replaced.
  if (s !== session || !s.onChange) return;

  if (s.inFlight) {
    // A re-pull is already running. Remember that more arrived so exactly one
    // follow-up runs when it finishes, rather than queueing one per event.
    s.queuedWhileInFlight = true;
    return;
  }

  if (s.timer) clearTimeout(s.timer);
  s.timer = setTimeout(() => {
    s.timer = null;
    void runReload(s);
  }, DEBOUNCE_MS);
}

async function runReload(s: Session): Promise<void> {
  // The session may have been stopped or replaced between the debounce firing and
  // this pull starting.
  if (s !== session || !s.onChange) return;

  s.inFlight = true;
  try {
    await s.onChange();
  } catch {
    // A failed background re-pull must never break the register that is already
    // working. The next change, or the manual refresh button, retries.
  } finally {
    s.inFlight = false;
    if (s.queuedWhileInFlight) {
      s.queuedWhileInFlight = false;
      scheduleReload(s);
    }
  }
}
