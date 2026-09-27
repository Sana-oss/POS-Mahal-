// @vitest-environment jsdom
// jsdom rather than the suite default of node: the session methods no-op when
// `window` is undefined, so they cannot be exercised in the node environment.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { store } from './store';
import { roundQuantity } from './calculations';
import type { UserSession } from '../types';

/**
 * store.sale.test.ts already covers the sale, purchase, debt and fractional paths.
 * This file covers the remaining surface: product edits, deletion, expenses,
 * settings and the session. The expense and id tests guard a real data-loss bug.
 */

const product = (overrides = {}) =>
  store.addProduct({
    name: 'صنف اختباري',
    barcode: '900001',
    category_id: '',
    purchase_price: 4,
    selling_price: 10,
    average_cost: 4,
    stock_quantity: 20,
    minimum_stock: 3,
    unit: 'حبة',
    ...overrides,
  });

beforeEach(() => {
  store.resetToDefault();
});

describe('store - updateProduct', () => {
  it('applies a partial update and leaves other fields alone', () => {
    const p = product();
    const updated = store.updateProduct(p.id, { selling_price: 15 });

    expect(updated.selling_price).toBe(15);
    expect(updated.purchase_price).toBe(4);
    expect(updated.name).toBe('صنف اختباري');
  });

  it('rejects an unknown id', () => {
    expect(() => store.updateProduct('no-such-id', { selling_price: 1 })).toThrow(/غير موجود/);
  });

  it('refuses a barcode already used by another product', () => {
    const first = product({ barcode: 'AAA' });
    const second = product({ barcode: 'BBB', name: 'ثانٍ' });

    expect(() => store.updateProduct(second.id, { barcode: 'AAA' })).toThrow(/مرتبط بمنتج آخر/);
    expect(store.getProductById(first.id)?.barcode).toBe('AAA');
  });

  it('allows a product to keep its own barcode', () => {
    const p = product({ barcode: 'SAME' });
    expect(() => store.updateProduct(p.id, { barcode: 'SAME' })).not.toThrow();
  });

  it('records an adjustment movement when stock is recounted', () => {
    const p = product();
    const before = store.getState().stockMovements.length;

    store.updateProduct(p.id, { stock_quantity: 17 });

    const movements = store.getState().stockMovements;
    expect(movements).toHaveLength(before + 1);
    expect(movements[0].type).toBe('adjustment');
    expect(movements[0].quantity).toBe(-3);
    expect(movements[0].remaining_stock).toBe(17);
  });

  it('records no movement when the recount is unchanged', () => {
    const p = product();
    const before = store.getState().stockMovements.length;

    store.updateProduct(p.id, { stock_quantity: 20, selling_price: 11 });

    expect(store.getState().stockMovements).toHaveLength(before);
  });

  it('handles a fractional recount', () => {
    const p = product();
    const before = store.getState().stockMovements.length;

    store.updateProduct(p.id, { stock_quantity: 19.5 });

    expect(store.getProductById(p.id)?.stock_quantity).toBe(19.5);
    expect(store.getState().stockMovements[0].quantity).toBe(-0.5);
    expect(store.getState().stockMovements.length).toBe(before + 1);
  });

  it('does not move cost when only the price changes', () => {
    const p = product();
    store.updateProduct(p.id, { purchase_price: 9, selling_price: 20 });
    expect(store.getProductById(p.id)?.average_cost).toBe(4);
  });
});

describe('store - deleteProduct', () => {
  it('removes only the named product', () => {
    const keep = product({ barcode: 'KEEP', name: 'يبقى' });
    const drop = product({ barcode: 'DROP', name: 'يُحذف' });

    store.deleteProduct(drop.id);

    const names = store.getState().products.map((p) => p.name);
    expect(names).toContain('يبقى');
    expect(names).not.toContain('يُحذف');
    expect(store.getProductById(keep.id)).toBeDefined();
  });

  it('is a no-op for an unknown id', () => {
    const before = store.getState().products.length;
    expect(() => store.deleteProduct('nope')).not.toThrow();
    expect(store.getState().products).toHaveLength(before);
  });
});

describe('store - expenses', () => {
  it('records a trimmed expense with a rounded amount', () => {
    const expense = store.addExpense({
      title: '  فاتورة كهرباء  ',
      amount: 12.345,
      category: 'كهرباء',
    });

    expect(expense.title).toBe('فاتورة كهرباء');
    expect(expense.amount).toBe(12.35);
    expect(store.getState().expenses[0].id).toBe(expense.id);
  });

  it('falls back to a default category', () => {
    expect(store.addExpense({ title: 'متنوع', amount: 5, category: '' }).category).toBe('أخرى');
  });

  it('rejects a blank title', () => {
    expect(() => store.addExpense({ title: '   ', amount: 5, category: 'أخرى' })).toThrow(/مطلوب/);
  });

  it('rejects a non-positive amount', () => {
    expect(() => store.addExpense({ title: 'صفر', amount: 0, category: 'أخرى' })).toThrow(/أكبر من الصفر/);
    expect(() => store.addExpense({ title: 'سالب', amount: -5, category: 'أخرى' })).toThrow(/أكبر من الصفر/);
  });

  it('deletes only the named expense', () => {
    const keep = store.addExpense({ title: 'يبقى', amount: 10, category: 'أخرى' });
    const drop = store.addExpense({ title: 'يُحذف', amount: 20, category: 'أخرى' });

    store.deleteExpense(drop.id);

    const remaining = store.getState().expenses;
    expect(remaining.map((e) => e.title)).toContain('يبقى');
    expect(remaining.map((e) => e.title)).not.toContain('يُحذف');
    expect(remaining.some((e) => e.id === keep.id)).toBe(true);
  });

  it('gives two expenses in the same millisecond distinct ids', () => {
    // Regression: ids were 'exp-' + Date.now(), so two quick entries shared one
    // id and deleteExpense filtered on it, removing BOTH records.
    const spy = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    try {
      const first = store.addExpense({ title: 'أ', amount: 10, category: 'أخرى' });
      const second = store.addExpense({ title: 'ب', amount: 20, category: 'أخرى' });

      expect(first.id).not.toBe(second.id);

      store.deleteExpense(first.id);
      const titles = store.getState().expenses.map((e) => e.title);
      expect(titles).toContain('ب');
      expect(titles).not.toContain('أ');
    } finally {
      spy.mockRestore();
    }
  });

  it('gives two customers in the same millisecond distinct ids', () => {
    // Otherwise a debt payment could land on the wrong customer: the lookups
    // find the first row matching the id.
    const spy = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    try {
      const a = store.addCustomer({ name: 'أول' });
      const b = store.addCustomer({ name: 'ثانٍ' });
      expect(a.id).not.toBe(b.id);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('store - settings', () => {
  it('merges a partial patch', () => {
    const before = store.getState().settings.currency;
    store.updateSettings({ shop_name: 'اسم جديد' });

    expect(store.getState().settings.shop_name).toBe('اسم جديد');
    expect(store.getState().settings.currency).toBe(before);
  });

  it('overwrites a field that is patched', () => {
    store.updateSettings({ currency: 'د.إ' });
    expect(store.getState().settings.currency).toBe('د.إ');
  });
});

describe('store - session', () => {
  const session = (name: string): UserSession => ({
    id: 'u-1',
    name,
    email: 'cashier@shop.test',
    role: 'cashier',
    shift_started_at: new Date().toISOString(),
  });

  it('returns a default session when none is stored', () => {
    store.setSession(null);
    expect(store.getSession()).not.toBeNull();
  });

  it('round-trips a session', () => {
    store.setSession(session('كاشير الوردية'));
    expect(store.getSession()?.name).toBe('كاشير الوردية');
  });

  it('clears a session', () => {
    store.setSession(session('كاشير'));
    store.setSession(null);
    expect(store.getSession()?.name).not.toBe('كاشير');
  });

  it('falls back to the default when the stored value is corrupt', () => {
    // A half-written or hand-edited entry must not crash the boot path.
    localStorage.setItem('mahall_pos_session_v1', '{not json');
    expect(store.getSession()).not.toBeNull();
  });
});

describe('store - cloud appliers', () => {
  it('replace whole slices from a snapshot', () => {
    store.hydrateFromCloud({ products: [product({ name: 'من السحابة' })] });
    expect(store.getState().products.map((p) => p.name)).toEqual(['من السحابة']);
    expect(store.getState().sales).toEqual([]);
  });

  it('ignore undefined slices so a partial pull cannot wipe data', () => {
    store.addExpense({ title: 'يبقى', amount: 10, category: 'أخرى' });
    const expensesBefore = store.getState().expenses;

    store.applyCloudSlices({ products: [] });

    expect(store.getState().products).toEqual([]);
    expect(store.getState().expenses).toBe(expensesBefore);
  });

  it('upsert a customer rather than duplicating it', () => {
    const c = store.addCustomer({ name: 'زبون' });
    store.upsertCloudCustomer({ ...c, name: 'اسم محدّث' });

    const matches = store.getState().customers.filter((x) => x.id === c.id);
    expect(matches).toHaveLength(1);
    expect(matches[0].name).toBe('اسم محدّث');
  });

  it('prepend a cloud expense so the newest is first', () => {
    const existing = store.addExpense({ title: 'قديم', amount: 1, category: 'أخرى' });
    const incoming = { ...existing, id: 'cloud-1', title: 'جديد', amount: 2 };

    store.prependCloudExpense(incoming);

    expect(store.getState().expenses[0].id).toBe('cloud-1');
  });

  it('remove a cloud expense by id', () => {
    const e = store.addExpense({ title: 'يحذف', amount: 3, category: 'أخرى' });
    store.removeCloudExpense(e.id);
    expect(store.getState().expenses.map((x) => x.id)).not.toContain(e.id);
  });

  it('clear persisted data on sign-out', () => {
    store.addExpense({ title: 'سابق', amount: 3, category: 'أخرى' });
    store.clearPersistedData();
    expect(store.getState().expenses).toEqual([]);
    expect(store.getState().products).toEqual([]);
  });
});

describe('store - quantity precision', () => {
  it('rounds stock to the 3 decimals the columns hold', () => {
    const p = product();
    store.updateProduct(p.id, { stock_quantity: roundQuantity(10.123456) });
    expect(store.getProductById(p.id)?.stock_quantity).toBe(10.123);
  });
});
