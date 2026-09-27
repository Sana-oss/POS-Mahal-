// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { POSView } from './POSView';
import { cartStore } from '../../lib/cartStore';
import { store } from '../../lib/store';
import type { CartItem, Product } from '../../types';

/**
 * Behavioural tests for the POS screen.
 *
 * These target regressions that were found by reading the code rather than by a
 * failing test -- stale closures on the fast add path, the debt screen silently
 * picking an arbitrary customer, and stock guards reading a frozen snapshot.
 * Each of those was a real defect, so each is pinned here.
 */

// Audio and confetti are browser side effects with no bearing on behaviour.
vi.mock('../../lib/audio', () => ({ playSound: vi.fn() }));
vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

const noop = () => {};

function renderPOS(overrides: Partial<React.ComponentProps<typeof POSView>> = {}) {
  return render(
    <POSView
      onOpenScanner={noop}
      onOpenFastAdd={noop}
      onSaleCompleted={noop}
      scannedBarcodeToProcess={null}
      onClearScannedBarcode={noop}
      {...overrides}
    />
  );
}

/** Add a product to the store so the grid renders it. */
function seedProduct(overrides: Partial<Product> = {}): Product {
  return store.addProduct({
    name: 'حليب',
    barcode: '111111',
    category_id: '',
    purchase_price: 5,
    selling_price: 10,
    average_cost: 5,
    stock_quantity: 20,
    minimum_stock: 1,
    unit: 'حبة',
    ...overrides,
  });
}

/** The checkout button relabels itself depending on the payment mode. */
function confirmButton(): HTMLElement {
  return screen.getByRole('button', { name: /إتمام البيع|تسجيل في دفتر الديون/ });
}

function productInCart(): CartItem {
  const cart = cartStore.getSnapshot();
  if (cart.length === 0) throw new Error('expected a cart line, found none');
  return cart[0];
}

beforeEach(() => {
  store.resetToDefault();
  cartStore.clear();
});

describe('POSView - adding to the cart', () => {
  it('adds a product from the grid', async () => {
    const user = userEvent.setup();
    const product = seedProduct();
    renderPOS();

    await user.click(screen.getByText(product.name));

    expect(cartStore.getSnapshot()).toHaveLength(1);
    expect(productInCart().product.id).toBe(product.id);
    expect(productInCart().quantity).toBe(1);
  });

  it('accumulates two rapid adds of the same product', async () => {
    // Regression: addProductToCart read the `cart` closure and called
    // setCart([...cart]), so two fast taps both read the same snapshot and the
    // second increment overwrote the first, losing a unit from the sale.
    const user = userEvent.setup();
    const product = seedProduct();
    renderPOS();

    await user.dblClick(screen.getByText(product.name));

    expect(productInCart().quantity).toBe(2);
  });

  it('refuses to add more than the available stock', async () => {
    const user = userEvent.setup();
    seedProduct({ stock_quantity: 1 });
    renderPOS();

    const tile = screen.getByText('حليب');
    await user.click(tile);
    await user.click(tile);

    expect(cartStore.getSnapshot()).toHaveLength(1);
    expect(productInCart().quantity).toBe(1);
    expect(screen.getByText(/الكمية المتوفرة فقط 1/)).toBeInTheDocument();
  });

  it('derives the line total from the product selling price', async () => {
    const user = userEvent.setup();
    seedProduct({ selling_price: 10, average_cost: 4, stock_quantity: 10 });
    renderPOS();

    await user.click(screen.getByText('حليب'));

    const line = productInCart();
    expect(line.unit_price).toBe(10);
    expect(line.unit_cost).toBe(4);
    expect(line.total_price).toBe(10);
    expect(line.profit).toBe(6);
  });
});

describe('POSView - scanned barcodes', () => {
  it('adds the scanned product to the cart', () => {
    const product = seedProduct({ barcode: '999888' });
    renderPOS({ scannedBarcodeToProcess: '999888' });

    expect(cartStore.getSnapshot()).toHaveLength(1);
    expect(productInCart().product.id).toBe(product.id);
  });

  it('offers fast-add for an unknown barcode instead of silently ignoring it', () => {
    const onOpenFastAdd = vi.fn();
    renderPOS({ scannedBarcodeToProcess: '000000', onOpenFastAdd });

    expect(cartStore.getSnapshot()).toHaveLength(0);
    expect(onOpenFastAdd).toHaveBeenCalledWith('000000');
  });

  it('clears the processed barcode so it is not added twice', () => {
    const onClearScannedBarcode = vi.fn();
    seedProduct({ barcode: '999888' });
    renderPOS({ scannedBarcodeToProcess: '999888', onClearScannedBarcode });

    expect(onClearScannedBarcode).toHaveBeenCalled();
  });
});

describe('POSView - debt sales', () => {
  it('does not pre-select an arbitrary customer when switching to debt', async () => {
    // Regression: the debt button set customers[0], an arbitrary row in cache
    // order, silently booking the debt against a stranger.
    const user = userEvent.setup();
    store.addCustomer({ name: 'زبون أول', initial_balance: 0, credit_limit: 100 });
    store.addCustomer({ name: 'زبون ثانٍ', initial_balance: 0, credit_limit: 100 });
    seedProduct();
    renderPOS();

    await user.click(screen.getByText('حليب'));
    await user.click(screen.getByText(/آجل \/ دين/));

    expect(screen.getByRole('combobox')).toHaveValue('');
  });

  it('refuses to complete a debt sale with no customer selected', async () => {
    const user = userEvent.setup();
    seedProduct();
    store.addCustomer({ name: 'زبون', initial_balance: 0, credit_limit: 100 });
    // Count rather than look for "any debt sale": the demo seed already contains
    // one (INV-10841), so a `.some(...)` assertion would pass/fail for the
    // wrong reason.
    const salesBefore = store.getState().sales.length;
    renderPOS();

    await user.click(screen.getByText('حليب'));
    await user.click(screen.getByText(/آجل \/ دين/));
    await user.click(confirmButton());

    expect(screen.getByText(/البيع الآجل يتطلب تحديد عميل/)).toBeInTheDocument();
    expect(store.getState().sales.length).toBe(salesBefore);
  });

  it('completes a debt sale once a customer is chosen', async () => {
    const user = userEvent.setup();
    const customer = store.addCustomer({
      name: 'زبون',
      initial_balance: 0,
      credit_limit: 500,
    });
    seedProduct({ selling_price: 10, average_cost: 5, stock_quantity: 10 });
    const salesBefore = store.getState().sales.length;
    renderPOS();

    await user.click(screen.getByText('حليب'));
    await user.click(screen.getByText(/آجل \/ دين/));
    await user.selectOptions(screen.getByRole('combobox'), customer.id);
    await user.click(confirmButton());

    const sales = store.getState().sales;
    expect(sales.length).toBe(salesBefore + 1);
    const debtSale = sales.find((s) => s.payment_method === 'debt');
    expect(debtSale?.total_amount).toBe(10);
    expect(
      store.getState().customers.find((c) => c.id === customer.id)?.balance
    ).toBe(10);
  });
});

describe('POSView - completing a cash sale', () => {
  it('records the sale and deducts stock', async () => {
    const user = userEvent.setup();
    const product = seedProduct({ selling_price: 10, average_cost: 5, stock_quantity: 10 });
    const salesBefore = store.getState().sales.length;
    const onSaleCompleted = vi.fn();
    renderPOS({ onSaleCompleted });

    await user.click(screen.getByText('حليب'));
    await user.click(confirmButton());

    expect(store.getState().sales.length).toBe(salesBefore + 1);
    expect(store.getProductById(product.id)?.stock_quantity).toBe(9);
    expect(onSaleCompleted).toHaveBeenCalled();
  });

  it('clears the cart after a successful sale', async () => {
    const user = userEvent.setup();
    seedProduct();
    renderPOS();

    await user.click(screen.getByText('حليب'));
    expect(cartStore.getSnapshot()).toHaveLength(1);

    await user.click(confirmButton());
    expect(cartStore.getSnapshot()).toHaveLength(0);
  });

  it('does not submit twice when confirmed rapidly', async () => {
    // Regression: Ctrl+Enter called handleConfirmSale directly, bypassing the
    // button's disabled prop, with no in-flight guard. Two rapid confirmations
    // meant two invoices and a double stock deduction.
    const user = userEvent.setup();
    const product = seedProduct({ stock_quantity: 10 });
    const salesBefore = store.getState().sales.length;
    renderPOS();

    await user.click(screen.getByText('حليب'));
    const confirm = confirmButton();
    await Promise.all([user.click(confirm), user.click(confirm)]);

    expect(store.getState().sales.length).toBe(salesBefore + 1);
    expect(store.getProductById(product.id)?.stock_quantity).toBe(9);
  });

  it('refuses to sell more than the available stock', async () => {
    const user = userEvent.setup();
    seedProduct({ stock_quantity: 1 });
    renderPOS();

    await user.click(screen.getByText('حليب'));
    // Push the cart past the guard the stepper enforces, to prove the checkout
    // pre-flight sweep is a real second line of defence.
    cartStore.setCart((prev) =>
      prev.map((i) => ({ ...i, quantity: 5, total_price: 50, total_cost: 25, profit: 25 }))
    );
    await user.click(confirmButton());

    expect(screen.getByText(/الكمية المتوفرة فقط 1/)).toBeInTheDocument();
  });

  it('disables checkout with an empty cart and says so on the shortcut', async () => {
    // With an empty cart the button is disabled, so the "cart is empty" guard is
    // only reachable through the Ctrl+Enter shortcut, which bypasses the button.
    const user = userEvent.setup();
    seedProduct();
    renderPOS();

    expect(confirmButton()).toBeDisabled();
    await user.keyboard('{Control>}{Enter}{/Control}');

    expect(screen.getByText(/السلة فارغة/)).toBeInTheDocument();
  });

  it('fills the cash received with the exact total by default', async () => {
    const user = userEvent.setup();
    seedProduct({ selling_price: 12.5, stock_quantity: 10 });
    renderPOS();

    await user.click(screen.getByText('حليب'));

    // Quick-tender buttons only ever offer the exact amount, a round-up, or
    // fixed notes, so an underpayment is not reachable through the UI.
    expect(screen.getByRole('button', { name: 'مضبوط' })).toBeInTheDocument();
    expect(screen.getByText(/المتبقي للزبون/)).toBeInTheDocument();
  });
});

describe('POSView - cart editing', () => {
  it('removes a line when its quantity steps down to zero', async () => {
    const user = userEvent.setup();
    seedProduct({ stock_quantity: 10 });
    renderPOS();

    await user.click(screen.getByText('حليب'));
    expect(cartStore.getSnapshot()).toHaveLength(1);

    await user.click(screen.getAllByRole('button', { name: '-' })[0]);

    expect(cartStore.getSnapshot()).toHaveLength(0);
  });

  it('accepts a fractional quantity through the quantity field', async () => {
    const user = userEvent.setup();
    seedProduct({ unit: 'كجم', stock_quantity: 10 });
    renderPOS();

    await user.click(screen.getByText('حليب'));
    const field = screen.getByLabelText('الكمية');
    await user.clear(field);
    await user.type(field, '2.5');
    await user.tab();

    expect(productInCart().quantity).toBe(2.5);
    expect(productInCart().total_price).toBe(25);
  });
});
