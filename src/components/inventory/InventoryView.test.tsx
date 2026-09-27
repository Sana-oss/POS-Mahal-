// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InventoryView } from './InventoryView';
import { store } from '../../lib/store';

vi.mock('../../lib/audio', () => ({ playSound: vi.fn() }));
vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

const noop = () => {};

function renderInventory() {
  return render(
    <InventoryView onOpenScanner={noop} onOpenAddProduct={noop} onRestockProduct={noop} />
  );
}

/**
 * Scope to one product's table row. The demo seed renders a dozen products, so
 * every row carries its own edit and delete buttons.
 */
function rowFor(name: string): HTMLElement {
  const cell = screen.getByText(name);
  const row = cell.closest('tr');
  if (!row) throw new Error(`no table row for ${name}`);
  return row as HTMLElement;
}

const editDialog = () => screen.getByRole('dialog', { name: 'تعديل بيانات المنتج' });
const deleteDialog = () => screen.getByRole('dialog', { name: 'تأكيد حذف الصنف' });

/**
 * A product whose average_cost was set by a purchase rather than typed in.
 * After the purchase: stock 40, average_cost 5, purchase_price 8.
 */
function seedRestockedProduct() {
  const product = store.addProduct({
    name: 'حليب',
    barcode: '222222',
    category_id: '',
    purchase_price: 2,
    selling_price: 10,
    average_cost: 2,
    stock_quantity: 20,
    minimum_stock: 1,
    unit: 'حبة',
  });
  store.executePurchase({
    supplierName: 'مورد',
    items: [{ productId: product.id, quantity: 20, unitCost: 8 }],
  });
  return store.getProductById(product.id)!;
}

beforeEach(() => {
  store.resetToDefault();
});

describe('InventoryView - editing a product', () => {
  it('does not overwrite average_cost when the purchase cost is edited', async () => {
    // Regression: the single cost field was written to BOTH purchase_price and
    // average_cost. average_cost is the frozen unit_cost basis for every future
    // sale's profit, so one edit permanently skewed reported gross profit.
    const user = userEvent.setup();
    const product = seedRestockedProduct();
    expect(product.average_cost).toBe(5); // (20*2 + 20*8) / 40
    expect(product.purchase_price).toBe(8);

    renderInventory();
    await user.click(within(rowFor('حليب')).getByTitle('تعديل بيانات'));

    // The form loads the last purchase price, which the purchase just set to 8.
    const costField = within(editDialog()).getByDisplayValue('8');
    await user.clear(costField);
    await user.type(costField, '9.99');
    await user.click(within(editDialog()).getByText('حفظ التعديلات'));

    const updated = store.getProductById(product.id)!;
    expect(updated.purchase_price).toBe(9.99);
    expect(updated.average_cost).toBe(5);
  });

  it('shows the computed average cost as a read-only figure', async () => {
    const user = userEvent.setup();
    seedRestockedProduct();
    renderInventory();

    await user.click(within(rowFor('حليب')).getByTitle('تعديل بيانات'));

    // Displayed, but not an editable input: it is derived from purchases, so the
    // form deliberately offers no field for it. The figure is present as text and
    // absent as an input value.
    expect(within(editDialog()).getByText('متوسط التكلفة (محسوب)')).toBeInTheDocument();
    expect(within(editDialog()).getByText('5.00')).toBeInTheDocument();
    expect(within(editDialog()).queryByDisplayValue('5.00')).not.toBeInTheDocument();
    expect(within(editDialog()).queryByDisplayValue('5')).not.toBeInTheDocument();
  });

  it('updates the selling price', async () => {
    const user = userEvent.setup();
    const product = seedRestockedProduct();
    renderInventory();

    await user.click(within(rowFor('حليب')).getByTitle('تعديل بيانات'));
    const priceField = within(editDialog()).getByDisplayValue('10');
    await user.clear(priceField);
    await user.type(priceField, '12.5');
    await user.click(within(editDialog()).getByText('حفظ التعديلات'));

    expect(store.getProductById(product.id)?.selling_price).toBe(12.5);
  });

  it('records an adjustment movement for a manual stock count', async () => {
    const user = userEvent.setup();
    const product = seedRestockedProduct();
    const movementsBefore = store.getState().stockMovements.length;

    renderInventory();
    await user.click(within(rowFor('حليب')).getByTitle('تعديل بيانات'));

    const stockField = within(editDialog()).getByDisplayValue('40');
    await user.clear(stockField);
    await user.type(stockField, '37');
    await user.click(within(editDialog()).getByText('حفظ التعديلات'));

    expect(store.getProductById(product.id)?.stock_quantity).toBe(37);
    const movements = store.getState().stockMovements;
    expect(movements.length).toBe(movementsBefore + 1);
    expect(movements[0].type).toBe('adjustment');
    expect(movements[0].quantity).toBe(-3);
  });

  it('blocks saving when the name is cleared', async () => {
    const user = userEvent.setup();
    const product = seedRestockedProduct();
    renderInventory();

    await user.click(within(rowFor('حليب')).getByTitle('تعديل بيانات'));
    await user.clear(within(editDialog()).getByDisplayValue('حليب'));
    await user.click(within(editDialog()).getByText('حفظ التعديلات'));

    // The name input carries `required`, so the browser blocks submission and the
    // modal stays open. Nothing is written.
    expect(editDialog()).toBeInTheDocument();
    expect(store.getProductById(product.id)?.name).toBe('حليب');
  });

  it('rejects a non-positive selling price (server-side guard)', async () => {
    // The selling-price input is `required` but not `min`, so a 0 gets through to
    // the React handler. fireEvent.submit bypasses native validation to reach it.
    const user = userEvent.setup();
    const product = seedRestockedProduct();
    renderInventory();

    await user.click(within(rowFor('حليب')).getByTitle('تعديل بيانات'));
    const priceField = within(editDialog()).getByDisplayValue('10');
    await user.clear(priceField);
    await user.type(priceField, '0');

    const form = editDialog().querySelector('form')!;
    fireEvent.submit(form);

    expect(await screen.findByText('يرجى إدخال سعر بيع صحيح')).toBeInTheDocument();
    expect(store.getProductById(product.id)?.selling_price).toBe(10);
  });
});

describe('InventoryView - unknown cost', () => {
  it('flags a product whose cost was never entered', () => {
    // average_cost 0 stored as a bare 0.00 read like a real figure, while every
    // sale of the product booked its whole selling price as profit.
    const product = store.addProduct({
      name: 'بلا تكلفة',
      barcode: '777777',
      category_id: '',
      purchase_price: 0,
      selling_price: 10,
      average_cost: 0,
      stock_quantity: 5,
      minimum_stock: 1,
      unit: 'حبة',
    });

    renderInventory();

    const cell = within(rowFor('بلا تكلفة')).getByText('تكلفة غير محددة');
    expect(cell).toHaveAttribute('title', expect.stringContaining('كامل سعر البيع') as never);
  });

  it('shows a real cost as a figure instead of the warning', async () => {
    const user = userEvent.setup();
    seedRestockedProduct(); // average_cost becomes 5 after the purchase
    renderInventory();

    const row = rowFor('حليب');
    expect(within(row).queryByText('تكلفة غير محددة')).not.toBeInTheDocument();
    expect(row).toHaveTextContent('5.00');
  });
});

describe('InventoryView - deleting a product', () => {
  it('asks for confirmation in-app rather than using a native dialog', async () => {
    // A native confirm() cannot be styled and is blocked in some PWA contexts.
    const user = userEvent.setup();
    const product = seedRestockedProduct();
    renderInventory();

    await user.click(within(rowFor('حليب')).getByTitle('حذف الصنف'));
    expect(deleteDialog()).toBeInTheDocument();

    await user.click(within(deleteDialog()).getByText('إلغاء'));
    expect(screen.queryByRole('dialog', { name: 'تأكيد حذف الصنف' })).not.toBeInTheDocument();
    expect(store.getState().products.some((p) => p.id === product.id)).toBe(true);
  });

  it('explains that a product with history is archived rather than deleted', async () => {
    const user = userEvent.setup();
    seedRestockedProduct();
    renderInventory();

    await user.click(within(rowFor('حليب')).getByTitle('حذف الصنف'));

    expect(within(deleteDialog()).getByText(/أرشفته/)).toBeInTheDocument();
  });

  it('deletes the product once confirmed', async () => {
    const user = userEvent.setup();
    const product = seedRestockedProduct();
    renderInventory();

    await user.click(within(rowFor('حليب')).getByTitle('حذف الصنف'));
    await user.click(within(deleteDialog()).getByText('تأكيد الحذف'));

    expect(store.getState().products.some((p) => p.id === product.id)).toBe(false);
  });
});
