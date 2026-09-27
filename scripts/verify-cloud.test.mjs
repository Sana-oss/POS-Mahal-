// @vitest-environment node
//
// The live script in scripts/verify-cloud.mjs cannot be executed in CI without
// real Supabase credentials, so its invariant analysis is extracted as a pure
// function and covered here with deliberately broken fixtures. These tests prove
// the checks actually fire on bad data, which is what makes the live run
// trustworthy when it is finally pointed at a real project.

import { describe, it, expect } from 'vitest';
import { analyseIntegrity, n, near, groupBy, WATCHED_TABLES } from './verify-cloud.mjs';

const find = (results, name) => {
  const hit = results.find((r) => r.name === name);
  if (!hit) throw new Error(`no such check: ${name}`);
  return hit;
};

/** A sale whose every invariant holds: 2 lines, 30 revenue, 20 cost, 10 profit. */
const CLEAN_INVOICE = 'INV-20260928-101500-a1b2';
const CLEAN_SALE = {
  id: 1,
  invoice_no: CLEAN_INVOICE,
  customer_id: null,
  payment_method: 'cash',
  items_count: 2,
  total_amount: 30,
  total_cost: 20,
  profit: 10,
};
const CLEAN_ITEMS = [
  { id: 1, sale_id: 1, product_id: 10, quantity: 1, unit_price: 10, total_price: 10, total_cost: 5, profit: 5 },
  { id: 2, sale_id: 1, product_id: 10, quantity: 1, unit_price: 20, total_price: 20, total_cost: 15, profit: 5 },
];
// stock_movements.reference_id is TEXT and holds the invoice number, not the
// sale uuid. Mirroring the real schema here is what stops the grouping bug in
// analyseIntegrity from hiding behind fixtures that agree with the mistake.
const CLEAN_MOVES = [{ id: 1, reference_id: CLEAN_INVOICE, type: 'sale', quantity: -2 }];

const cleanData = () => ({
  sales: [CLEAN_SALE],
  saleItems: CLEAN_ITEMS,
  stockMovements: CLEAN_MOVES,
  products: [{ id: 10, name: 'قهوة', stock_quantity: 50, average_cost: 5, unit: 'كوب' }],
  customers: [],
  customerPayments: [],
  purchases: [],
  purchaseItems: [],
});

const run = (overrides) => analyseIntegrity({ ...cleanData(), ...overrides });

describe('numeric helpers', () => {
  it('reads PostgREST NUMERIC strings and nulls as numbers', () => {
    expect(n('1.250')).toBe(1.25);
    expect(n('5')).toBe(5);
    expect(n(null)).toBe(0);
    expect(n(undefined)).toBe(0);
  });

  it('tolerates sub-cent drift but catches real errors', () => {
    expect(near(10, 10.004)).toBe(true);
    expect(near(10, 10.01)).toBe(false);
  });

  it('groups rows by key without losing any', () => {
    const grouped = groupBy([{ k: 1 }, { k: 2 }, { k: 1 }], 'k');
    expect(grouped.get(1)).toHaveLength(2);
    expect(grouped.get(2)).toHaveLength(1);
  });
});

describe('analyseIntegrity on healthy data', () => {
  it('reports no violations', () => {
    const { results } = run();
    const broken = results.filter((r) => r.broken > 0);
    expect(broken).toEqual([]);
  });

  it('confirms the fixtures are recognised as having transactions', () => {
    expect(analyseIntegrity(cleanData()).hasTransactions).toBe(true);
  });

  it('marks an empty ledger as having nothing to check', () => {
    const { hasTransactions } = analyseIntegrity({});
    expect(hasTransactions).toBe(false);
  });

  it('does not flag unknown cost, which the app handles deliberately', () => {
    const { unknownCost } = run({
      products: [{ id: 11, name: 'شاي', stock_quantity: 3, average_cost: 0, unit: 'كوب' }],
    });
    expect(unknownCost).toHaveLength(1);
    expect(unknownCost[0]).toContain('شاي');
  });
});

describe('sale header invariants', () => {
  it('catches an items_count that disagrees with its lines', () => {
    const { results } = run({ sales: [{ ...CLEAN_SALE, items_count: 1 }] });
    expect(find(results, 'sales.items_count equals the sum of its line quantities').broken).toBe(1);
  });

  it('catches a total_amount that disagrees with its lines', () => {
    const { results } = run({ sales: [{ ...CLEAN_SALE, total_amount: 31 }] });
    expect(find(results, 'sales.total_amount equals the sum of its line totals').broken).toBe(1);
  });

  it('catches a total_cost that disagrees with its lines', () => {
    const { results } = run({ sales: [{ ...CLEAN_SALE, total_cost: 19 }] });
    expect(find(results, 'sales.total_cost equals the sum of its line costs').broken).toBe(1);
  });

  it('catches a profit that is not amount minus cost', () => {
    const { results } = run({ sales: [{ ...CLEAN_SALE, profit: 99 }] });
    expect(find(results, 'sales.profit equals total_amount - total_cost').broken).toBe(1);
  });

  it('catches a sale with no line items at all', () => {
    const { results } = run({ saleItems: [], stockMovements: [{ ...CLEAN_MOVES[0], quantity: 0 }] });
    const check = find(results, 'every sale has line items and a matching stock movement');
    expect(check.broken).toBeGreaterThan(0);
  });

  it('catches a sale with no stock movement', () => {
    const { results } = run({ stockMovements: [] });
    const check = find(results, 'every sale has line items and a matching stock movement');
    expect(check.broken).toBe(1);
    expect(check.details.join()).toMatch(/no stock_movements/);
  });

  it('catches a stock movement whose quantity does not match the lines', () => {
    const { results } = run({ stockMovements: [{ ...CLEAN_MOVES[0], quantity: -1 }] });
    expect(find(results, 'every sale has line items and a matching stock movement').broken).toBe(1);
  });

  // Regression: reference_id is TEXT holding the invoice number. Grouping
  // movements by reference_id but looking them up with sale.id (a uuid) never
  // matches, so every real sale was reported as missing its stock movement.
  it('matches movements by invoice number, not by the sale uuid', () => {
    const { results } = run();
    expect(find(results, 'every sale has line items and a matching stock movement').broken).toBe(0);
  });

  it('does not mistake another sale movement for this sale\'s', () => {
    const { results } = run({
      stockMovements: [{ ...CLEAN_MOVES[0], reference_id: 'INV-20260928-999999-ffff' }],
    });
    const check = find(results, 'every sale has line items and a matching stock movement');
    expect(check.broken).toBe(1);
    expect(check.details.join()).toMatch(/no stock_movements/);
  });

  it('explains a floored fractional items_count, the migration 0007 symptom', () => {
    const { results } = run({
      sales: [{ ...CLEAN_SALE, items_count: 2 }],
      saleItems: [
        { ...CLEAN_ITEMS[0], quantity: 1.5, total_price: 15, total_cost: 7.5, profit: 7.5 },
        { ...CLEAN_ITEMS[1], quantity: 0.75, total_price: 15, total_cost: 11.25, profit: 3.75 },
      ],
      stockMovements: [{ ...CLEAN_MOVES[0], quantity: -2.25 }],
    });
    const check = find(results, 'sales.items_count equals the sum of its line quantities');
    expect(check.broken).toBe(1);
    expect(check.hint).toMatch(/0007/);
  });

  it('accepts a correct fractional items_count', () => {
    const { results } = run({
      sales: [{ ...CLEAN_SALE, items_count: 2.25, total_amount: 30, total_cost: 18.75, profit: 11.25 }],
      saleItems: [
        { ...CLEAN_ITEMS[0], quantity: 1.5, total_price: 15, total_cost: 7.5, profit: 7.5 },
        { ...CLEAN_ITEMS[1], quantity: 0.75, total_price: 15, total_cost: 11.25, profit: 3.75 },
      ],
      stockMovements: [{ ...CLEAN_MOVES[0], quantity: -2.25 }],
    });
    expect(find(results, 'sales.items_count equals the sum of its line quantities').broken).toBe(0);
  });
});

describe('sale line invariants', () => {
  it('catches a total_price that is not quantity times unit_price', () => {
    const { results } = run({ saleItems: [{ ...CLEAN_ITEMS[0], total_price: 12 }] });
    const check = find(results, 'each sale line: total_price = quantity x unit_price and profit = price - cost');
    expect(check.broken).toBeGreaterThan(0);
    expect(check.details.join()).toMatch(/total_price/);
  });

  it('catches a line profit that is not price minus cost', () => {
    const { results } = run({ saleItems: [{ ...CLEAN_ITEMS[0], profit: 1 }] });
    const check = find(results, 'each sale line: total_price = quantity x unit_price and profit = price - cost');
    expect(check.broken).toBeGreaterThan(0);
    expect(check.details.join()).toMatch(/profit/);
  });
});

describe('purchase invariants', () => {
  it('catches a mismatched items_count and total_amount', () => {
    const { results } = run({
      purchases: [{ id: 5, invoice_no: 'P-001', items_count: 3, total_amount: 40 }],
      purchaseItems: [
        { id: 1, purchase_id: 5, product_id: 10, quantity: 2, unit_cost: 10, total_cost: 20 },
      ],
    });
    expect(find(results, 'purchases.items_count equals the sum of its line quantities').broken).toBe(1);
    expect(find(results, 'purchases.total_amount equals the sum of its line costs').broken).toBe(1);
  });

  it('accepts a consistent purchase', () => {
    const { results } = run({
      purchases: [{ id: 5, invoice_no: 'P-001', items_count: 2, total_amount: 20 }],
      purchaseItems: [
        { id: 1, purchase_id: 5, product_id: 10, quantity: 2, unit_cost: 10, total_cost: 20 },
      ],
    });
    expect(results.filter((r) => r.broken > 0)).toEqual([]);
  });

  it('emits no purchase checks at all when there are no purchases', () => {
    const { results } = run();
    expect(results.some((r) => r.name.startsWith('purchases.'))).toBe(false);
  });
});

describe('customer ledger invariants', () => {
  it('accepts a fully settled customer', () => {
    const { results } = run({
      customers: [{ id: 1, name: 'احمد', balance: 0 }],
      sales: [{ ...CLEAN_SALE, customer_id: 1, payment_method: 'debt', total_amount: 50 }],
      customerPayments: [{ id: 1, customer_id: 1, amount: 50 }],
    });
    expect(find(results, 'every customer balance is explained by their debt sales and payments').broken).toBe(0);
  });

  it('catches a balance that no sale or payment explains', () => {
    const { results } = run({
      customers: [{ id: 1, name: 'احمد', balance: 0 }],
      sales: [{ ...CLEAN_SALE, customer_id: 1, payment_method: 'debt', total_amount: 50 }],
      customerPayments: [],
    });
    expect(find(results, 'every customer balance is explained by their debt sales and payments').broken).toBe(1);
  });

  it('catches a negative balance even though the column forbids one', () => {
    const { results } = run({ customers: [{ id: 2, name: 'سالم', balance: -5 }] });
    expect(find(results, 'no customer has a negative balance').broken).toBe(1);
  });
});

describe('product invariants', () => {
  it('catches negative stock', () => {
    const { results } = run({
      products: [{ id: 10, name: 'قهوة', stock_quantity: -1, average_cost: 5, unit: 'كوب' }],
    });
    expect(find(results, 'no product has negative stock').broken).toBe(1);
  });
});

describe('watched table list', () => {
  it('covers the tables the client subscribes to', () => {
    expect(WATCHED_TABLES).toEqual(
      expect.arrayContaining(['products', 'sales', 'sale_items', 'stock_movements'])
    );
    expect(new Set(WATCHED_TABLES).size).toBe(WATCHED_TABLES.length);
  });
});
