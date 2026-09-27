/**
 * Fixtures for component tests.
 *
 * Building a `Product` by hand needs a dozen fields, and a test that spells them
 * out inline obscures the behaviour it is actually asserting. These builders
 * take meaningful overrides and fill the rest with inert defaults.
 *
 * Deliberately independent of `lib/store.ts`'s demo seed, so a change to the
 * seed cannot silently change what a component test means.
 */
import type {
  Category,
  Customer,
  Expense,
  Product,
  Sale,
  SaleItem,
  Settings,
  StockMovement,
} from '../types';

let counter = 0;
/** Unique per call, so React keys and "find by id" lookups never collide. */
const nextId = (prefix: string) => `${prefix}-test-${++counter}`;

export function resetFixtureCounter(): void {
  counter = 0;
}

export function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: nextId('prod'),
    name: 'منتج اختباري',
    barcode: '',
    category_id: '',
    purchase_price: 5,
    selling_price: 10,
    average_cost: 5,
    stock_quantity: 100,
    minimum_stock: 5,
    unit: 'حبة',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

export function makeCategory(overrides: Partial<Category> = {}): Category {
  return {
    id: nextId('cat'),
    name: 'تصنيف',
    icon: 'category',
    ...overrides,
  };
}

export function makeCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: nextId('cust'),
    name: 'زبون',
    phone: '',
    balance: 0,
    credit_limit: 500,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

export function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    shop_name: 'متجر الاختبار',
    branch_name: '',
    owner_name: '',
    phone: '',
    address: '',
    currency: 'د.ل',
    tax_rate: 0,
    receipt_header: '',
    receipt_footer: '',
    sound_effects: false,
    auto_print: false,
    ...overrides,
  };
}

export function makeSaleItem(overrides: Partial<SaleItem> = {}): SaleItem {
  const quantity = overrides.quantity ?? 1;
  const unitPrice = overrides.unit_price ?? 10;
  const unitCost = overrides.unit_cost ?? 5;
  return {
    id: nextId('si'),
    sale_id: nextId('sale'),
    product_id: nextId('prod'),
    product_name: 'صنف',
    quantity,
    unit_price: unitPrice,
    unit_cost: unitCost,
    total_price: Math.round(quantity * unitPrice * 100) / 100,
    total_cost: Math.round(quantity * unitCost * 100) / 100,
    profit: Math.round(quantity * (unitPrice - unitCost) * 100) / 100,
    ...overrides,
  };
}

export function makeSale(overrides: Partial<Sale> = {}): Sale {
  const items = overrides.items ?? [makeSaleItem()];
  const totalAmount =
    overrides.total_amount ??
    Math.round(items.reduce((a, i) => a + i.total_price, 0) * 100) / 100;
  const totalCost =
    overrides.total_cost ??
    Math.round(items.reduce((a, i) => a + i.total_cost, 0) * 100) / 100;
  return {
    id: nextId('sale'),
    invoice_no: 'INV-TEST',
    total_amount: totalAmount,
    total_cost: totalCost,
    profit: Math.round((totalAmount - totalCost) * 100) / 100,
    payment_method: 'cash',
    customer_id: null,
    customer_name: 'عميل نقدي عام',
    change_amount: 0,
    items_count: items.reduce((a, i) => a + i.quantity, 0),
    created_at: new Date().toISOString(),
    items,
    ...overrides,
  };
}

export function makeExpense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: nextId('exp'),
    title: 'مصروف',
    amount: 10,
    category: 'أخرى',
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

export function makeMovement(overrides: Partial<StockMovement> = {}): StockMovement {
  return {
    id: nextId('sm'),
    product_id: nextId('prod'),
    product_name: 'صنف',
    type: 'sale',
    quantity: -1,
    remaining_stock: 10,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}
