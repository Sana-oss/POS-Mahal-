// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AddProductModal } from './AddProductModal';
import { store } from '../../lib/store';

vi.mock('../../lib/audio', () => ({ playSound: vi.fn() }));
vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

/**
 * This form is the origin of every cost figure downstream: purchase_price and
 * average_cost set here become the cost of goods sold for every future sale of
 * the product, because the sale RPC prices stock at
 * `average_cost > 0 ? average_cost : purchase_price`. It had no coverage.
 */

function renderModal(overrides: Partial<Parameters<typeof AddProductModal>[0]> = {}) {
  const props = { isOpen: true, onClose: vi.fn(), ...overrides };
  render(<AddProductModal {...props} />);
  return props;
}

const nameField = () => screen.getByLabelText('اسم المنتج التجاري *');
const sellingField = () => screen.getByLabelText('سعر البيع للزبون *');
const costField = () => screen.getByLabelText('سعر الشراء (التكلفة)');
const stockField = () => screen.getByLabelText('الكمية الافتتاحية للمخزن');
const minField = () => screen.getByLabelText('حد التنبيه بنقص المخزون');
const barcodeField = () => screen.getByLabelText('رقم الباركود');
const categoryField = () => screen.getByLabelText('التصنيف / القسم');
const unitField = () => screen.getByLabelText('الوحدة');
const shelfField = () => screen.getByLabelText('موقع الرف في المحل (اختياري)');
const saveButton = () => screen.getByText('حفظ المنتج');

beforeEach(() => {
  store.resetToDefault();
});

describe('AddProductModal - visibility', () => {
  it('renders nothing while closed', () => {
    const { container } = render(<AddProductModal isOpen={false} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is exposed as a dialog with a name', () => {
    renderModal();
    expect(screen.getByRole('dialog', { name: 'إضافة منتج جديد للمخزون' })).toBeInTheDocument();
  });

  it('closes without saving', async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();

    await user.type(nameField(), 'منتج ملغى');
    await user.click(screen.getByText('إلغاء'));

    expect(onClose).toHaveBeenCalled();
    expect(store.getState().products.some((p) => p.name === 'منتج ملغى')).toBe(false);
  });
});

describe('AddProductModal - required fields', () => {
  it('blocks an empty name without writing anything', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(sellingField(), '10');
    await user.type(costField(), '5');
    await user.click(saveButton());

    // The field carries `required`, so the browser blocks submission.
    expect(nameField()).toBeInTheDocument();
    const before = store.getState().products.length;
    expect(store.getState().products).toHaveLength(before);
  });

  it('rejects a non-positive selling price through the handler', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(nameField(), 'صنف بسعر صفري');
    await user.clear(sellingField());
    await user.type(sellingField(), '0');
    fireEvent.submit(sellingField().closest('form')!);

    expect(await screen.findByText('يرجى تحديد سعر بيع صحيح.')).toBeInTheDocument();
  });
});

describe('AddProductModal - cost is never invented', () => {
  it('saves with a blank cost instead of inventing one or refusing', async () => {
    // Regression I introduced: the form opens with an empty cost and 24 units of
    // stock, so requiring the cost made the product impossible to add at all.
    const user = userEvent.setup();
    const { onClose } = renderModal();

    await user.type(nameField(), 'حليب');
    await user.type(sellingField(), '10');
    await user.click(saveButton());

    expect(store.getState().products.find((p) => p.name === 'حليب')).toBeDefined();
    expect(onClose).toHaveBeenCalled();
  });

  it('warns that profit will read high while the cost is unknown', async () => {
    // Storing 0 is the column's own "unknown cost" value, so the gap has to be
    // visible rather than quietly filled with a guess.
    const user = userEvent.setup();
    renderModal();

    await user.type(nameField(), 'حليب');
    await user.type(sellingField(), '10');
    await user.clear(stockField());
    await user.type(stockField(), '20');

    expect(await screen.findByRole('alert')).toHaveTextContent(/لم تُحدَّد سعر التكلفة/);
  });

  it('does not warn once a cost is entered', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(nameField(), 'حليب');
    await user.type(sellingField(), '10');
    await user.type(costField(), '6.5');

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('stores 0 rather than a fraction of the selling price', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(nameField(), 'صنف');
    await user.type(sellingField(), '10');
    await user.click(saveButton());

    const created = store.getState().products.find((p) => p.name === 'صنف');
    // 10 * 0.75 would have been 7.5.
    expect(created!.purchase_price).toBe(0);
    expect(created!.average_cost).toBe(0);
  });

  it('stores the cost the user typed, not a multiple of it', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(nameField(), 'أرز');
    await user.type(sellingField(), '10');
    await user.type(costField(), '6.5');
    await user.click(saveButton());

    const created = store.getState().products.find((p) => p.name === 'أرز');
    expect(created!.purchase_price).toBe(6.5);
    expect(created!.average_cost).toBe(6.5);
  });
});

describe('AddProductModal - fractional quantities', () => {
  it('keeps a fractional opening balance exact', async () => {
    // Regression: parseInt truncated this to 2, and 0.5 to 0, even though both
    // columns are NUMERIC(10,3) and the rest of the app sells weighed goods.
    const user = userEvent.setup();
    renderModal();

    await user.type(nameField(), 'لبن');
    await user.type(sellingField(), '10');
    await user.type(costField(), '5');
    await user.clear(stockField());
    await user.type(stockField(), '2.5');
    await user.click(saveButton());

    const created = store.getState().products.find((p) => p.name === 'لبن');
    expect(created!.stock_quantity).toBe(2.5);
  });

  it('keeps a sub-unit opening balance rather than zeroing it', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(nameField(), 'بهار');
    await user.type(sellingField(), '10');
    await user.type(costField(), '5');
    await user.clear(stockField());
    await user.type(stockField(), '0.5');
    await user.click(saveButton());

    const created = store.getState().products.find((p) => p.name === 'بهار');
    // parseInt('0.5') would have been 0, i.e. a product that appears out of stock.
    expect(created!.stock_quantity).toBe(0.5);
  });

  it('keeps a fractional low-stock threshold', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(nameField(), 'ماء');
    await user.type(sellingField(), '1');
    await user.type(costField(), '0.5');
    await user.clear(minField());
    await user.type(minField(), '2.5');
    await user.click(saveButton());

    expect(store.getState().products.find((p) => p.name === 'ماء')!.minimum_stock).toBe(2.5);
  });

  it('accepts fractional entry in the browser as well as the parser', () => {
    // The default input step of 1 made 2.5 a stepMismatch, so the browser refused
    // the value outright regardless of what the parser did.
    renderModal();
    expect(stockField()).toHaveAttribute('step', '0.001');
    expect(minField()).toHaveAttribute('step', '0.001');
  });
});

describe('AddProductModal - full entry', () => {
  it('saves every field the form collects', async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();

    await user.type(barcodeField(), '6221031492019');
    await user.type(nameField(), '  حليب المراعي كامل الدسم  ');
    await user.type(sellingField(), '12.75');
    await user.type(costField(), '8.5');
    await user.selectOptions(categoryField(), store.getState().categories[1].id);
    await user.selectOptions(unitField(), 'كجم');
    await user.clear(stockField());
    await user.type(stockField(), '30');
    await user.clear(minField());
    await user.type(minField(), '4');
    await user.type(shelfField(), 'ثلاجة الألبان');
    await user.click(saveButton());

    const created = store.getState().products.find((p) => p.name === 'حليب المراعي كامل الدسم');
    expect(created).toBeDefined();
    expect(created).toMatchObject({
      // Trimmed.
      name: 'حليب المراعي كامل الدسم',
      barcode: '6221031492019',
      selling_price: 12.75,
      purchase_price: 8.5,
      average_cost: 8.5,
      stock_quantity: 30,
      minimum_stock: 4,
      unit: 'كجم',
      shelf_location: 'ثلاجة الألبان',
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('generates a 12-digit grocery barcode', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByText('توليد باركود تلقائي'));

    const value = (barcodeField() as HTMLInputElement).value;
    expect(value).toMatch(/^628100\d{6}$/);
    expect(value).toHaveLength(12);
  });

  it('surfaces a duplicate-barcode rejection instead of closing', async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();
    const existing = store.getState().products[0];

    await user.type(barcodeField(), existing.barcode);
    await user.type(nameField(), 'صنف مكرر');
    await user.type(sellingField(), '10');
    await user.type(costField(), '5');
    await user.click(saveButton());

    expect(await screen.findByText(/مرتبط بمنتج آخر/)).toBeInTheDocument();
    // The modal stays open so the barcode can be corrected.
    expect(onClose).not.toHaveBeenCalled();
  });

  it('hands off to the scanner and closes, since a scan replaces this form', async () => {
    const user = userEvent.setup();
    const onOpenScanner = vi.fn();
    const { onClose } = renderModal({ onOpenScanner });

    await user.click(screen.getByText('مسح'));

    expect(onClose).toHaveBeenCalled();
    expect(onOpenScanner).toHaveBeenCalled();
  });

  it('hides the scan helper when no scanner is wired up', () => {
    renderModal();
    expect(screen.queryByText('مسح')).not.toBeInTheDocument();
  });
});
