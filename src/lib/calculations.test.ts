import { describe, it, expect } from 'vitest';
import {
  calculateAverageCost,
  calculateGrossProfit,
  calculateNetProfit,
  calculateCartSummary,
  deriveOpeningBalance,
  validateStock,
  roundCurrency,
  roundQuantity,
} from './calculations';
import type { CartItem } from '../types';

/**
 * Pure business rules, per the PRD:
 *  - Gross Profit = Revenue - COGS
 *  - Net Profit   = Gross Profit - Expenses
 *  - Weighted average cost, with correct zero-stock handling
 */

describe('calculateAverageCost', () => {
  // Signature: (currentStock, currentAverageCost, purchaseQuantity, purchaseUnitCost, currentPurchasePrice)
  it('blends existing stock with a new purchase (PRD worked example)', () => {
    // 10 units at 1.50, buy 10 at 1.70 => 32 / 20 = 1.60
    expect(calculateAverageCost(10, 1.5, 10, 1.7, 1.5)).toBe(1.6);
  });

  it('uses the purchase cost when current stock is zero', () => {
    expect(calculateAverageCost(0, 0, 15, 2.8, 0)).toBe(2.8);
  });

  it('uses the purchase cost when current stock is negative (defensive)', () => {
    expect(calculateAverageCost(-5, 3, 10, 1.25, 3)).toBe(1.25);
  });

  it('leaves the average untouched for a zero-quantity purchase', () => {
    expect(calculateAverageCost(10, 1.5, 0, 9.99, 1.5)).toBe(1.5);
  });

  it('keeps the average steady when buying at the current average', () => {
    expect(calculateAverageCost(40, 2, 10, 2, 2)).toBe(2);
  });

  it('rounds to 2 decimals', () => {
    expect(calculateAverageCost(3, 1, 3, 2, 1)).toBe(1.5);
    expect(calculateAverageCost(1, 0.1, 2, 0.2, 0.1)).toBe(0.17);
  });

  describe('agrees with rpc_execute_purchase when average_cost is 0', () => {
    // Regression: the fallback used to be the INCOMING unit cost, while the SQL
    // substitutes the product's STORED purchase_price. So the UI previewed one
    // average cost and the database stored another, and the stored value is the
    // frozen unit_cost basis for every future sale's profit.
    //
    // SQL: ROUND(((stock * (CASE WHEN avg>0 THEN avg ELSE purchase_price END))
    //            + qty*unit_cost) / (stock + qty), 2)
    it('falls back to the stored purchase price, not the incoming cost', () => {
      // stock 10, avg 0, stored purchase_price 5.00, buy 10 @ 2.00
      // (10*5 + 10*2) / 20 = 70/20 = 3.50   (was 2.00)
      expect(calculateAverageCost(10, 0, 10, 2, 5)).toBe(3.5);
    });

    it('matches the SQL on a second shape', () => {
      // stock 8, avg 0, stored 3.40, buy 2 @ 3.00
      // (8*3.4 + 2*3) / 10 = 33.2/10 = 3.32   (was 3.00)
      expect(calculateAverageCost(8, 0, 2, 3, 3.4)).toBe(3.32);
    });

    it('matches the SQL on a third shape', () => {
      // stock 2, avg 0, stored 32.00, buy 10 @ 30.00
      // (2*32 + 10*30) / 12 = 364/12 = 30.33  (was 30.00)
      expect(calculateAverageCost(2, 0, 10, 30, 32)).toBe(30.33);
    });

    it('still prefers the existing average when it is set', () => {
      // avg 4.00 wins over stored purchase_price 9.00
      expect(calculateAverageCost(10, 4, 10, 2, 9)).toBe(3);
    });

    it('degrades to the incoming cost when the stored price is also 0', () => {
      // Nothing to fall back to but the incoming cost.
      expect(calculateAverageCost(10, 0, 10, 2, 0)).toBe(2);
    });
  });
});

describe('calculateGrossProfit', () => {
  it('is revenue minus cost of goods sold', () => {
    expect(calculateGrossProfit(100, 75)).toBe(25);
  });

  it('is negative when sold below cost', () => {
    expect(calculateGrossProfit(10, 12)).toBe(-2);
  });

  it('is zero at break-even', () => {
    expect(calculateGrossProfit(20, 20)).toBe(0);
  });
});

describe('calculateNetProfit', () => {
  it('is gross profit minus expenses', () => {
    expect(calculateNetProfit(25, 10)).toBe(15);
  });

  it('goes negative when expenses exceed gross profit', () => {
    expect(calculateNetProfit(5, 40)).toBe(-35);
  });

  it('is unaffected by expenses when gross profit is zero', () => {
    expect(calculateNetProfit(0, 0)).toBe(0);
  });
});

describe('validateStock', () => {
  it('allows a quantity equal to the available stock', () => {
    expect(validateStock(4, 4).valid).toBe(true);
  });

  it('allows a quantity below the available stock', () => {
    expect(validateStock(3, 4).valid).toBe(true);
  });

  it('rejects a quantity above the available stock with the available figure', () => {
    const result = validateStock(5, 4);
    expect(result.valid).toBe(false);
    expect(result.message).toContain('4');
  });

  it('rejects zero and negative quantities', () => {
    expect(validateStock(0, 10).valid).toBe(false);
    expect(validateStock(-3, 10).valid).toBe(false);
  });

  it('rejects any quantity when nothing is in stock', () => {
    expect(validateStock(1, 0).valid).toBe(false);
  });
});

describe('calculateCartSummary', () => {
  function line(partial: Partial<CartItem>): CartItem {
    return {
      product: {
        id: 'p',
        name: 'p',
        barcode: '',
        category_id: '',
        purchase_price: 0,
        selling_price: 0,
        average_cost: 0,
        stock_quantity: 0,
        minimum_stock: 0,
        unit: 'piece',
        created_at: '',
        updated_at: '',
      },
      quantity: 1,
      unit_price: 0,
      unit_cost: 0,
      total_price: 0,
      total_cost: 0,
      profit: 0,
      ...partial,
    };
  }

  it('sums the pre-computed line totals', () => {
    const summary = calculateCartSummary([
      line({ quantity: 4, total_price: 8, total_cost: 4 }),
      line({ quantity: 2, total_price: 6, total_cost: 3 }),
    ]);
    expect(summary.totalAmount).toBe(14);
    expect(summary.totalCost).toBe(7);
    expect(summary.grossProfit).toBe(7);
  });

  it('counts units, not lines', () => {
    const summary = calculateCartSummary([
      line({ quantity: 4 }),
      line({ quantity: 2 }),
      line({ quantity: 1 }),
    ]);
    expect(summary.totalItemsCount).toBe(7);
    expect(summary.distinctProductsCount).toBe(3);
  });

  it('returns zeroes for an empty cart', () => {
    const summary = calculateCartSummary([]);
    expect(summary.totalAmount).toBe(0);
    expect(summary.totalCost).toBe(0);
    expect(summary.grossProfit).toBe(0);
    expect(summary.totalItemsCount).toBe(0);
  });

  it('handles fractional quantities without losing them', () => {
    const summary = calculateCartSummary([line({ quantity: 1.5, total_price: 3, total_cost: 1.5 })]);
    expect(summary.totalItemsCount).toBe(1.5);
  });
});

describe('deriveOpeningBalance', () => {
  it('is zero when the movements fully explain the balance', () => {
    // Customer owes 40, one credit sale of 40, nothing paid.
    expect(deriveOpeningBalance(40, [40], [])).toBe(0);
  });

  it('recovers a prior opening balance', () => {
    // Owes 45, one credit sale of 74 -> 29 of prior debt is unexplained.
    expect(deriveOpeningBalance(45, [74], [])).toBe(-29);
  });

  it('accounts for payments made since', () => {
    // Owes 10: opened at 0, bought 50 on credit, paid 40.
    expect(deriveOpeningBalance(10, [50], [40])).toBe(0);
  });

  it('recovers an opening balance alongside sales and payments', () => {
    // Opened at 100, bought 50, paid 30 -> 120 now; opening = 120-50+30 = 100
    expect(deriveOpeningBalance(120, [50], [30])).toBe(100);
  });

  it('is zero for a brand new customer with no movements', () => {
    expect(deriveOpeningBalance(0, [], [])).toBe(0);
  });

  it('surfaces an inconsistency instead of clamping it', () => {
    // Movements exceed the recorded balance. Returning the negative number is
    // deliberate: hiding it would conceal inconsistent rows.
    expect(deriveOpeningBalance(5, [100], [])).toBe(-95);
  });

  it('handles multiple sales and payments', () => {
    expect(deriveOpeningBalance(30, [20, 30, 10], [5, 25])).toBe(0);
  });
});

describe('roundQuantity', () => {
  it('rounds to 3 decimals, matching NUMERIC(10,3)', () => {
    expect(roundQuantity(2.5005)).toBe(2.501);
    expect(roundQuantity(1.2345)).toBe(1.235);
  });

  it('is stable against classic float error', () => {
    expect(roundQuantity(0.1 + 0.2)).toBe(0.3);
  });

  it('leaves whole numbers alone', () => {
    expect(roundQuantity(7)).toBe(7);
  });

  it('keeps fractional stock free of drift over repeated subtraction', () => {
    // Without rounding, local mode would drift where the NUMERIC(10,3) column
    // would not, and the inventory list could show 0.30000000000000004.
    let stock = 1;
    stock = roundQuantity(stock - 0.1);
    stock = roundQuantity(stock - 0.2);
    expect(stock).toBe(0.7);
  });
});

describe('roundCurrency', () => {
  it('rounds to 2 decimals', () => {
    expect(roundCurrency(1.005)).toBe(1.01);
    expect(roundCurrency(2.346)).toBe(2.35);
  });

  it('is stable against classic float error', () => {
    // 0.1 + 0.2 === 0.30000000000000004 in IEEE 754.
    expect(roundCurrency(0.1 + 0.2)).toBe(0.3);
  });

  it('propagates NaN rather than silently pricing a line at zero', () => {
    // Documented limitation, not a desired behaviour: roundCurrency does not
    // guard non-numeric input, so a NaN price would flow into a sale total.
    // Call sites currently coerce with `Number(x) || 0` before calling.
    expect(roundCurrency(Number('abc') as unknown as number)).toBeNaN();
  });
});
