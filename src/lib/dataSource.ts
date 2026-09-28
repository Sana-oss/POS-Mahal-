/**
 * Mahall POS - Data Source Router
 * ---------------------------------------------------------------------------
 * Single decision point for every write in the app:
 *
 *   local-only mode (no VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)
 *       -> the synchronous, transaction-safe logic in lib/store.ts
 *          (localStorage, demo seed data)
 *
 *   cloud mode (Supabase configured + signed in)
 *       -> the RPCs in services/cloudSync.ts, which persist to Postgres and
 *          return the rows the database computed. Those results are then
 *          pushed into the lib/store.ts cache so the React tree keeps rendering
 *          from one place.
 *
 * Every function is async, so callers must await it. In local-only mode the
 * promise resolves on the microtask queue, which keeps a single code path in
 * the UI instead of two divergent branches per screen.
 */

import { store } from './store';
import { cartStore } from './cartStore';
import { isSupabaseConfigured } from './supabase';
import * as cloud from '../services/cloudSync';
import { startRealtime, stopRealtime } from '../services/realtime';
import { Customer, CustomerPayment, Expense, Product, Purchase, Sale, Settings } from '../types';

export type SyncState = 'local' | 'loading' | 'ready' | 'error';

export interface SyncStatus {
  state: SyncState;
  error: string | null;
  lastSyncAt: number | null;
  /** Number of in-flight cloud writes (drives the "saving" hint in the header). */
  pending: number;
}

let boundShopId: string | null = null;

let status: SyncStatus = {
  state: isSupabaseConfigured ? 'loading' : 'local',
  error: null,
  lastSyncAt: null,
  pending: 0,
};

const statusListeners = new Set<() => void>();

function patchStatus(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch };
  statusListeners.forEach((listener) => listener());
}

export function getSyncStatus(): SyncStatus {
  return status;
}

export function subscribeSyncStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}

/** True only when Supabase is configured *and* a shop is bound to this session. */
export function isCloudActive(): boolean {
  return isSupabaseConfigured && boundShopId !== null;
}

/**
 * True only in a genuine local-only deployment, i.e. Supabase was never configured.
 *
 * Writes must branch on THIS, not on isCloudActive(). Those two differ in one real
 * state: a cloud session whose bootstrap has not completed yet is configured but
 * unbound, and isCloudActive() reports false for it. Branching on that sent such a
 * write to the local store, which reports success to the cashier while persisting
 * nothing. Here the same write falls through to requireShopId() and fails loudly.
 *
 * The binding is deliberately kept across a failed bootstrap so the retry button
 * (App.tsx -> refreshFromCloud, which no-ops without it) can work, so this state
 * persists until a retry succeeds or the session is unbound.
 */
function isLocalOnly(): boolean {
  return !isSupabaseConfigured;
}

export function getBoundShopId(): string | null {
  return boundShopId;
}

function requireShopId(): string {
  if (!boundShopId) {
    throw new Error('لم يتم ربط المتجر بالسحابة بعد. أعد تحميل الصفحة ثم حاول مجدداً.');
  }
  return boundShopId;
}

/**
 * Turns a refusal raised by the database into something a cashier can act on.
 *
 * The RPCs raise plain English, because the migration files are the reference for
 * the rule and English keeps them readable. A shopkeeper reading
 * "Credit limit exceeded for Sanad (Owes: 51.00, Limit: 50.00)" learns nothing
 * about what to do next, so the business rules are mapped to Arabic here. The
 * original text is kept for anything unmapped, and the mapping is deliberately
 * substring-based: the exact wording of a server message should not be allowed to
 * silently change what the cashier is told.
 */
const REFUSAL_TRANSLATIONS: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [
    /Credit limit exceeded for (.*?) \(Owes: ([\d.]+), Limit: ([\d.]+)\)/i,
    (m) =>
      `تجاوز الحد الائتماني للعميل ${m[1]}. ` +
      `المستحق ${m[2]} والحد ${m[3]}. ` +
      `سجّل دفعة للعميل أو ارفع حدّه الائتماني.`,
  ],
  [
    /Insufficient stock for product (.*?) \(Available: ([\d.]+)\)/i,
    (m) => `الكمية المتوفرة من ${m[1]} هي ${m[2]} فقط.`,
  ],
  [/Product (.*?) not found/i, (m) => `المنتج ${m[1]} غير موجود.`],
  [/Quantity must be greater than zero/i, () => 'الكمية يجب أن تكون أكبر من الصفر.'],
  [/Customer is required for debt sales/i, () => 'البيع الآجل يتطلب تحديد عميل.'],
  [/Customer not found/i, () => 'العميل المحدد غير موجود في سجل الديون.'],
  [/Sale has no items/i, () => 'لا يمكن إتمام فاتورة فارغة.'],
  [/Invalid payment method/i, () => 'طريقة الدفع غير صحيحة.'],
  [/Unauthorized shop access/i, () => 'لا تملك صلاحية الوصول إلى بيانات هذا المتجر.'],
  [
    /Payment amount exceeds current balance/i,
    () => 'المبلغ المدفوع أكبر من رصيد العميل الحالي.',
  ],
];

export function translateRefusal(message: string): string {
  for (const [pattern, build] of REFUSAL_TRANSLATIONS) {
    const m = message.match(pattern);
    if (m) return build(m);
  }
  return message;
}

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return translateRefusal(error.message);
  return fallback;
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

/** Pull the whole shop into the cache. Called once per sign-in. */
export async function bootstrapFromCloud(shopId: string): Promise<void> {
  boundShopId = shopId;
  patchStatus({ state: 'loading', error: null });

  try {
    await cloud.probeSoftDelete();
    const snapshot = await cloud.fetchSnapshot(shopId, store.getState().settings);
    store.hydrateFromCloud(snapshot);
    patchStatus({ state: 'ready', error: null, lastSyncAt: Date.now() });

    // Another register's writes now refresh this one, so a second cashier no
    // longer has to reload to see them. Started only after a successful
    // bootstrap, so a failed sign-in leaves no live subscription behind.
    startRealtime(shopId, () => refreshOperationalSlices());
  } catch (error) {
    const message = messageOf(error, 'تعذر تحميل بيانات المتجر من السحابة.');
    patchStatus({ state: 'error', error: message });
    throw new Error(message);
  }
}

/**
 * Re-pull the slices a remote change can have invalidated.
 *
 * Deliberately narrower than bootstrapFromCloud: categories and shop settings
 * are not part of the live-sync watch list, so a second register completing a
 * sale should not force this one to re-read its own settings.
 *
 * Throws on failure so the caller can log; realtime.ts swallows it, because a
 * failed background re-pull must not disturb a register that is already working.
 */
export async function refreshOperationalSlices(): Promise<void> {
  const shopId = requireShopId();
  const [products, customers, sales, purchases, expenses, payments, movements] =
    await Promise.all([
      cloud.fetchProducts(shopId),
      cloud.fetchCustomers(shopId),
      cloud.fetchSales(shopId),
      cloud.fetchPurchases(shopId),
      cloud.fetchExpenses(shopId),
      cloud.fetchCustomerPayments(shopId),
      cloud.fetchStockMovements(shopId),
    ]);

  store.applyCloudSlices({
    products,
    customers,
    sales,
    purchases,
    expenses,
    customerPayments: payments,
    stockMovements: movements,
  });

  patchStatus({ state: 'ready', error: null, lastSyncAt: Date.now() });
}

/** Manual "reload from cloud" (settings screen / retry button). */
export async function refreshFromCloud(): Promise<void> {
  if (!boundShopId) return;
  await bootstrapFromCloud(boundShopId);
}

/**
 * Teardown for a session that ended without an explicit signOut() call — an
 * expired or revoked token, or a sign-out from another tab.
 *
 * unbindShop() covers the deliberate sign-out path and additionally wipes the
 * cached shop data. This is the lighter path: the data cache is about to be
 * replaced by the next bootstrap anyway, but the live subscription and the
 * in-progress sale must not survive, or the next cashier inherits a cart priced
 * and costed from the previous shop.
 */
export function onSessionEnded(): void {
  stopRealtime();
  cartStore.clear();
}

/** Unbind the shop and wipe the cache (sign-out). */
export function unbindShop(): void {
  boundShopId = null;
  // Drop the live subscription first: a change arriving after the shop is
  // unbound would otherwise re-pull a shop this session no longer owns.
  stopRealtime();
  store.clearPersistedData();
  // The in-progress cart must go too. Each CartItem holds a frozen snapshot of
  // a product (selling_price, average_cost, stock), so a cart left over from
  // the previous shop would be checked out against the new shop's stock.
  cartStore.clear();
  patchStatus({
    state: isSupabaseConfigured ? 'loading' : 'local',
    error: null,
    lastSyncAt: null,
    pending: 0,
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function refreshInventoryCache() {
  const { products, movements } = await cloud.refreshInventory(requireShopId());
  store.applyCloudSlices({ products, stockMovements: movements });
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function addProduct(data: Parameters<typeof store.addProduct>[0]): Promise<Product> {
  if (isLocalOnly()) return store.addProduct(data);
  return write('تعذر إضافة المنتج إلى السحابة.', async () => {
    const product = await cloud.createProduct(requireShopId(), data);
    await refreshInventoryCache();
    return product;
  });
}

export async function updateProduct(
  id: string,
  updates: Parameters<typeof store.updateProduct>[1]
): Promise<Product> {
  if (isLocalOnly()) return store.updateProduct(id, updates);
  return write('تعذر تحديث المنتج في السحابة.', async () => {
    const cached = store.getState().products.find((p) => p.id === id);
    if (!cached) {
      throw new Error('المنتج غير موجود في المخزون المحمل. أعد تحميل المخزون من السحابة.');
    }
    const product = await cloud.updateProduct(requireShopId(), id, updates, cached.stock_quantity);
    await refreshInventoryCache();
    return product;
  });
}

export async function executeSale(params: Parameters<typeof store.executeSale>[0]): Promise<Sale> {
  if (isLocalOnly()) return store.executeSale(params);
  return write('تعذر تسجيل الفاتورة في السحابة.', async () => {
    const shopId = requireShopId();
    const sale = await cloud.executeSale(shopId, {
      items: params.items,
      paymentMethod: params.paymentMethod,
      customerId: params.customerId ?? null,
      receivedAmount: params.receivedAmount ?? null,
      notes: params.notes,
    });

    // Postgres recalculated stock, average cost and the customer balance.
    const fresh = await cloud.refreshAfterSale(shopId);
    store.applyCloudSlices({
      products: fresh.products,
      customers: fresh.customers,
      stockMovements: fresh.movements,
      sales: fresh.sales,
    });

    return sale;
  });
}

export async function executePurchase(
  params: Parameters<typeof store.executePurchase>[0]
): Promise<Purchase> {
  if (isLocalOnly()) return store.executePurchase(params);
  return write('تعذر تسجيل عملية الشراء في السحابة.', async () => {
    const shopId = requireShopId();
    const purchase = await cloud.executePurchase(shopId, params);

    const fresh = await cloud.refreshAfterPurchase(shopId);
    store.applyCloudSlices({
      products: fresh.products,
      stockMovements: fresh.movements,
      purchases: fresh.purchases,
    });

    return purchase;
  });
}

export async function addCustomer(
  data: Parameters<typeof store.addCustomer>[0]
): Promise<Customer> {
  if (isLocalOnly()) return store.addCustomer(data);
  return write('تعذر حفظ العميل في السحابة.', async () => {
    const customer = await cloud.createCustomer(requireShopId(), data);
    store.upsertCloudCustomer(customer);
    return customer;
  });
}

export async function recordDebtPayment(
  params: Parameters<typeof store.recordDebtPayment>[0]
): Promise<CustomerPayment> {
  if (isLocalOnly()) return store.recordDebtPayment(params);
  return write('تعذر تسجيل السداد في السحابة.', async () => {
    const shopId = requireShopId();
    const { payment } = await cloud.recordCustomerPayment(shopId, params);

    const fresh = await cloud.refreshAfterPayment(shopId);
    store.applyCloudSlices({ customers: fresh.customers, customerPayments: fresh.payments });

    return payment;
  });
}

export async function addExpense(data: Parameters<typeof store.addExpense>[0]): Promise<Expense> {
  if (isLocalOnly()) return store.addExpense(data);
  return write('تعذر حفظ المصروف في السحابة.', async () => {
    const expense = await cloud.createExpense(requireShopId(), data);
    store.prependCloudExpense(expense);
    return expense;
  });
}

export async function deleteExpense(id: string): Promise<void> {
  if (isLocalOnly()) {
    store.deleteExpense(id);
    return;
  }
  await write('تعذر حذف المصروف من السحابة.', async () => {
    await cloud.deleteExpense(requireShopId(), id);
    store.removeCloudExpense(id);
  });
}

export async function updateSettings(
  patch: Parameters<typeof store.updateSettings>[0]
): Promise<Settings> {
  if (isLocalOnly()) {
    store.updateSettings(patch);
    return store.getState().settings;
  }
  return write('تعذر حفظ الإعدادات في السحابة.', async () => {
    const merged: Settings = { ...store.getState().settings, ...patch };
    const saved = await cloud.upsertSettings(requireShopId(), merged);
    store.applyCloudSettings(saved);
    return saved;
  });
}

/** Restoring the demo seed only makes sense for the local-only database. */
export function resetToDefault(): void {
  // isLocalOnly(), not isCloudActive(): in the configured-but-unbound state the
  // demo seed would otherwise be written into a cloud app's cache and shown to
  // the cashier as real stock.
  if (!isLocalOnly()) {
    throw new Error(
      'استعادة البيانات النموذجية متاحة في الوضع المحلي فقط. بيانات متجرك محفوظة في السحابة ولا يمكن استبدالها.'
    );
  }
  store.resetToDefault();
}


export async function deleteProduct(id: string): Promise<void> {
  if (isLocalOnly()) {
    store.deleteProduct(id);
    return;
  }
  await write('تعذر حذف المنتج من السحابة.', async () => {
    await cloud.deleteProduct(requireShopId(), id);
    await refreshInventoryCache();
  });
}


/**
 * True when the database answered with an error of its own, rather than the
 * request failing to reach it.
 *
 * PostgREST reports a raised exception as a structured error carrying a SQLSTATE
 * - P0001 for RAISE EXCEPTION, 23505 for a unique violation and so on. A
 * transport failure has no code at all: it is a TypeError reading "fetch failed".
 *
 * The distinction matters because App.tsx gates the entire POS behind
 * `sync.state !== 'ready'`. Treating a business refusal as a sync failure put a
 * full-screen "could not load shop data" wall in front of the cashier because
 * one customer was over their credit limit, hiding the message that explained
 * why. The database answering at all proves the connection is healthy, so only a
 * missing SQLSTATE is treated as the cloud being unreachable.
 */
export function isDatabaseRejection(error: unknown): boolean {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  if (typeof code !== 'string') return false;
  // SQLSTATE class 08 is connection exceptions; those ARE transport failures and
  // must keep the error state. Everything else is the database answering.
  if (code.startsWith('08')) return false;
  return /^(P\d{4}|[0-9A-Z]{5})$/.test(code);
}

/** Wraps a cloud write: tracks it in the sync status and stamps success/failure. */
async function write<T>(fallbackMessage: string, task: () => Promise<T>): Promise<T> {
  patchStatus({ pending: status.pending + 1, error: null });
  try {
    const result = await task();
    patchStatus({ state: 'ready', error: null, lastSyncAt: Date.now() });
    return result;
  } catch (error) {
    // A refusal is not an outage. Leave the sync state alone so the app stays
    // usable and the caller can show the real reason; only a failure to reach the
    // database is allowed to gate the POS.
    if (isDatabaseRejection(error)) {
      throw new Error(messageOf(error, 'تعذر إتمام العملية.'));
    }
    patchStatus({ state: 'error', error: messageOf(error, fallbackMessage) });
    throw error;
  } finally {
    patchStatus({ pending: Math.max(0, status.pending - 1) });
  }
}
