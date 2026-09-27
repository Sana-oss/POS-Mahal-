// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FastAddProductModal } from './FastAddProductModal';
import { store } from '../../lib/store';
import type { Product } from '../../types';

vi.mock('../../lib/audio', () => ({ playSound: vi.fn() }));
vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

/**
 * The fast-add path a cashier takes mid-queue: scan an unknown barcode, type a
 * name and a price, and the item goes straight into the cart. It had no coverage.
 */

const BARCODE = '6221031492019';

type ModalProps = Parameters<typeof FastAddProductModal>[0];

function renderModal(overrides: Partial<ModalProps> = {}) {
  const onClose = vi.fn<() => void>();
  const onProductCreated = vi.fn<(p: Product) => void>();
  const props: ModalProps = { isOpen: true, barcode: BARCODE, ...overrides, onClose, onProductCreated };
  render(<FastAddProductModal {...props} />);
  return { ...props, onClose, onProductCreated };
}

const nameField = () => screen.getByLabelText('اسم المنتج التجاري *');
const sellingField = () => screen.getByLabelText('سعر البيع للزبون *');
const costField = () => screen.getByLabelText('سعر التكلفة (شراء)');
const stockField = () => screen.getByLabelText('الكمية بالمخزن حالياً');
const minField = () => screen.getByLabelText('حد التنبيه بالنقص');
const categoryField = () => screen.getByLabelText('القسم / التصنيف');
const unitField = () => screen.getByLabelText('الوحدة');
const saveButton = () => screen.getByText('حفظ وإضافة للسلة');

beforeEach(() => {
  store.resetToDefault();
});

describe('FastAddProductModal - scanned barcode', () => {
  it('shows the scanned code read-only rather than an editable field', () => {
    renderModal();
    expect(screen.getByText(BARCODE)).toBeInTheDocument();
    // The scan result is the product's identity; letting it be retyped would let
    // a mistyped code create a duplicate of an existing product.
    expect(screen.queryByRole('textbox', { name: /الباركود/ })).not.toBeInTheDocument();
  });

  it('stores the scanned barcode on the new product', async () => {
    const user = userEvent.setup();
    const { onProductCreated } = renderModal();

    await user.type(nameField(), 'أوريو');
    await user.type(sellingField(), '2.5');
    await user.type(costField(), '1.75');
    await user.click(saveButton());

    const created = onProductCreated.mock.calls[0][0] as Product;
    expect(created.barcode).toBe(BARCODE);
  });
});

describe('FastAddProductModal - cost is never invented', () => {
  it('creates the product with a blank cost instead of refusing', async () => {
    // Regression I introduced: this form opens with an empty cost and 24 units of
    // stock, so requiring the cost blocked every fast add in the queue.
    const user = userEvent.setup();
    const { onProductCreated, onClose } = renderModal();

    await user.type(nameField(), 'أوريو');
    await user.type(sellingField(), '2.5');
    await user.click(saveButton());

    expect(onProductCreated).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });

  it('warns that profit will read high while the cost is unknown', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(nameField(), 'أوريو');
    await user.type(sellingField(), '2.5');

    expect(await screen.findByRole('alert')).toHaveTextContent(/لم تُحدَّد سعر التكلفة/);
  });

  it('stores 0 rather than 80% of the selling price', async () => {
    const user = userEvent.setup();
    const { onProductCreated } = renderModal();

    await user.type(nameField(), 'أوريو');
    await user.type(sellingField(), '2.5');
    await user.click(saveButton());

    const created = onProductCreated.mock.calls[0][0] as Product;
    // 2.5 * 0.8 would have been 2.
    expect(created.purchase_price).toBe(0);
    expect(created.average_cost).toBe(0);
  });

  it('does not warn once a cost is entered', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(nameField(), 'أوريو');
    await user.type(sellingField(), '2.5');
    await user.type(costField(), '1.75');

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('stores the typed cost, not a multiple of the selling price', async () => {
    const user = userEvent.setup();
    const { onProductCreated } = renderModal();

    await user.type(nameField(), 'حليب');
    await user.type(sellingField(), '10');
    await user.type(costField(), '6.5');
    await user.click(saveButton());

    const created = onProductCreated.mock.calls[0][0] as Product;
    expect(created.purchase_price).toBe(6.5);
    // 10 * 0.8 would have been 8.
    expect(created.average_cost).toBe(6.5);
  });
});
describe('FastAddProductModal - quantities are not silently replaced', () => {
  it('stores an opening stock of exactly zero', async () => {
    // Regression: `parseInt(stockQuantity) || 10` turned a deliberate 0 into 10
    // units, inflating inventory with no warning.
    const user = userEvent.setup();
    const { onProductCreated } = renderModal();

    await user.type(nameField(), 'صنف');
    await user.type(sellingField(), '5');
    await user.type(costField(), '3');
    await user.clear(stockField());
    await user.type(stockField(), '0');
    await user.click(saveButton());

    expect((onProductCreated.mock.calls[0][0] as Product).stock_quantity).toBe(0);
  });

  it('stores a low-stock threshold of exactly zero', async () => {
    // The same `|| 5` fallback would have invented a reorder point.
    const user = userEvent.setup();
    const { onProductCreated } = renderModal();

    await user.type(nameField(), 'صنف');
    await user.type(sellingField(), '5');
    await user.type(costField(), '3');
    await user.clear(minField());
    await user.type(minField(), '0');
    await user.click(saveButton());

    expect((onProductCreated.mock.calls[0][0] as Product).minimum_stock).toBe(0);
  });

  it('keeps a fractional opening stock exact', async () => {
    const user = userEvent.setup();
    const { onProductCreated } = renderModal();

    await user.type(nameField(), 'طماطم');
    await user.type(sellingField(), '4');
    await user.type(costField(), '2');
    await user.clear(stockField());
    await user.type(stockField(), '2.5');
    await user.click(saveButton());

    expect((onProductCreated.mock.calls[0][0] as Product).stock_quantity).toBe(2.5);
  });

  it('keeps a sub-unit opening stock rather than zeroing it', async () => {
    const user = userEvent.setup();
    const { onProductCreated } = renderModal();

    await user.type(nameField(), 'بهار');
    await user.type(sellingField(), '4');
    await user.type(costField(), '2');
    await user.clear(stockField());
    await user.type(stockField(), '0.5');
    await user.click(saveButton());

    expect((onProductCreated.mock.calls[0][0] as Product).stock_quantity).toBe(0.5);
  });

  it('accepts an ordinary price and creates the product', async () => {
    // Regression: step="0.25" with min="0.1" made min the step base, so 10 and 5
    // were step mismatches and the form could not be submitted at all.
    const user = userEvent.setup();
    const { onProductCreated, onClose } = renderModal();

    expect(sellingField()).toHaveAttribute('step', '0.01');
    expect(costField()).toHaveAttribute('step', '0.01');

    await user.type(nameField(), 'زيت');
    await user.type(sellingField(), '10');
    await user.type(costField(), '5');
    await user.click(saveButton());

    expect(onProductCreated).toHaveBeenCalledTimes(1);
    expect((onProductCreated.mock.calls[0][0] as Product).selling_price).toBe(10);
    expect(onClose).toHaveBeenCalled();
  });
});

describe('FastAddProductModal - required fields', () => {
  it('blocks an empty name', async () => {
    const user = userEvent.setup();
    const { onProductCreated } = renderModal();

    await user.type(sellingField(), '10');
    await user.click(saveButton());

    expect(nameField()).toBeInTheDocument();
    expect(onProductCreated).not.toHaveBeenCalled();
  });

  it('rejects a non-positive selling price through the handler', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(nameField(), 'صنف');
    await user.clear(sellingField());
    await user.type(sellingField(), '0');
    fireEvent.submit(sellingField().closest('form')!);

    expect(await screen.findByText('يرجى تحديد سعر بيع صحيح.')).toBeInTheDocument();
  });
});

describe('FastAddProductModal - full entry', () => {
  it('saves category, unit and both quantities', async () => {
    const user = userEvent.setup();
    const { onProductCreated } = renderModal();
    const category = store.getState().categories[1].id;

    await user.type(nameField(), '  لبن  ');
    await user.type(sellingField(), '3.25');
    await user.type(costField(), '2.1');
    await user.selectOptions(categoryField(), category);
    await user.selectOptions(unitField(), 'كجم');
    await user.clear(stockField());
    await user.type(stockField(), '12.5');
    await user.clear(minField());
    await user.type(minField(), '3');
    await user.click(saveButton());

    const created = onProductCreated.mock.calls[0][0] as Product;
    expect(created).toMatchObject({
      name: 'لبن', // trimmed
      selling_price: 3.25,
      purchase_price: 2.1,
      category_id: category,
      unit: 'كجم',
      stock_quantity: 12.5,
      minimum_stock: 3,
    });
  });

  it('surfaces a duplicate-barcode rejection instead of closing', async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal({ barcode: store.getState().products[0].barcode });

    await user.type(nameField(), 'مكرر');
    await user.type(sellingField(), '10');
    await user.type(costField(), '5');
    await user.click(saveButton());

    expect(await screen.findByText(/مرتبط بمنتج آخر/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('renders nothing while closed', () => {
    const { container } = render(
      <FastAddProductModal
        isOpen={false}
        onClose={vi.fn()}
        barcode={BARCODE}
        onProductCreated={vi.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
