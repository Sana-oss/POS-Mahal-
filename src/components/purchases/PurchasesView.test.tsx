// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PurchasesView } from './PurchasesView';
import { store } from '../../lib/store';
import type { Product } from '../../types';

vi.mock('../../lib/audio', () => ({ playSound: vi.fn() }));
vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

type ProductInput = Omit<Product, 'id' | 'created_at' | 'updated_at'>;

function seedProduct(overrides: Partial<ProductInput> = {}): Product {
  return store.addProduct({
    name: 'أرز',
    barcode: '666666',
    category_id: '',
    purchase_price: 5,
    selling_price: 10,
    average_cost: 0,
    stock_quantity: 10,
    minimum_stock: 1,
    unit: 'كيس',
    ...overrides,
  });
}

/** The form is collapsed by default, and its cost field only prefills on selection. */
async function openFormFor(user: ReturnType<typeof userEvent.setup>, product: Product) {
  render(<PurchasesView />);
  await user.click(screen.getByRole('button', { name: /إضافة فاتورة مشتريات/ }));
  await user.selectOptions(screen.getByRole('combobox'), product.id);
}

/** Scope to one preview tile by its caption. */
function tile(caption: string): HTMLElement {
  const label = screen.getByText(caption);
  const box = label.closest('div');
  if (!box) throw new Error(`no tile for ${caption}`);
  return box as HTMLElement;
}

const qtyField = () => screen.getByLabelText('الكمية الموردة *');
const costField = () => screen.getByLabelText('سعر شراء القطعة (التكلفة) *');

beforeEach(() => {
  store.resetToDefault();
});

describe('PurchasesView - average cost preview', () => {
  it('falls back to the stored purchase price, matching the database', async () => {
    // stock 10, average_cost 0, stored purchase_price 5.00, buying 10 @ 2.00.
    // rpc_execute_purchase computes (10*5 + 10*2) / 20 = 3.50. The preview used to
    // fall back to the incoming unit cost and announce 2.00, and that wrong figure
    // was also printed in the success banner.
    const user = userEvent.setup();
    const product = seedProduct();
    expect(product.average_cost).toBe(0);
    expect(product.purchase_price).toBe(5);

    await openFormFor(user, product);

    await user.clear(qtyField());
    await user.type(qtyField(), '10');
    await user.clear(costField());
    await user.type(costField(), '2');

    expect(tile('متوسط التكلفة الجديد')).toHaveTextContent('3.50 د.ل');
    expect(tile('الرصيد بعد التوريد')).toHaveTextContent('20 كيس');
  });

  it('blends with an existing average when one is set', async () => {
    const user = userEvent.setup();
    const product = seedProduct({ average_cost: 1.5, purchase_price: 1.5 });

    await openFormFor(user, product);

    await user.clear(qtyField());
    await user.type(qtyField(), '10');
    await user.clear(costField());
    await user.type(costField(), '1.7');

    // (10*1.5 + 10*1.7) / 20 = 1.60
    expect(tile('متوسط التكلفة الجديد')).toHaveTextContent('1.60 د.ل');
  });

  it('flags an average that has never been computed', async () => {
    // average_cost 0 is the "not yet computed" state, which the old preview
    // rendered as a bare 0.00 and so looked like a real figure.
    const user = userEvent.setup();
    const product = seedProduct({ average_cost: 0 });

    await openFormFor(user, product);

    expect(tile('متوسط التكلفة السابق')).toHaveTextContent('غير محسوب بعد');
  });

  it('previews the new stock level', async () => {
    const user = userEvent.setup();
    const product = seedProduct();
    await openFormFor(user, product);

    await user.clear(qtyField());
    await user.type(qtyField(), '5');

    expect(tile('الرصيد الحالي بالمخزن')).toHaveTextContent('10 كيس');
    expect(tile('الرصيد بعد التوريد')).toHaveTextContent('15 كيس');
  });

  it('accepts a fractional quantity, as the NUMERIC(10,3) column allows', async () => {
    // The default step of 1 made 2.5 a stepMismatch, so the browser refused to
    // submit a fractional restock even though the database stores it happily.
    const user = userEvent.setup();
    const product = seedProduct({ unit: 'كجم' });
    await openFormFor(user, product);

    await user.clear(qtyField());
    await user.type(qtyField(), '2.5');

    expect(qtyField()).toHaveAttribute('step', '0.001');
    // Not truncated to 2: 10 + 2.5 = 12.5
    expect(tile('الرصيد بعد التوريد')).toHaveTextContent('12.5 كجم');
  });
});

describe('PurchasesView - empty form', () => {
  it('shows one consistent placeholder for every tile when nothing is selected', async () => {
    // Previously a blank cell, a hard 0, and a confident 0.00 all stood for the
    // same condition, which read as three different facts.
    store.clearPersistedData();
    const user = userEvent.setup();

    render(<PurchasesView />);
    await user.click(screen.getByRole('button', { name: /إضافة فاتورة مشتريات/ }));

    for (const caption of [
      'الرصيد الحالي بالمخزن',
      'الرصيد بعد التوريد',
      'متوسط التكلفة السابق',
      'متوسط التكلفة الجديد',
    ]) {
      expect(tile(caption)).toHaveTextContent('—');
    }
    // And no "not yet computed" warning without a product to warn about.
    expect(screen.queryByText('غير محسوب بعد')).not.toBeInTheDocument();
  });

  it('does not invent an invoice number before the purchase exists', async () => {
    // The header used to show `#{209 + purchases.length}`, a sequence the database
    // never issues (rpc_execute_purchase mints a timestamp+random PUR-... string),
    // so the header and the success banner stated two different numbers for one
    // purchase. The real number belongs on the saved row only.
    const user = userEvent.setup();
    const product = seedProduct();
    await openFormFor(user, product);

    expect(screen.queryByText(/فاتورة توريد #/)).not.toBeInTheDocument();
    // No sequential "#NNN" anywhere in the open form.
    expect(document.body.textContent).not.toMatch(/#\d+/);
  });
});
