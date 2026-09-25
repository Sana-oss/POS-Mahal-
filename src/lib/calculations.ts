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
 */
export function calculateAverageCost(
  currentStock: number,
  currentAverageCost: number,
  purchaseQuantity: number,
  purchaseUnitCost: number
): number {
  if (purchaseQuantity <= 0) {
    return currentAverageCost;
  }

  // If current stock is zero or less, new average cost is simply the purchase unit cost
  if (currentStock <= 0) {
    return roundCurrency(purchaseUnitCost);
  }

  const currentTotalCost = currentStock * (currentAverageCost > 0 ? currentAverageCost : purchaseUnitCost);
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
