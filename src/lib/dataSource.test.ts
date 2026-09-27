import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeProduct, makeCustomer, makeSale, makeExpense } from '../test/fixtures';
import type { CustomerPayment, Purchase, Settings, StockMovement } from '../types';

/**
 * dataSource.ts is the single decision point for every write in the app, and had no
 * coverage: SettingsView.test.tsx mocks it out entirely. Each function decides
 * between the local store and a Postgres RPC, and the decision is what keeps a
 * cashier's money correct, so the branch itself is what these tests pin.
 *
 * The real `lib/store.ts` is used unmocked -- the point is to assert what actually
 * lands in the render cache, not to re-assert the store's own logic.
 */

const cfg = vi.hoisted(() => ({ configured: true }));

const cloud = vi.hoisted(() => ({
  probeSoftDelete: vi.fn(),
  fetchSnapshot: vi.fn(),
  fetchProducts: vi.fn(),
  fetchCategories: vi.fn(),
  fetchCustomers: vi.fn(),
  fetchExpenses: vi.fn(),
  fetchCustomerPayments: vi.fn(),
  fetchStockMovements: vi.fn(),
  fetchSales: vi.fn(),
  fetchPurchases: vi.fn(),
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
  deleteProduct: vi.fn(),
  createCustomer: vi.fn(),
  createExpense: vi.fn(),
  deleteExpense: vi.fn(),
  upsertSettings: vi.fn(),
  executeSale: vi.fn(),
  executePurchase: vi.fn(),
  recordCustomerPayment: vi.fn(),
  refreshAfterSale: vi.fn(),
  refreshAfterPurchase: vi.fn(),
  refreshAfterPayment: vi.fn(),
  refreshInventory: vi.fn(),
}));

const cart = vi.hoisted(() => ({ clear: vi.fn() }));
const rt = vi.hoisted(() => ({ startRealtime: vi.fn(), stopRealtime: vi.fn() }));

vi.mock('../services/cloudSync', () => cloud);
vi.mock('../services/realtime', () => rt);
vi.mock('./cartStore', () => ({ cartStore: cart }));
vi.mock('./supabase', () => ({
  // A getter: dataSource reads this on every isCloudActive() call, so a test can
  // switch between local-only and cloud-capable without re-importing the module.
  get isSupabaseConfigured() {
    return cfg.configured;
  },
  supabase: { auth: {} },
  requireSupabase: () => ({ auth: {} }),
}));

import { store } from './store';
import * as ds from './dataSource';

const SHOP = 'shop-test-1';

/** Resolve every read the bootstrap and slice-refresh paths call. */
function stubEmptyShop() {
  cloud.probeSoftDelete.mockResolvedValue(true);
  cloud.fetchSnapshot.mockResolvedValue({});
  cloud.fetchProducts.mockResolvedValue([]);
  cloud.fetchCustomers.mockResolvedValue([]);
  cloud.fetchSales.mockResolvedValue([]);
  cloud.fetchPurchases.mockResolvedValue([]);
  cloud.fetchExpenses.mockResolvedValue([]);
  cloud.fetchCustomerPayments.mockResolvedValue([]);
  cloud.fetchStockMovements.mockResolvedValue([]);
}

async function bindShop(shopId = SHOP) {
  await ds.bootstrapFromCloud(shopId);
}

beforeEach(() => {
  cfg.configured = true;
  store.resetToDefault();
  for (const fn of Object.values(cloud)) fn.mockReset();
  cart.clear.mockReset();
  rt.startRealtime.mockReset();
  rt.stopRealtime.mockReset();
  stubEmptyShop();
});

afterEach(() => {
  // Clears boundShopId so the next test starts unbound.
  ds.unbindShop();
});

describe('dataSource - cloud activation', () => {
  it('is not cloud-active until a shop is bound', () => {
    // Supabase being configured is not enough: without a shop there is nothing to
    // scope RLS to, so every call would have to guess a tenant.
    expect(ds.isCloudActive()).toBe(false);
    expect(ds.getBoundShopId()).toBeNull();
  });

  it('binds the shop and becomes cloud-active after a successful bootstrap', async () => {
    await bindShop();

    expect(ds.getBoundShopId()).toBe(SHOP);
    expect(ds.isCloudActive()).toBe(true);
  });

  it('reports ready and stamps a sync time once the snapshot lands', async () => {
    await bindShop();

    const status = ds.getSyncStatus();
    expect(status.state).toBe('ready');
    expect(status.error).toBeNull();
    expect(status.lastSyncAt).toBeGreaterThan(0);
  });

  it('starts the live subscription only after a successful bootstrap', async () => {
    await bindShop();

    expect(rt.startRealtime).toHaveBeenCalledTimes(1);
    expect(rt.startRealtime.mock.calls[0][0]).toBe(SHOP);
  });

  it('surfaces the server message and starts no subscription when bootstrap fails', async () => {
    cloud.fetchSnapshot.mockRejectedValue(new Error('تعذر الوصول لقاعدة البيانات'));

    await expect(ds.bootstrapFromCloud(SHOP)).rejects.toThrow('تعذر الوصول لقاعدة البيانات');

    expect(ds.getSyncStatus().state).toBe('error');
    expect(ds.getSyncStatus().error).toBe('تعذر الوصول لقاعدة البيانات');
    // A failed sign-in must not leave a live channel behind.
    expect(rt.startRealtime).not.toHaveBeenCalled();
  });

  it('keeps the shop bound after a failed bootstrap so retry can work', async () => {
    // Deliberate: the binding is what refreshFromCloud() needs, and the retry
    // button on the error screen calls it. Clearing it here would leave the user
    // stuck with a button that silently does nothing.
    cloud.fetchSnapshot.mockRejectedValue(new Error('offline'));

    await expect(ds.bootstrapFromCloud(SHOP)).rejects.toThrow('offline');

    expect(ds.getBoundShopId()).toBe(SHOP);
    // Still cloud mode, so a write would still target Postgres rather than
    // localStorage. App.tsx blocks every view until the state is 'ready'.
    expect(ds.isCloudActive()).toBe(true);
  });

  it('retries the same shop from a failed bootstrap', async () => {
    cloud.fetchSnapshot.mockRejectedValueOnce(new Error('offline'));
    await expect(ds.bootstrapFromCloud(SHOP)).rejects.toThrow('offline');

    cloud.fetchSnapshot.mockResolvedValueOnce({});
    await ds.refreshFromCloud();

    expect(ds.getSyncStatus().state).toBe('ready');
    expect(cloud.fetchSnapshot).toHaveBeenLastCalledWith(SHOP, expect.anything());
  });

  it('never falls back to a local write while Supabase is configured', async () => {
    // The dangerous state is configured-but-unbound: isCloudActive() is false, so
    // branching on it sent writes to the local store, which reports success to
    // the cashier while persisting nothing. Writes must fail loudly instead.
    const before = store.getState().products.length;
    const draft = makeProduct({ name: 'يجب ألا يُحفظ محلياً' });

    await expect(ds.addProduct(draft)).rejects.toThrow(/تم ربط المتجر/);

    expect(cloud.createProduct).not.toHaveBeenCalled();
    // The local store is untouched: no silent local row.
    expect(store.getState().products).toHaveLength(before);
    expect(store.getState().products.some((p) => p.name === draft.name)).toBe(false);
  });
});

describe('dataSource - local-only mode', () => {
  beforeEach(() => {
    cfg.configured = false;
    // unbindShop() recomputes the status from the live getter, standing in for
    // the module-load initialisation that a real local-only build would perform.
    ds.unbindShop();
    store.resetToDefault();
  });

  it('writes straight to the local store', async () => {
    const created = await ds.addProduct(makeProduct({ name: 'صنف محلي' }));

    expect(created.name).toBe('صنف محلي');
    expect(cloud.createProduct).not.toHaveBeenCalled();
    expect(store.getState().products.some((p) => p.id === created.id)).toBe(true);
    expect(ds.getSyncStatus().state).toBe('local');
  });

  it('allows the demo reset that a configured app forbids', () => {
    expect(() => ds.resetToDefault()).not.toThrow();
  });

  it('forbids the demo reset whenever Supabase is configured, even unbound', () => {
    // Otherwise the demo seed is written into a cloud app's cache and rendered
    // to the cashier as real stock.
    cfg.configured = true;
    expect(() => ds.resetToDefault()).toThrow(/الوضع المحلي فقط/);
  });
});

describe('dataSource - cloud writes', () => {
  beforeEach(async () => {
    await bindShop();
  });

  it('uses the server-returned product, not the submitted one', async () => {
    // The RPC is authoritative; the cache must show what Postgres stored.
    const stored = makeProduct({ name: 'كما خزّنه الخادم', selling_price: 12 });
    cloud.createProduct.mockResolvedValue(stored);
    cloud.refreshInventory.mockResolvedValue({ products: [stored], movements: [] });

    const result = await ds.addProduct(makeProduct({ name: 'كما أرسله العميل' }));

    expect(result).toEqual(stored);
    expect(store.getState().products).toEqual([stored]);
  });

  it('rejects updating a product that is not in the cache', async () => {
    // A stale UI must not be able to invent a row.
    await expect(ds.updateProduct('missing-id', { selling_price: 5 })).rejects.toThrow(
      /غير موجود في المخزون المحمل/
    );
    expect(cloud.updateProduct).not.toHaveBeenCalled();
  });

  it('replaces the cache with the server-side recalculation after a sale', async () => {
    // Stock, weighted average cost and the customer balance are all computed by
    // Postgres; applying the client's own numbers here is the bug this guards.
    const sold = makeProduct({ stock_quantity: 40, average_cost: 6.5 });
    const owing = makeCustomer({ balance: 70 });
    const sale = makeSale();
    cloud.executeSale.mockResolvedValue(sale);
    cloud.refreshAfterSale.mockResolvedValue({
      products: [sold],
      customers: [owing],
      movements: [],
      sales: [sale],
    });

    const result = await ds.executeSale({ items: [], paymentMethod: 'cash' });

    expect(result).toEqual(sale);
    expect(store.getState().products).toEqual([sold]);
    expect(store.getState().customers[0].balance).toBe(70);
  });

  it('folds the cloud result into the cache for a debt payment', async () => {
    const payment = { id: 'pay-1', customer_id: 'c1', amount: 20, note: '' } as CustomerPayment;
    cloud.recordCustomerPayment.mockResolvedValue({ payment });
    cloud.refreshAfterPayment.mockResolvedValue({
      customers: [makeCustomer({ balance: 50 })],
      payments: [payment],
    });

    const result = await ds.recordDebtPayment({ customerId: 'c1', amount: 20 });

    expect(result).toEqual(payment);
    expect(store.getState().customerPayments).toEqual([payment]);
    expect(store.getState().customers[0].balance).toBe(50);
  });

  it('merges a settings patch before sending it', async () => {
    const saved = { shop_name: 'اسم جديد' } as Settings;
    cloud.upsertSettings.mockResolvedValue(saved);

    await ds.updateSettings({ shop_name: 'اسم جديد' });

    // The whole settings row is upserted, so a partial patch must be completed
    // from the cached values rather than sent as-is.
    const sent = cloud.upsertSettings.mock.calls[0][1];
    expect(sent.shop_name).toBe('اسم جديد');
    expect(sent.currency).toBe(store.getState().settings.currency);
  });

  it('surfaces the write error and does not wedge the sync status', async () => {
    cloud.createProduct.mockRejectedValue(new Error('قيد قاعدة البيانات'));

    await expect(ds.addProduct(makeProduct())).rejects.toThrow('قيد قاعدة البيانات');

    expect(ds.getSyncStatus().state).toBe('error');
    expect(ds.getSyncStatus().error).toBe('قيد قاعدة البيانات');
    // The "saving" hint must not stay stuck on.
    expect(ds.getSyncStatus().pending).toBe(0);
  });
});

describe('dataSource - pending counter', () => {
  beforeEach(async () => {
    await bindShop();
  });

  it('tracks an in-flight write and clears it afterwards', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    cloud.createProduct.mockReturnValue(gate.then(() => makeProduct()));
    cloud.refreshInventory.mockResolvedValue({ products: [], movements: [] });

    const pending = ds.addProduct(makeProduct());
    expect(ds.getSyncStatus().pending).toBe(1);

    release();
    await pending;

    expect(ds.getSyncStatus().pending).toBe(0);
  });

  it('keeps the count right when two writes overlap', async () => {
    cloud.createProduct.mockResolvedValue(makeProduct());
    cloud.refreshInventory.mockResolvedValue({ products: [], movements: [] });

    await Promise.all([ds.addProduct(makeProduct()), ds.addProduct(makeProduct())]);

    expect(ds.getSyncStatus().pending).toBe(0);
  });
});

describe('dataSource - live-sync slices', () => {
  beforeEach(async () => {
    await bindShop();
  });

  it('re-pulls only the operational tables', async () => {
    // Categories and shop settings are not watched, so a second register's sale
    // must not make this one re-read its own settings.
    await ds.refreshOperationalSlices();

    expect(cloud.fetchProducts).toHaveBeenCalled();
    expect(cloud.fetchSales).toHaveBeenCalled();
    expect(cloud.fetchCategories).not.toHaveBeenCalled();
  });

  it('applies the pulled slices to the cache', async () => {
    const product = makeProduct({ name: 'منتج محدّث' });
    const movement = { id: 'm1', product_id: product.id } as StockMovement;
    cloud.fetchProducts.mockResolvedValue([product]);
    cloud.fetchStockMovements.mockResolvedValue([movement]);

    await ds.refreshOperationalSlices();

    expect(store.getState().products).toEqual([product]);
    expect(store.getState().stockMovements).toEqual([movement]);
  });
});

describe('dataSource - session teardown', () => {
  it('unbinding drops the binding, the subscription, the cache and the cart', async () => {
    await bindShop();
    cart.clear.mockReset();
    rt.stopRealtime.mockReset();

    ds.unbindShop();

    expect(ds.isCloudActive()).toBe(false);
    expect(rt.stopRealtime).toHaveBeenCalled();
    expect(cart.clear).toHaveBeenCalled();
    expect(store.getState().products).toEqual([]);
    expect(ds.getSyncStatus().state).toBe('loading'); // configured, but not bound
  });

  it('never silently falls back to a local write when the session ends', async () => {
    // An expired or revoked token ends the session. Falling back to localStorage
    // would look like a successful sale to the cashier while nothing was
    // persisted, so the write must keep going to the cloud and fail loudly.
    await bindShop();
    ds.onSessionEnded();

    expect(rt.stopRealtime).toHaveBeenCalled();
    expect(cart.clear).toHaveBeenCalled();

    await expect(ds.addProduct(makeProduct())).rejects.toThrow();
    expect(cloud.createProduct).toHaveBeenCalled();
    expect(store.getState().products).toEqual([]);
  });
});
