import { describe, it, expect } from 'vitest';
import {
  mapProduct,
  mapCategory,
  mapCustomer,
  mapExpense,
  mapPayment,
  mapMovement,
  mapSaleItem,
  mapSale,
  mapPurchaseItem,
  mapPurchase,
  mapSettings,
  cloudError,
} from './cloudSync';
import { makeSettings } from '../test/fixtures';

/**
 * PostgREST returns every NUMERIC column as a STRING ("12.50"), because NUMERIC
 * has unbounded precision that JSON numbers cannot represent. So the single most
 * important thing these mappers do is turn "12.50" into 12.5. If that coercion
 * broke, every price, cost and balance in the app would silently read 0 -- with
 * no error anywhere. cloudSync.ts had no coverage at all before this.
 */

const UUID = '11111111-2222-3333-4444-555555555555';

describe('cloudSync - NUMERIC string coercion', () => {
  it('turns Postgres numeric strings into real numbers', () => {
    // Exactly how PostgREST serialises NUMERIC(12,2).
    const product = mapProduct({
      id: UUID,
      name: 'حليب',
      barcode: '111',
      category_id: 'cat',
      purchase_price: '7.25' as unknown as number,
      selling_price: '12.50' as unknown as number,
      average_cost: '7.25' as unknown as number,
      stock_quantity: '40.000' as unknown as number,
      minimum_stock: '5.000' as unknown as number,
      unit: 'كيس',
      shelf_location: null,
      image_url: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    } as never);

    expect(product.purchase_price).toBe(7.25);
    expect(product.selling_price).toBe(12.5);
    expect(product.average_cost).toBe(7.25);
    // Trailing zeros must not survive as strings, and the 3dp column is exact.
    expect(product.stock_quantity).toBe(40);
    expect(typeof product.selling_price).toBe('number');
    expect(typeof product.stock_quantity).toBe('number');
  });

  it('keeps a fractional stock value exact', () => {
    const product = mapProduct({
      id: UUID,
      name: 'طماطم',
      barcode: null,
      category_id: null,
      purchase_price: '2.00',
      selling_price: '4.00',
      average_cost: '2.00',
      stock_quantity: '2.500',
      minimum_stock: '1.000',
      unit: 'كجم',
      shelf_location: null,
      image_url: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    } as never);

    expect(product.stock_quantity).toBe(2.5);
  });

  it('falls back to 0 for a null or empty numeric column', () => {
    const product = mapProduct({
      id: UUID,
      name: 'بلا أرقام',
      barcode: null,
      category_id: null,
      purchase_price: null,
      selling_price: '',
      average_cost: undefined,
      stock_quantity: null,
      minimum_stock: null,
      unit: null,
      shelf_location: null,
      image_url: null,
      created_at: null,
      updated_at: null,
    } as never);

    expect(product.selling_price).toBe(0);
    expect(product.stock_quantity).toBe(0);
  });

  it('falls back to 0 for a non-numeric value rather than producing NaN', () => {
    // NaN would poison every sum it entered.
    const product = mapProduct({
      id: UUID,
      name: 'تالف',
      barcode: null,
      category_id: null,
      purchase_price: 'غير رقم',
      selling_price: 'abc',
      average_cost: null,
      stock_quantity: 'x',
      minimum_stock: null,
      unit: null,
      shelf_location: null,
      image_url: null,
      created_at: null,
      updated_at: null,
    } as never);

    expect(product.selling_price).toBe(0);
    expect(product.stock_quantity).toBe(0);
    expect(Number.isNaN(product.selling_price)).toBe(false);
  });
});

describe('cloudSync - text and null handling', () => {
  it('never renders the string "null" for a missing text column', () => {
    const category = mapCategory({ id: 'c', name: null, icon: null, color: null } as never);
    expect(category.name).toBe('');
    expect(category.icon).toBe('category');
    // An empty column becomes undefined, not '', so the UI omits the node.
    expect(category.color).toBeUndefined();
  });

  it('supplies a default unit so a product is never unitless', () => {
    const product = mapProduct({ id: 'p', name: 'x', unit: null } as never);
    expect(product.unit).toBe('حبة');
  });

  it('supplies a default expense category', () => {
    expect(mapExpense({ id: 'e', title: 't', amount: '5', category: null } as never).category).toBe(
      'أخرى'
    );
  });

  it('defaults an unknown movement type to adjustment', () => {
    const movement = mapMovement({
      id: 'm',
      product_id: 'p',
      product_name: 'x',
      type: null,
      quantity: '-1',
      remaining_stock: '9',
    } as never);
    expect(movement.type).toBe('adjustment');
    expect(movement.quantity).toBe(-1);
  });

  it('substitutes a now timestamp for a missing created_at', () => {
    const product = mapProduct({ id: 'p', name: 'x', created_at: null } as never);
    expect(Number.isNaN(Date.parse(product.created_at))).toBe(false);
  });

  it('maps a customer balance from a numeric string', () => {
    const customer = mapCustomer({
      id: 'c',
      name: 'أبو سالم',
      phone: null,
      balance: '1250.75',
      credit_limit: '500.00',
      notes: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    } as never);

    expect(customer.balance).toBe(1250.75);
    expect(customer.phone).toBe('');
    expect(customer.notes).toBeUndefined();
  });

  it('maps a payment with its before/after balances', () => {
    const payment = mapPayment({
      id: 'pay',
      customer_id: 'c',
      customer_name: 'أبو سالم',
      amount: '20.00',
      previous_balance: '70.00',
      new_balance: '50.00',
      note: null,
      created_at: '2026-01-01T00:00:00Z',
    } as never);

    expect(payment.amount).toBe(20);
    expect(payment.previous_balance).toBe(70);
    expect(payment.new_balance).toBe(50);
  });
});

describe('cloudSync - mapSale', () => {
  const baseRow = {
    id: 's1',
    invoice_no: 'INV-1',
    total_amount: '100.00',
    total_cost: '60.00',
    profit: '40.00',
    payment_method: 'cash',
    customer_id: null,
    customer_name: null,
    received_amount: null,
    change_amount: '0.00',
    items_count: '2.000',
    notes: null,
    created_at: '2026-01-01T00:00:00Z',
  };

  it('maps a cash sale with no customer', () => {
    const sale = mapSale(baseRow as never);
    expect(sale.total_amount).toBe(100);
    expect(sale.profit).toBe(40);
    expect(sale.customer_id).toBeNull();
    expect(sale.customer_name).toBe('عميل نقدي عام');
  });

  it('maps received_amount to undefined when the column is null', () => {
    // The receipt hides its received/change block on undefined, and shows a
    // misleading "received 0.00" if this were 0 or null.
    expect(mapSale(baseRow as never).received_amount).toBeUndefined();
    expect(mapSale({ ...baseRow, received_amount: '50.00' } as never).received_amount).toBe(50);
  });

  it('never reports a negative change', () => {
    const sale = mapSale({ ...baseRow, change_amount: '-5.00' } as never);
    expect(sale.change_amount).toBe(0);
  });

  it('resolves the customer name through the lookup map', () => {
    const names = new Map([['c9', 'أبو سالم']]);
    const sale = mapSale({ ...baseRow, customer_id: 'c9' } as never, names);
    expect(sale.customer_name).toBe('أبو سالم');
  });

  it('prefers the name stored on the row over the lookup', () => {
    const names = new Map([['c9', 'اسم قديم']]);
    const sale = mapSale({ ...baseRow, customer_id: 'c9', customer_name: 'الاسم الحالي' } as never, names);
    expect(sale.customer_name).toBe('الاسم الحالي');
  });

  it('leaves a debt customer name empty rather than calling them a cash customer', () => {
    // Falling back to "عميل نقدي عام" for a debt sale would print a cash name on
    // an invoice that is owed money.
    const sale = mapSale({ ...baseRow, customer_id: 'c9', payment_method: 'debt' } as never);
    expect(sale.customer_name).toBe('');
  });

  it('defaults an unknown payment method to cash', () => {
    expect(mapSale({ ...baseRow, payment_method: null } as never).payment_method).toBe('cash');
  });

  it('maps embedded line items and an absent items array', () => {
    const withItems = mapSale({
      ...baseRow,
      items: [
        {
          id: 'si1',
          sale_id: 's1',
          product_id: 'p1',
          product_name: 'حليب',
          barcode: '111',
          quantity: '2.500',
          unit_price: '40.00',
          unit_cost: '24.00',
          total_price: '100.00',
          total_cost: '60.00',
          profit: '40.00',
        },
      ],
    } as never);

    expect(withItems.items).toHaveLength(1);
    expect(withItems.items[0].quantity).toBe(2.5);
    expect(withItems.items[0].barcode).toBe('111');

    expect(mapSale(baseRow as never).items).toEqual([]);
  });

  it('keeps a fractional items_count', () => {
    expect(mapSale({ ...baseRow, items_count: '2.500' } as never).items_count).toBe(2.5);
  });
});

describe('cloudSync - mapPurchase', () => {
  it('maps a purchase with its lines', () => {
    const purchase = mapPurchase({
      id: 'p1',
      invoice_no: 'PUR-1',
      supplier_name: 'شركة المراعي',
      total_amount: '400.00',
      items_count: '20.000',
      notes: null,
      created_at: '2026-01-01T00:00:00Z',
      items: [
        {
          id: 'pi1',
          purchase_id: 'p1',
          product_id: 'pr1',
          product_name: 'حليب',
          quantity: '20.000',
          unit_cost: '20.00',
          total_cost: '400.00',
        },
      ],
    } as never);

    expect(purchase.total_amount).toBe(400);
    expect(purchase.items_count).toBe(20);
    expect(purchase.items[0].quantity).toBe(20);
    expect(purchase.items[0].total_cost).toBe(400);
  });

  it('supplies a default supplier name', () => {
    expect(
      mapPurchase({ id: 'p', invoice_no: 'x', supplier_name: null, total_amount: '0' } as never)
        .supplier_name
    ).toBe('مورّد عام');
  });
});

describe('cloudSync - mapSettings', () => {
  it('returns a copy of the fallback when no row exists', () => {
    const fallback = makeSettings({ shop_name: 'محلي' });
    const result = mapSettings(null, fallback);
    expect(result).toEqual(fallback);
    // A copy, not the same object: mutating the result must not corrupt the seed.
    expect(result).not.toBe(fallback);
  });

  it('prefers stored values over the fallback', () => {
    const result = mapSettings(
      { shop_id: 's', shop_name: 'متجر السحابة', currency: 'د.إ' } as never,
      makeSettings({ shop_name: 'محلي', currency: 'د.ل' })
    );
    expect(result.shop_name).toBe('متجر السحابة');
    expect(result.currency).toBe('د.إ');
  });

  it('falls back field by field for a null column', () => {
    const fallback = makeSettings({ shop_name: 'محلي', phone: '09' });
    const result = mapSettings({ shop_id: 's', shop_name: 'سحابي', phone: null } as never, fallback);
    expect(result.shop_name).toBe('سحابي');
    expect(result.phone).toBe('09');
  });

  it('coerces the tax rate from a numeric string', () => {
    const result = mapSettings({ shop_id: 's', tax_rate: '10.00' } as never, makeSettings());
    expect(result.tax_rate).toBe(10);
  });

  it('keeps boolean flags, falling back when null', () => {
    const fallback = makeSettings({ sound_effects: true, auto_print: true });
    const result = mapSettings(
      { shop_id: 's', sound_effects: false, auto_print: null } as never,
      fallback
    );
    expect(result.sound_effects).toBe(false);
    expect(result.auto_print).toBe(true);
  });
});

describe('cloudSync - error translation', () => {
  it('reports the available stock when the server rejects a sale', () => {
    const err = cloudError({ message: 'Insufficient stock for product Arroz (Available: 3)' });
    expect(err.message).toContain('3');
  });

  it('translates an RLS rejection into an actionable message', () => {
    expect(cloudError({ message: 'new row violates row-level security policy' }).message).toMatch(
      /صلاحية/
    );
  });

  it('translates a duplicate barcode', () => {
    expect(cloudError({ message: 'duplicate key value violates unique constraint "products_barcode"' }).message)
      .toMatch(/الباركود/);
  });

  it('explains a foreign-key failure as a history block', () => {
    expect(cloudError({ message: 'violates foreign key constraint' }).message).toMatch(/سجلات|فواتير/);
  });

  it('translates an overpayment', () => {
    expect(cloudError({ message: 'payment amount exceeds customer balance' }).message).toMatch(/أكبر من رصيد/);
  });

  it('reports a network failure distinctly from a data problem', () => {
    expect(cloudError({ message: 'TypeError: Failed to fetch' }).message).toMatch(/الإنترنت|الاتصال/);
  });

  it('passes an unmapped message through unchanged', () => {
    expect(cloudError({ message: 'something else entirely' }).message).toBe('something else entirely');
  });

  it('uses the supplied fallback when there is no message at all', () => {
    expect(cloudError(null, 'رسالة بديلة').message).toBe('رسالة بديلة');
    expect(cloudError(undefined).message).toMatch(/تعذر/);
  });
});
