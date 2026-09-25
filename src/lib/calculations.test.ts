import {
  calculateAverageCost,
  calculateGrossProfit,
  calculateNetProfit,
  validateStock,
} from './calculations';

export function runBusinessLogicTests() {
  const results: { test: string; passed: boolean; details: string }[] = [];

  // Test 1: Average Cost with existing stock
  // 10 units at 1.50, buy 10 at 1.70 => total 32 / 20 = 1.60
  const avg1 = calculateAverageCost(10, 1.5, 10, 1.7);
  results.push({
    test: 'حساب متوسط التكلفة مع رصيد سابق',
    passed: avg1 === 1.6,
    details: `Expected 1.60, got ${avg1}`,
  });

  // Test 2: Average Cost with 0 current stock
  const avg2 = calculateAverageCost(0, 0, 15, 2.8);
  results.push({
    test: 'حساب متوسط التكلفة عند رصيد صفر',
    passed: avg2 === 2.8,
    details: `Expected 2.80, got ${avg2}`,
  });

  // Test 3: Gross Profit = Sales Revenue - Cost of Goods Sold
  const gross = calculateGrossProfit(100, 75);
  results.push({
    test: 'حساب مجمل الربح (Gross Profit)',
    passed: gross === 25,
    details: `Expected 25.00, got ${gross}`,
  });

  // Test 4: Net Profit = Gross Profit - Expenses
  const net = calculateNetProfit(25, 10);
  results.push({
    test: 'حساب صافي الربح (Net Profit)',
    passed: net === 15,
    details: `Expected 15.00, got ${net}`,
  });

  // Test 5: Stock validation - valid request
  const validStockCheck = validateStock(3, 4);
  results.push({
    test: 'فحص توفر المخزون - كمية كافية',
    passed: validStockCheck.valid === true,
    details: 'Should allow 3 units out of 4',
  });

  // Test 6: Stock validation - insufficient stock
  const invalidStockCheck = validateStock(5, 4);
  results.push({
    test: 'فحص توفر المخزون - كمية غير كافية',
    passed: invalidStockCheck.valid === false && Boolean(invalidStockCheck.message?.includes('4')),
    details: invalidStockCheck.message || '',
  });

  return results;
}
