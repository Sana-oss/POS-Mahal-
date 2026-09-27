// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DebtsView } from './DebtsView';
import { store } from '../../lib/store';

vi.mock('../../lib/audio', () => ({ playSound: vi.fn() }));
vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

/**
 * The customer statement must reconcile with the balance shown above it. It
 * previously listed only credit sales and payments, omitting the opening balance
 * the cashier typed at creation, so part of the balance was unexplained.
 */
function seedCustomerWithHistory() {
  const product = store.addProduct({
    name: 'أرز',
    barcode: '333333',
    category_id: '',
    purchase_price: 5,
    selling_price: 10,
    average_cost: 5,
    stock_quantity: 50,
    minimum_stock: 1,
    unit: 'كيس',
  });

  // Opens owing 30, then buys 40 more on credit: balance 70.
  const customer = store.addCustomer({
    name: 'أبو سالم',
    initial_balance: 30,
    credit_limit: 500,
  });

  store.executeSale({
    items: [{ productId: product.id, quantity: 4 }],
    paymentMethod: 'debt',
    customerId: customer.id,
  });

  return store.getState().customers.find((c) => c.id === customer.id)!;
}

beforeEach(() => {
  store.resetToDefault();
});

/** The header total, scoped by its caption; the amount also appears per customer. */
const headerTotal = () => screen.getByText('إجمالي الديون المطلوبة').closest('div.rounded-xl')!;

/** The "{n} زبائن عليهم مستحقات" badge. The count is its own text node. */
const debtorBadge = () => screen.getByText(/زبائن عليهم مستحقات/);

describe('DebtsView - header totals', () => {
  beforeEach(() => {
    // The demo seed carries its own customers with balances, which would swamp
    // the header total. These tests are about the aggregation, so start empty.
    store.applyCloudSlices({ customers: [], customerPayments: [], sales: [] });
  });

  it('sums only what customers owe', async () => {
    const owing = store.addCustomer({ name: 'مدين', initial_balance: 100, credit_limit: 500 });
    store.addCustomer({ name: 'مسدد', initial_balance: 0, credit_limit: 500 });
    expect(owing.balance).toBe(100);

    render(<DebtsView />);

    expect(headerTotal()).toHaveTextContent('100.00 د.ل');
    expect(debtorBadge()).toHaveTextContent('1');
    expect(debtorBadge().textContent?.trim()).toMatch(/^1/);
  });

  it('does not let a customer credit reduce the debts the shop is owed', async () => {
    // A negative balance is a liability of the shop, not a receivable. Summing it
    // in made the header total disagree with the customer count shown beside it.
    store.addCustomer({ name: 'مدين', initial_balance: 100, credit_limit: 500 });
    store.addCustomer({ name: 'دائن', initial_balance: -40, credit_limit: 500 });

    render(<DebtsView />);

    expect(headerTotal()).toHaveTextContent('100.00 د.ل');
    expect(debtorBadge().textContent?.trim()).toMatch(/^1/);
  });

  it('reports zero when nobody owes anything', async () => {
    store.addCustomer({ name: 'مسدد', initial_balance: 0, credit_limit: 500 });

    render(<DebtsView />);

    expect(headerTotal()).toHaveTextContent('0.00 د.ل');
    expect(debtorBadge().textContent?.trim()).toMatch(/^0/);
  });
});

describe('DebtsView - customer statement', () => {
  it('shows an opening balance so the movements reconcile with the card', async () => {
    const user = userEvent.setup();
    const customer = seedCustomerWithHistory();
    expect(customer.balance).toBe(70);

    render(<DebtsView />);
    await user.click(screen.getByText('أبو سالم'));

    // 70 balance - 40 credit sale = 30 opening, which is what was typed in.
    expect(screen.getByText('رصيد افتتاحي')).toBeInTheDocument();
    expect(screen.getByText('30.00 د.ل')).toBeInTheDocument();
  });

  it('omits the opening line when the movements fully explain the balance', async () => {
    const user = userEvent.setup();
    const product = store.addProduct({
      name: 'ملح',
      barcode: '444444',
      category_id: '',
      purchase_price: 1,
      selling_price: 2,
      average_cost: 1,
      stock_quantity: 20,
      minimum_stock: 1,
      unit: 'كيس',
    });
    // Opens at 0 and buys 20, so nothing is unexplained.
    const customer = store.addCustomer({
      name: 'زبون نظيف',
      initial_balance: 0,
      credit_limit: 500,
    });
    store.executeSale({
      items: [{ productId: product.id, quantity: 10 }],
      paymentMethod: 'debt',
      customerId: customer.id,
    });

    render(<DebtsView />);
    await user.click(screen.getByText('زبون نظيف'));

    expect(screen.queryByText('رصيد افتتاحي')).not.toBeInTheDocument();
  });

  it('lists only debt sales, so a cash sale with a customer is not shown as credit', async () => {
    // store.executeSale stores customer_id independently of the payment method,
    // so the statement's filter has to require payment_method === 'debt' itself.
    const user = userEvent.setup();
    const product = store.addProduct({
      name: 'سكر',
      barcode: '555555',
      category_id: '',
      purchase_price: 2,
      selling_price: 4,
      average_cost: 2,
      stock_quantity: 30,
      minimum_stock: 1,
      unit: 'كيس',
    });
    const customer = store.addCustomer({
      name: 'زبون نقدي',
      initial_balance: 0,
      credit_limit: 500,
    });
    // A cash sale that nonetheless carries a customer id.
    store.executeSale({
      items: [{ productId: product.id, quantity: 2 }],
      paymentMethod: 'cash',
      customerId: customer.id,
    });

    render(<DebtsView />);
    await user.click(screen.getByText('زبون نقدي'));

    // Balance untouched by the cash sale, and no credit movement listed for it.
    expect(
      screen.getByText('لا توجد فواتير آجل أو دفعات مسجلة لهذا العميل بعد')
    ).toBeInTheDocument();
  });

  it('shows the recorded payment history for a customer', async () => {
    const user = userEvent.setup();
    const customer = seedCustomerWithHistory();
    store.recordDebtPayment({ customerId: customer.id, amount: 20, note: 'دفعة نقدية' });

    render(<DebtsView />);
    await user.click(screen.getByText('أبو سالم'));

    // The note shares a text node with the date, so target the payment row by its
    // unique amount rather than matching the note on its own.
    const amount = screen.getByText('-20.00 د.ل');
    const row = amount.closest('div[class*="rounded-xl"]');
    expect(row).toHaveTextContent('دفعة نقدية');
    // 70 - 20 paid = 50 balance, and the opening line still reconciles at 30.
    expect(screen.getAllByText('50.00 د.ل').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('30.00 د.ل')).toBeInTheDocument();
  });
});
