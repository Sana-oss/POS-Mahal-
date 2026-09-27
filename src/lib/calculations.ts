/**
 * Mahall POS - Financial and Business Calculations Engine
 * Strictly enforces business rules specified in the PRD:
 * 1. Gross Profit = Sales Revenue - Cost of Goods Sold
 * 2. Net Profit = Gross Profit - Expenses
 * 3. Weighted Average Cost calculation with zero-stock handling
 * 4. sale_items.unit_cost recorded at the exact moment of sale
 */

import { CartItem } from '../types';

/**
 * Calculates the new weighted average cost upon restocking a product.
 * Correctly handles: zero current stock, negative stock anomaly, first purchase, decimal numbers.
 *
 * This MUST stay in step with the identical formula in the Postgres RPC
 * `rpc_execute_purchase` (supabase/migrations/0003_server_authoritative_pricing.sql).
 * The two run in different storage modes, so a divergence here shows up as the
 * UI announcing one average cost while the database stores another.
 *
 * @param currentPurchasePrice the product's stored `purchase_price`. Used as the
 *   fallback when `currentAverageCost` is 0 or less, because that is what the
 *   SQL substitutes. Falling back to `purchaseUnitCost` instead (the previous
 *   behaviour) made a 10-unit buy at 2.00 preview as 2.00 where the database
 *   wrote 3.50 for a product whose stored purchase price was 5.00.
 */
export function calculateAverageCost(
  currentStock: number,
  currentAverageCost: number,
  purchaseQuantity: number,
  purchaseUnitCost: number,
  currentPurchasePrice: number
): number {
  if (purchaseQuantity <= 0) {
    return currentAverageCost;
  }

  // If current stock is zero or less, new average cost is simply the purchase unit cost
  if (currentStock <= 0) {
    return roundCurrency(purchaseUnitCost);
  }

  const fallbackCost = currentPurchasePrice > 0 ? currentPurchasePrice : purchaseUnitCost;
  const currentTotalCost = currentStock * (currentAverageCost > 0 ? currentAverageCost : fallbackCost);
  const additionalCost = purchaseQuantity * purchaseUnitCost;
  const totalStock = currentStock + purchaseQuantity;

  if (totalStock <= 0) {
    return roundCurrency(purchaseUnitCost);
  }

  const newAverage = (currentTotalCost + additionalCost) / totalStock;
  return roundCurrency(newAverage);
}

/**
 * Calculates Gross Profit: Sales Revenue - Cost of Goods Sold
 */
export function calculateGrossProfit(revenue: number, cogs: number): number {
  return roundCurrency(revenue - cogs);
}

/**
 * Calculates Net Profit: Gross Profit - Expenses
 * Note: Expenses affect Net Profit only, NEVER Gross Profit!
 */
export function calculateNetProfit(grossProfit: number, expenses: number): number {
  return roundCurrency(grossProfit - expenses);
}

/**
 * Validates whether the requested quantity can be fulfilled from current stock.
 * Returns { valid: boolean, message?: string }
 */
export function validateStock(
  requestedQuantity: number,
  availableStock: number
): { valid: boolean; message?: string } {
  if (requestedQuantity <= 0) {
    return { valid: false, message: 'الكمية يجب أن تكون أكبر من الصفر' };
  }

  if (requestedQuantity > availableStock) {
    return {
      valid: false,
      message: `الكمية المتوفرة فقط ${availableStock} قطع.`,
    };
  }

  return { valid: true };
}

/**
 * Aggregates cart totals: Revenue, COGS, Gross Profit, Total items
 */
export function calculateCartSummary(items: CartItem[]): {
  totalAmount: number;
  totalCost: number;
  grossProfit: number;
  totalItemsCount: number;
  distinctProductsCount: number;
} {
  let totalAmount = 0;
  let totalCost = 0;
  let totalItemsCount = 0;

  for (const item of items) {
    totalAmount += item.total_price;
    totalCost += item.total_cost;
    totalItemsCount += item.quantity;
  }

  const grossProfit = calculateGrossProfit(totalAmount, totalCost);

  return {
    totalAmount: roundCurrency(totalAmount),
    totalCost: roundCurrency(totalCost),
    grossProfit: roundCurrency(grossProfit),
    totalItemsCount,
    distinctProductsCount: items.length,
  };
}

/**
 * Rounds a monetary figure to 2 decimal places to prevent floating-point inaccuracies
 */
export function roundCurrency(value: number): number {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

/**
 * Rounds a quantity to 3 decimal places, matching the NUMERIC(10,3) columns that
 * store stock and item quantities in Postgres.
 *
 * Cloud mode is safe from float drift because the database rounds on write. The
 * local-only store keeps everything in JavaScript, where repeated subtraction
 * drifts: 0.1 + 0.2 === 0.30000000000000004, so a fractional stock figure could
 * render as "0.30000000000000004" in the inventory list. Rounding at every stock
 * mutation keeps the two storage modes presenting the same number.
 */
export function roundQuantity(value: number): number {
  return Math.round((Number(value) + Number.EPSILON) * 1000) / 1000;
}

/**
 * Derives a customer's opening balance from their current balance and their
 * recorded movements.
 *
 * `customers.balance` is authoritative, but the opening figure the cashier typed
 * when creating the customer is not stored separately - it only survives as the
 * difference. Without this, a statement of credit sales and payments cannot be
 * reconciled with the balance shown above it.
 *
 * A NEGATIVE result means the movements exceed the recorded balance, i.e. the
 * underlying rows are inconsistent. It is returned as-is rather than clamped,
 * because hiding it would conceal the inconsistency.
 */
export function deriveOpeningBalance(
  currentBalance: number,
  creditSaleTotals: number[],
  paymentAmounts: number[]
): number {
  const fromSales = creditSaleTotals.reduce((acc, v) => acc + v, 0);
  const fromPayments = paymentAmounts.reduce((acc, v) => acc + v, 0);
  return roundCurrency(currentBalance - fromSales + fromPayments);
}

/**
 * Format currency with natural Arabic display
 */
export function formatCurrency(amount: number, currency: string = 'د.ل'): string {
  const rounded = roundCurrency(amount);
  return `${rounded.toFixed(2)} ${currency}`;
}

/**
 * Format date in natural Arabic format
 */
export function formatArabicDate(dateStr: string | Date): string {
  const date = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
  return new Intl.DateTimeFormat('ar-LY', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatTimeOnly(dateStr: string | Date): string {
  const date = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
  return new Intl.DateTimeFormat('ar-LY', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
