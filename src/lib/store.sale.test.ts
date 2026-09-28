import { describe, it, expect, beforeEach } from 'vitest';
import { store } from './store';
import type { Product } from '../types';

/**
 * Sale integrity rules that only show up once a whole operation runs:
 * stock guards, cost freezing, stock movements and the debt ledger.
 *
 * These run against the real local-mode store. In a Node environment
 * `typeof window === 'undefined'`, so lib/store.ts loads the demo seed and
 * every localStorage write no-ops - no jsdom needed and nothing persisted.
 */

function makeProduct(overrides: Partial<Product> = {}): Product {
  return store.addProduct({
    name: 'منتج اختباري',
    barcode: 'TST-' + Math.random().toString(36).slice(2, 10),
    category_id: '',
    purchase_price: 5,
    selling_price: 10,
    average_cost: 5,
    stock_quantity: 100,
    minimum_stock: 5,
    unit: 'piece',
    ...overrides,
  });
}

function stockOf(id: string): number {
  const product = store.getProductById(id);
  if (!product) throw new Error(`product ${id} vanished`);
  return product.stock_quantity;
}

beforeEach(() => {
  store.resetToDefault();
});

describe('executeSale - stock guard', () => {
  it('deducts stock and records one movement per line', () => {
    const product = makeProduct({ stock_quantity: 30 });
    const salesBefore = store.getState().sales.length;

    const sale = store.executeSale({
      items: [{ productId: product.id, quantity: 5 }],
      paymentMethod: 'cash',
    });

    expect(stockOf(product.id)).toBe(25);
    expect(store.getState().sales.length).toBe(salesBefore + 1);
    expect(sale.items).toHaveLength(1);

    const movement = store
      .getState()
      .stockMovements.find((m) => m.type === 'sale' && m.product_id === product.id);
    expect(movement).toBeDefined();
    expect(movement?.quantity).toBe(-5);
    expect(movement?.remaining_stock).toBe(25);
  });

  it('rejects a single line that exceeds stock and leaves stock untouched', () => {
    const product = makeProduct({ stock_quantity: 4 });

    expect(() =>
      store.executeSale({
        items: [{ productId: product.id, quantity: 5 }],
        paymentMethod: 'cash',
      })
    ).toThrow(/4/);

    expect(stockOf(product.id)).toBe(4);
  });

  it('accumulates repeated lines for one product before validating', () => {
    // Regression: each line used to be validated against the pre-transaction
    // stock independently, so two lines of 20 both passed against a stock of 28
    // and the deduction loop then drove inventory to -12.
    const product = makeProduct({ stock_quantity: 28 });

    expect(() =>
      store.executeSale({
        items: [
          { productId: product.id, quantity: 20 },
          { productId: product.id, quantity: 20 },
        ],
        paymentMethod: 'cash',
      })
    ).toThrow();

    expect(stockOf(product.id)).toBe(28);
  });

  it('allows repeated lines whose combined quantity fits', () => {
    const product = makeProduct({ stock_quantity: 28 });

    const sale = store.executeSale({
      items: [
        { productId: product.id, quantity: 20 },
        { productId: product.id, quantity: 8 },
      ],
      paymentMethod: 'cash',
    });

    expect(stockOf(product.id)).toBe(0);
    expect(sale.items_count).toBe(28);
  });

  it('never drives stock below zero', () => {
    const product = makeProduct({ stock_quantity: 10 });
    store.executeSale({ items: [{ productId: product.id, quantity: 10 }], paymentMethod: 'cash' });
    expect(stockOf(product.id)).toBe(0);
    expect(() =>
      store.executeSale({ items: [{ productId: product.id, quantity: 1 }], paymentMethod: 'cash' })
    ).toThrow();
    expect(stockOf(product.id)).toBe(0);
  });

  it('rejects an unknown product id', () => {
    expect(() =>
      store.executeSale({ items: [{ productId: 'nope', quantity: 1 }], paymentMethod: 'cash' })
    ).toThrow();
  });

  it('rejects an empty cart', () => {
    expect(() => store.executeSale({ items: [], paymentMethod: 'cash' })).toThrow();
  });
});

describe('executeSale - money', () => {
  it('freezes unit_cost at the moment of sale', () => {
    const product = makeProduct({ average_cost: 4, purchase_price: 4, selling_price: 10, stock_quantity: 10 });

    const sale = store.executeSale({ items: [{ productId: product.id, quantity: 2 }], paymentMethod: 'cash' });
    expect(sale.items[0].unit_cost).toBe(4);
    expect(sale.total_cost).toBe(8);
    expect(sale.total_amount).toBe(20);
    expect(sale.profit).toBe(12);

    // A later restock changes the weighted average, but the historical sale
    // must not follow it.
    store.executePurchase({
      supplierName: 'مورد',
      items: [{ productId: product.id, quantity: 10, unitCost: 9 }],
    });

    const reloaded = store.getState().sales.find((s) => s.id === sale.id);
    expect(reloaded?.items[0].unit_cost).toBe(4);
    expect(reloaded?.total_cost).toBe(8);
  });

  it('falls back to purchase_price when average_cost is zero', () => {
    const product = makeProduct({ average_cost: 0, purchase_price: 3, selling_price: 7, stock_quantity: 10 });
    const sale = store.executeSale({ items: [{ productId: product.id, quantity: 1 }], paymentMethod: 'cash' });
    expect(sale.items[0].unit_cost).toBe(3);
  });

  it('computes change and never returns a negative amount', () => {
    const product = makeProduct({ selling_price: 10, stock_quantity: 50 });
    const sale = store.executeSale({
      items: [{ productId: product.id, quantity: 3 }],
      paymentMethod: 'cash',
      receivedAmount: 50,
    });
    expect(sale.total_amount).toBe(30);
    expect(sale.change_amount).toBe(20);

    const exact = store.executeSale({
      items: [{ productId: product.id, quantity: 1 }],
      paymentMethod: 'cash',
      receivedAmount: 10,
    });
    expect(exact.change_amount).toBe(0);
  });
});

describe('executeSale - debt', () => {
  it('requires a customer for a debt sale', () => {
    const product = makeProduct({ stock_quantity: 10 });
    expect(() =>
      store.executeSale({ items: [{ productId: product.id, quantity: 1 }], paymentMethod: 'debt' })
    ).toThrow();
  });

  it('increases the customer balance by the invoice total', () => {
    const customer = store.addCustomer({ name: 'زبون', initial_balance: 0, credit_limit: 500 });
    const product = makeProduct({ selling_price: 10, stock_quantity: 10 });

    const sale = store.executeSale({
      items: [{ productId: product.id, quantity: 4 }],
      paymentMethod: 'debt',
      customerId: customer.id,
    });

    expect(sale.total_amount).toBe(40);
    expect(store.getState().customers.find((c) => c.id === customer.id)?.balance).toBe(40);
    expect(stockOf(product.id)).toBe(6);
  });

  it('does not touch any balance for a cash sale', () => {
    const customer = store.addCustomer({ name: 'زبون', initial_balance: 25, credit_limit: 500 });
    const product = makeProduct({ stock_quantity: 10 });

    store.executeSale({ items: [{ productId: product.id, quantity: 2 }], paymentMethod: 'cash' });

    expect(store.getState().customers.find((c) => c.id === customer.id)?.balance).toBe(25);
  });
});

/**
 * Credit limit. `credit_limit` had been stored since 0001 and read by nothing, so
 * a customer could be run arbitrarily far past it. A live shop had a customer
 * owing 234.60 against a limit of 50.
 *
 * These run through the real store so they cover local mode; migration 0008
 * enforces the same rule in the database, which is the actual authority.
 */
describe('executeSale - credit limit', () => {
  it('refuses a debt sale that would exceed the limit', () => {
    const customer = store.addCustomer({ name: 'سند', initial_balance: 0, credit_limit: 50 });
    const product = makeProduct({ selling_price: 10, stock_quantity: 100 });

    expect(() =>
      store.executeSale({
        items: [{ productId: product.id, quantity: 6 }], // 60 > 50
        paymentMethod: 'debt',
        customerId: customer.id,
      })
    ).toThrow();
  });

  it('refuses when the customer is already over the limit from earlier debt', () => {
    // The live case: owes 234.60 against a limit of 50.
    const customer = store.addCustomer({ name: 'سند', initial_balance: 234.6, credit_limit: 50 });
    const product = makeProduct({ selling_price: 10, stock_quantity: 100 });

    expect(() =>
      store.executeSale({
        items: [{ productId: product.id, quantity: 1 }],
        paymentMethod: 'debt',
        customerId: customer.id,
      })
    ).toThrow();
  });

  it('allows a sale that lands exactly on the limit', () => {
    const customer = store.addCustomer({ name: 'سند', initial_balance: 0, credit_limit: 50 });
    const product = makeProduct({ selling_price: 10, stock_quantity: 100 });

    const sale = store.executeSale({
      items: [{ productId: product.id, quantity: 5 }], // exactly 50
      paymentMethod: 'debt',
      customerId: customer.id,
    });

    expect(sale.total_amount).toBe(50);
    expect(store.getState().customers.find((c) => c.id === customer.id)?.balance).toBe(50);
  });

  it('a limit of 0 means no limit', () => {
    const customer = store.addCustomer({ name: 'سند', initial_balance: 0, credit_limit: 0 });
    const product = makeProduct({ selling_price: 10, stock_quantity: 1000 });

    const sale = store.executeSale({
      items: [{ productId: product.id, quantity: 100 }], // 1000 owed
      paymentMethod: 'debt',
      customerId: customer.id,
    });

    expect(sale.total_amount).toBe(1000);
  });

  it('leaves no trace when it refuses: no sale, no stock loss, no balance change', () => {
    const customer = store.addCustomer({ name: 'سند', initial_balance: 0, credit_limit: 50 });
    const product = makeProduct({ selling_price: 10, stock_quantity: 10 });
    const salesBefore = store.getState().sales.length;

    expect(() =>
      store.executeSale({
        items: [{ productId: product.id, quantity: 6 }],
        paymentMethod: 'debt',
        customerId: customer.id,
      })
    ).toThrow();

    expect(store.getState().sales.length).toBe(salesBefore);
    expect(stockOf(product.id)).toBe(10);
    expect(store.getState().customers.find((c) => c.id === customer.id)?.balance).toBe(0);
  });

  it('never applies the limit to a cash sale', () => {
    const customer = store.addCustomer({ name: 'سند', initial_balance: 0, credit_limit: 1 });
    const product = makeProduct({ selling_price: 10, stock_quantity: 100 });

    const sale = store.executeSale({
      items: [{ productId: product.id, quantity: 5 }],
      paymentMethod: 'cash',
      customerId: customer.id,
    });

    expect(sale.total_amount).toBe(50);
  });
});

describe('executeSale - debt', () => {
  it('adds to an existing outstanding balance', () => {
    const customer = store.addCustomer({ name: 'زبون', initial_balance: 15, credit_limit: 500 });
    const product = makeProduct({ selling_price: 10, stock_quantity: 10 });

    store.executeSale({
      items: [{ productId: product.id, quantity: 1 }],
      paymentMethod: 'debt',
      customerId: customer.id,
    });

    expect(store.getState().customers.find((c) => c.id === customer.id)?.balance).toBe(25);
  });
});

describe('executePurchase - average cost', () => {
  it('increases stock and re-weights the average cost', () => {
    const product = makeProduct({ stock_quantity: 10, average_cost: 1.5, purchase_price: 1.5 });

    store.executePurchase({
      supplierName: 'مورد',
      items: [{ productId: product.id, quantity: 10, unitCost: 1.7 }],
    });

    const updated = store.getProductById(product.id)!;
    expect(updated.stock_quantity).toBe(20);
    // (10 * 1.5 + 10 * 1.7) / 20 = 1.60
    expect(updated.average_cost).toBe(1.6);
    expect(updated.purchase_price).toBe(1.7);
  });

  it('records a purchase movement and a purchase row', () => {
    const product = makeProduct({ stock_quantity: 5 });
    const purchasesBefore = store.getState().purchases.length;

    const purchase = store.executePurchase({
      supplierName: 'شركة المراعي',
      items: [{ productId: product.id, quantity: 4, unitCost: 2 }],
    });

    expect(purchase.total_amount).toBe(8);
    expect(store.getState().purchases.length).toBe(purchasesBefore + 1);

    const movement = store
      .getState()
      .stockMovements.find((m) => m.type === 'purchase' && m.product_id === product.id);
    expect(movement?.quantity).toBe(4);
    expect(movement?.remaining_stock).toBe(9);
  });

  it('supports fractional quantities, as the NUMERIC(10,3) columns allow', () => {
    // The purchases form used parseInt, so typing 2.5 kg previewed as 2 and the
    // truncated 2 was what reached executePurchase. Postgres stores NUMERIC(10,3),
    // so fractional stock is legal end to end.
    const product = makeProduct({ stock_quantity: 10, average_cost: 2, purchase_price: 2 });

    store.executePurchase({
      supplierName: 'مورد',
      items: [{ productId: product.id, quantity: 2.5, unitCost: 4 }],
    });

    const updated = store.getProductById(product.id)!;
    expect(updated.stock_quantity).toBe(12.5);
    // (10*2 + 2.5*4) / 12.5 = 30 / 12.5 = 2.4
    expect(updated.average_cost).toBe(2.4);
    // Exact fractional count, not floored (NUMERIC(10,3) since migration 0007).
    expect(store.getState().purchases[0].items_count).toBe(2.5);

    const movement = store
      .getState()
      .stockMovements.find((m) => m.type === 'purchase' && m.product_id === product.id);
    expect(movement?.quantity).toBe(2.5);
  });

  it('rounds a fractional purchase line total to 2 decimals', () => {
    const product = makeProduct({ stock_quantity: 0, average_cost: 0 });
    const purchase = store.executePurchase({
      supplierName: 'مورد',
      items: [{ productId: product.id, quantity: 3, unitCost: 1.115 }],
    });
    // 3 * 1.115 = 3.345 -> 3.35 (half-up), not 3.34 via float truncation
    expect(purchase.total_amount).toBe(3.35);
  });

  it('can sell a fractional quantity and records the exact count', () => {
    const product = makeProduct({ stock_quantity: 10, average_cost: 2, selling_price: 4 });
    const sale = store.executeSale({
      items: [{ productId: product.id, quantity: 2.5 }],
      paymentMethod: 'cash',
    });

    expect(stockOf(product.id)).toBe(7.5);
    expect(sale.items[0].quantity).toBe(2.5);
    // items_count is the exact sum of line quantities. Since migration 0007 the
    // column is NUMERIC(10,3), so a weighed sale records 2.5 rather than 2.
    expect(sale.items_count).toBe(2.5);
  });

  it('keeps items_count exact across mixed whole and fractional lines', () => {
    const a = makeProduct({ stock_quantity: 10, average_cost: 1, selling_price: 2 });
    const b = makeProduct({ stock_quantity: 10, average_cost: 1, selling_price: 2 });

    const sale = store.executeSale({
      items: [
        { productId: a.id, quantity: 3 },
        { productId: b.id, quantity: 2.5 },
        { productId: a.id, quantity: 0.5 },
      ],
      paymentMethod: 'cash',
    });

    expect(sale.items_count).toBe(6);
  });

  it('rejects a non-positive purchase quantity', () => {
    const product = makeProduct({ stock_quantity: 5 });
    expect(() =>
      store.executePurchase({ supplierName: 'مورد', items: [{ productId: product.id, quantity: 0, unitCost: 1 }] })
    ).toThrow();
    expect(() =>
      store.executePurchase({ supplierName: 'مورد', items: [{ productId: product.id, quantity: -3, unitCost: 1 }] })
    ).toThrow();
  });

  it('rejects a negative purchase unit cost', () => {
    // Would otherwise write a negative purchase_price and drag average_cost down.
    const product = makeProduct({ stock_quantity: 5 });
    expect(() =>
      store.executePurchase({ supplierName: 'مورد', items: [{ productId: product.id, quantity: 5, unitCost: -1 }] })
    ).toThrow();
  });

  it('leaves stock and cost untouched when a purchase line is rejected', () => {
    // The guard validates every line before mutating, so a bad second line
    // cannot leave the first line's stock movement half-applied.
    const good = makeProduct({ stock_quantity: 10, average_cost: 2 });
    const bad = makeProduct({ stock_quantity: 4, average_cost: 3 });
    const movementsBefore = store.getState().stockMovements.length;

    expect(() =>
      store.executePurchase({
        supplierName: 'مورد',
        items: [
          { productId: good.id, quantity: 5, unitCost: 1 },
          { productId: bad.id, quantity: -1, unitCost: 1 },
        ],
      })
    ).toThrow();

    expect(stockOf(good.id)).toBe(10);
    expect(stockOf(bad.id)).toBe(4);
    expect(store.getProductById(good.id)!.average_cost).toBe(2);
    expect(store.getState().stockMovements.length).toBe(movementsBefore);
  });
});

describe('recordDebtPayment', () => {
  it('reduces the balance and snapshots the before/after pair', () => {
    const customer = store.addCustomer({ name: 'زبون', initial_balance: 50, credit_limit: 500 });

    const payment = store.recordDebtPayment({ customerId: customer.id, amount: 20, note: 'دفعة' });

    expect(payment.previous_balance).toBe(50);
    expect(payment.new_balance).toBe(30);
    expect(store.getState().customers.find((c) => c.id === customer.id)?.balance).toBe(30);
  });

  it('refuses to overpay and leaves the balance alone', () => {
    const customer = store.addCustomer({ name: 'زبون', initial_balance: 30, credit_limit: 500 });

    expect(() => store.recordDebtPayment({ customerId: customer.id, amount: 31 })).toThrow();
    expect(store.getState().customers.find((c) => c.id === customer.id)?.balance).toBe(30);
  });

  it('rejects a non-positive amount', () => {
    const customer = store.addCustomer({ name: 'زبون', initial_balance: 30, credit_limit: 500 });
    expect(() => store.recordDebtPayment({ customerId: customer.id, amount: 0 })).toThrow();
    expect(() => store.recordDebtPayment({ customerId: customer.id, amount: -5 })).toThrow();
  });

  it('rejects a payment for an unknown customer', () => {
    expect(() => store.recordDebtPayment({ customerId: 'nope', amount: 5 })).toThrow();
  });
});

describe('addProduct', () => {
  it('rejects a duplicate barcode', () => {
    makeProduct({ barcode: 'DUPE-1' });
    expect(() => makeProduct({ barcode: 'DUPE-1' })).toThrow();
  });

  it('allows several products with no barcode', () => {
    expect(() => makeProduct({ barcode: '' })).not.toThrow();
    expect(() => makeProduct({ barcode: '' })).not.toThrow();
  });

  it('records an opening movement for initial stock', () => {
    const product = makeProduct({ stock_quantity: 12 });
    const movement = store
      .getState()
      .stockMovements.find((m) => m.type === 'opening_stock' && m.product_id === product.id);
    expect(movement?.quantity).toBe(12);
  });

  it('registers a barcode-less manual item that can actually be sold', () => {
    // Regression: the POS used to push a fabricated `custom-<timestamp>` product
    // straight into the cart with cost = price * 0.7. The id is not a uuid, so
    // cloudSync rejected it and the line could never be checked out, while local
    // mode booked an invented cost of goods sold.
    const created = store.addProduct({
      name: 'بند عام',
      barcode: '',
      category_id: '',
      purchase_price: 3,
      average_cost: 3,
      selling_price: 5,
      stock_quantity: 2,
      minimum_stock: 0,
      unit: 'حبة',
    });

    // A real product id, so the RPC's uuid cast and requireUuid both accept it.
    expect(created.id).not.toMatch(/^custom-/);

    const sale = store.executeSale({
      items: [{ productId: created.id, quantity: 2 }],
      paymentMethod: 'cash',
    });

    // Cost is what the owner typed, not a fraction of the price.
    expect(sale.items[0].unit_cost).toBe(3);
    expect(sale.total_cost).toBe(6);
    expect(sale.total_amount).toBe(10);
    expect(sale.profit).toBe(4);
    expect(stockOf(created.id)).toBe(0);
  });

  it('keeps a barcode-less item out of barcode lookup', () => {
    const created = makeProduct({ barcode: '' });
    expect(store.getProductByBarcode('')).toBeUndefined();
    expect(store.getProductById(created.id)).toBeDefined();
  });
});

describe('demo seed consistency', () => {
  // The seed used to hard-code items_count values that contradicted their own
  // line quantities (5 vs 7, 3 vs 9, 3 vs 7, 2 vs 48), so local-only mode showed
  // a receipt summary that disagreed with the lines printed above it. This
  // guards the field that executeSale/executePurchase now derive.
  beforeEach(() => {
    store.resetToDefault();
  });

  it('has a seeded items_count equal to the sum of its line quantities', () => {
    for (const sale of store.getState().sales) {
      const sum = sale.items.reduce((acc, i) => acc + i.quantity, 0);
      expect(sale.items_count, `sale ${sale.invoice_no}`).toBe(sum);
    }
  });

  it('has a seeded purchase items_count equal to the sum of its line quantities', () => {
    for (const purchase of store.getState().purchases) {
      const sum = purchase.items.reduce((acc, i) => acc + i.quantity, 0);
      expect(purchase.items_count, `purchase ${purchase.invoice_no}`).toBe(sum);
    }
  });

  it('has a seeded sale total_amount equal to the sum of its line totals', () => {
    for (const sale of store.getState().sales) {
      const sum = sale.items.reduce((acc, i) => acc + i.total_price, 0);
      expect(sale.total_amount, `sale ${sale.invoice_no} total_amount`).toBeCloseTo(sum, 2);
    }
  });

  it('has a seeded purchase total_amount equal to the sum of its line totals', () => {
    for (const purchase of store.getState().purchases) {
      const sum = purchase.items.reduce((acc, i) => acc + i.total_cost, 0);
      expect(purchase.total_amount, `purchase ${purchase.invoice_no}`).toBeCloseTo(sum, 2);
    }
  });
});

describe('updateProduct', () => {
  it('preserves average_cost when the caller does not send it', () => {
    const product = makeProduct({ average_cost: 4, purchase_price: 4, stock_quantity: 20 });

    // A purchase re-weights the average; a product edit must not undo that.
    store.executePurchase({
      supplierName: 'مورد',
      items: [{ productId: product.id, quantity: 20, unitCost: 8 }],
    });
    const afterPurchase = store.getProductById(product.id)!;
    expect(afterPurchase.average_cost).toBe(6);

    // Regression: the inventory edit form used to send the single cost field as
    // both purchase_price and average_cost, silently destroying the average and
    // permanently skewing the profit of every future sale.
    store.updateProduct(product.id, {
      name: afterPurchase.name,
      purchase_price: 9.99,
      selling_price: afterPurchase.selling_price,
      stock_quantity: afterPurchase.stock_quantity,
      minimum_stock: afterPurchase.minimum_stock,
      unit: afterPurchase.unit,
    });

    const edited = store.getProductById(product.id)!;
    expect(edited.purchase_price).toBe(9.99);
    expect(edited.average_cost).toBe(6);
  });

  it('records an adjustment movement for a manual stock count', () => {
    const product = makeProduct({ stock_quantity: 10 });
    store.updateProduct(product.id, { stock_quantity: 7 });

    const movement = store
      .getState()
      .stockMovements.find((m) => m.type === 'adjustment' && m.product_id === product.id);
    expect(movement?.quantity).toBe(-3);
    expect(movement?.remaining_stock).toBe(7);
  });

  it('does not record a movement when the stock is unchanged', () => {
    const product = makeProduct({ stock_quantity: 10 });
    const before = store.getState().stockMovements.length;

    store.updateProduct(product.id, { name: 'اسم جديد', stock_quantity: 10 });

    expect(store.getState().stockMovements.length).toBe(before);
  });

  it('rejects a barcode already used by another product', () => {
    makeProduct({ barcode: 'TAKEN-1' });
    const other = makeProduct({ barcode: 'FREE-1' });

    expect(() => store.updateProduct(other.id, { barcode: 'TAKEN-1' })).toThrow();
  });

  it('allows a product to keep its own barcode', () => {
    const product = makeProduct({ barcode: 'KEEP-1' });
    expect(() => store.updateProduct(product.id, { barcode: 'KEEP-1', name: 'اسم' })).not.toThrow();
  });

  it('throws for an unknown id', () => {
    expect(() => store.updateProduct('nope', { name: 'x' })).toThrow();
  });
});
