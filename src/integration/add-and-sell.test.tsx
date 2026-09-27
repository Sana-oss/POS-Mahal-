// @vitest-environment jsdom
/**
 * Cross-component regression: a product created through the UI must be sellable.
 *
 * I once made both product forms refuse to save without a cost. Each form opens
 * with an empty cost field and 24 units of default stock, so the guard was true on
 * open and a product could not be created at all. Every form-level test still
 * passed, because each tested one screen in isolation. This drives the whole path
 * a cashier actually takes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AddProductModal } from '../components/inventory/AddProductModal';
import { FastAddProductModal } from '../components/pos/FastAddProductModal';
import { store } from '../lib/store';

vi.mock('../lib/audio', () => ({ playSound: vi.fn() }));
vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

const addName = () => screen.getByLabelText('اسم المنتج التجاري *');
const addSelling = () => screen.getByLabelText('سعر البيع للزبون *');
const addSave = () => screen.getByText('حفظ المنتج');

const fastSelling = () => screen.getByLabelText('سعر البيع للزبون *');
const fastSave = () => screen.getByText('حفظ وإضافة للسلة');

beforeEach(() => {
  store.resetToDefault();
});

describe('add a product, then sell it', () => {
  it('works with only a name and a selling price', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<AddProductModal isOpen onClose={onClose} />);

    // What a busy cashier types. No cost; the stock stays at its default.
    await user.type(addName(), 'منتج جديد');
    await user.type(addSelling(), '10');
    await user.click(addSave());

    expect(onClose).toHaveBeenCalled();
    const product = store.getState().products.find((p) => p.name === 'منتج جديد');
    expect(product).toBeDefined();
    expect(product!.stock_quantity).toBe(24);

    const sale = store.executeSale({
      items: [{ productId: product!.id, quantity: 2 }],
      paymentMethod: 'cash',
    });

    expect(sale.total_amount).toBe(20);
    expect(store.getProductById(product!.id)!.stock_quantity).toBe(22);
  });

  it('saves the cost when one is given, and it reaches the sale', async () => {
    const user = userEvent.setup();
    render(<AddProductModal isOpen onClose={vi.fn()} />);

    await user.type(addName(), 'منتج بتكلفة');
    await user.type(addSelling(), '10');
    await user.type(screen.getByLabelText('سعر الشراء (التكلفة)'), '6.5');
    await user.click(addSave());

    const product = store.getState().products.find((p) => p.name === 'منتج بتكلفة')!;
    expect(product.average_cost).toBe(6.5);

    const sale = store.executeSale({
      items: [{ productId: product.id, quantity: 2 }],
      paymentMethod: 'cash',
    });

    // The real cost is carried into the sale, not a guess.
    expect(sale.total_cost).toBe(13);
    expect(sale.profit).toBe(7);
  });

  it('keeps a fractional opening balance sellable as a fraction', async () => {
    const user = userEvent.setup();
    render(<AddProductModal isOpen onClose={vi.fn()} />);

    await user.type(addName(), 'طماطم');
    await user.type(addSelling(), '4');
    await user.type(screen.getByLabelText('سعر الشراء (التكلفة)'), '2');
    await user.clear(screen.getByLabelText('الكمية الافتتاحية للمخزن'));
    await user.type(screen.getByLabelText('الكمية الافتتاحية للمخزن'), '2.5');
    await user.click(addSave());

    const product = store.getState().products.find((p) => p.name === 'طماطم')!;
    expect(product.stock_quantity).toBe(2.5);

    const sale = store.executeSale({
      items: [{ productId: product.id, quantity: 1.5 }],
      paymentMethod: 'cash',
    });
    expect(store.getProductById(product.id)!.stock_quantity).toBe(1);
    expect(sale.items_count).toBe(1.5);
  });

  it('refuses to oversell a fractional balance', async () => {
    // The stored quantity is exact, so the guard has to be too: selling 1 from
    // 0.5 kg on hand must fail rather than drive stock negative.
    const user = userEvent.setup();
    render(<AddProductModal isOpen onClose={vi.fn()} />);

    await user.type(addName(), 'لبن');
    await user.type(addSelling(), '4');
    await user.type(screen.getByLabelText('سعر الشراء (التكلفة)'), '2');
    await user.clear(screen.getByLabelText('الكمية الافتتاحية للمخزن'));
    await user.type(screen.getByLabelText('الكمية الافتتاحية للمخزن'), '0.5');
    await user.click(addSave());

    const product = store.getState().products.find((p) => p.name === 'لبن')!;
    expect(() =>
      store.executeSale({
        items: [{ productId: product.id, quantity: 1 }],
        paymentMethod: 'cash',
      })
    ).toThrow();
    expect(store.getProductById(product.id)!.stock_quantity).toBe(0.5);
  });
});

describe('fast add, then sell it', () => {
  it('works with only a name and a selling price', async () => {
    const user = userEvent.setup();
    const onProductCreated = vi.fn<(p: ReturnType<typeof store.addProduct>) => void>();
    const onClose = vi.fn();
    render(
      <FastAddProductModal
        isOpen
        onClose={onClose}
        barcode="6221031492019"
        onProductCreated={onProductCreated}
      />
    );

    await user.type(addName(), 'صنف سريع');
    await user.type(fastSelling(), '3');
    await user.click(fastSave());

    expect(onProductCreated).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();

    const product = store.getState().products.find((p) => p.name === 'صنف سريع')!;
    const sale = store.executeSale({
      items: [{ productId: product.id, quantity: 1 }],
      paymentMethod: 'cash',
    });
    expect(sale.total_amount).toBe(3);
  });
});
