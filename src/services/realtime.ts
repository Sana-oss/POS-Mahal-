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

/**
 * Tables that must NOT carry a `shop_id=eq.<id>` client filter.
 *
 * sale_items and purchase_items have no shop_id column at all - they are scoped
 * through their parent:
 *
 *   sale_items      USING (sale_id      IN (SELECT id FROM sales     WHERE shop_id = get_user_shop_id()))
 *   purchase_items  USING (purchase_id  IN (SELECT id FROM purchases WHERE shop_id = get_user_shop_id()))
 *
 * Filtering them by shop_id asks Postgres for a column that does not exist. The
 * realtime server rejects that binding, and because a channel fails as a unit
 * the subscription never becomes usable - so NO table delivered anything and a
 * second register silently went stale. Nine tables subscribed, zero events
 * delivered, and nothing logged anywhere.
 *
 * Dropping the filter is safe: it was a narrowing, never the security boundary.
 * Row delivery is decided by RLS, and both tables already have the policies
 * above, which resolve the shop through the parent row.
 */
const UNFILTERED_TABLES = new Set<string>(['sale_items', 'purchase_items']);

/**
 * The subscription bindings for a shop, shared so the channel and any
 * verification probe configure themselves identically. A probe that omits the
 * filters the app actually uses proves nothing about the app.
 */
export function buildBindings(shopId: string) {
  return WATCHED_TABLES.map((table) => ({
    table,
    filter: UNFILTERED_TABLES.has(table) ? undefined : `shop_id=eq.${shopId}`,
  }));
}

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

  for (const { table, filter } of buildBindings(shopId)) {
    ch.on(
      'postgres_changes',
      filter ? { event: '*', schema: 'public', table, filter } : { event: '*', schema: 'public', table },
      () => scheduleReload(s)
    );
  }

  // The status callback is not decoration. A channel that never subscribes used to
  // fail completely silently: no log, no UI, and the register simply went stale
  // with no way to tell that from "nobody sold anything".
  ch.subscribe((status) => {
    if (status === 'SUBSCRIBED') return;
    console.error(
      `[realtime] live sync channel for shop ${shopId} reported "${status}". ` +
        `Another register's sales will not appear until this recovers. ` +
        `A CHANNEL_ERROR here usually means a subscription filter names a column ` +
        `the table does not have, or the table is not in the supabase_realtime ` +
        `publication.`
    );
  });
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
