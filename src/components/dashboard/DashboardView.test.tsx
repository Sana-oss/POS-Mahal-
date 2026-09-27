// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DashboardView } from './DashboardView';
import { store } from '../../lib/store';
import { makeSale, makeSaleItem, makeCustomer, makeExpense, makeProduct } from '../../test/fixtures';
import type { SaleItem } from '../../types';

const DAY = 86_400_000;

const localMidnight = () => {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
};
const iso = (epoch: number) => new Date(epoch).toISOString();

function line(
  name: string,
  productId: string,
  quantity: number,
  unitPrice: number,
  unitCost: number
): SaleItem {
  return makeSaleItem({
    product_id: productId,
    product_name: name,
    quantity,
    unit_price: unitPrice,
    unit_cost: unitCost,
    total_price: Math.round(quantity * unitPrice * 100) / 100,
    total_cost: Math.round(quantity * unitCost * 100) / 100,
    profit: Math.round(quantity * (unitPrice - unitCost) * 100) / 100,
  });
}

function saleOf(invoice: string, createdAt: number, items: SaleItem[], overrides = {}) {
  const totalAmount = items.reduce((a, i) => a + i.total_price, 0);
  const totalCost = items.reduce((a, i) => a + i.total_cost, 0);
  return makeSale({
    invoice_no: invoice,
    created_at: iso(createdAt),
    items,
    total_amount: totalAmount,
    total_cost: totalCost,
    profit: Math.round((totalAmount - totalCost) * 100) / 100,
    ...overrides,
  });
}

const currency = () => store.getState().settings.currency;

/** Scope to a metric card by its caption; figures repeat across the dashboard. */
function metricCard(label: string): HTMLElement {
  const found = screen.getByText(label).closest('div.rounded-2xl');
  if (!found) throw new Error(`no metric card for ${label}`);
  return found as HTMLElement;
}

const renderDashboard = () => {
  const props = {
    onNavigate: vi.fn(),
    onOpenScanner: vi.fn(),
    onOpenAddProduct: vi.fn(),
    onPrintSale: vi.fn(),
  };
  render(<DashboardView {...props} />);
  return props;
};

beforeEach(() => {
  store.resetToDefault();
});

describe('DashboardView - today figures', () => {
  it('derives net profit from revenue, COGS and today expenses', async () => {
    // Revenue 100, COGS 60, expenses 10 => net 30.
    store.applyCloudSlices({
      sales: [saleOf('INV-1', Date.now(), [line('صنف', 'p1', 10, 10, 6)])],
      expenses: [makeExpense({ amount: 10, created_at: iso(Date.now()) })],
    });

    renderDashboard();

    expect(metricCard('صافي الربح الفعلي اليوم')).toHaveTextContent('30.00');
    expect(metricCard('عدد عمليات البيع')).toHaveTextContent('1');
    expect(metricCard('صافي الربح الفعلي اليوم')).toHaveTextContent('10.00');
  });

  it('excludes yesterday from every today figure', async () => {
    store.applyCloudSlices({
      sales: [
        saleOf('TODAY', Date.now(), [line('صنف', 'p1', 1, 100, 50)]),
        saleOf('YESTERDAY', localMidnight() - DAY, [line('صنف', 'p1', 1, 999, 0)]),
      ],
      expenses: [
        makeExpense({ amount: 5, created_at: iso(Date.now()) }),
        makeExpense({ amount: 500, created_at: iso(localMidnight() - DAY) }),
      ],
    });

    renderDashboard();

    // Today: revenue 100, COGS 50, gross 50, expenses 5, net 45.
    expect(metricCard('صافي الربح الفعلي اليوم')).toHaveTextContent('45.00');
    expect(metricCard('عدد عمليات البيع')).toHaveTextContent('1');
    // Yesterday's 500 expense must not drag today's net down.
    expect(metricCard('صافي الربح الفعلي اليوم')).not.toHaveTextContent('505.00');
  });

  it('splits today invoices into cash and debt', async () => {
    store.applyCloudSlices({
      sales: [
        saleOf('C1', Date.now(), [line('أ', 'p1', 1, 10, 5)], { payment_method: 'cash' }),
        saleOf('D1', Date.now(), [line('ب', 'p2', 1, 10, 5)], { payment_method: 'debt' }),
        saleOf('D2', Date.now(), [line('ج', 'p3', 1, 10, 5)], { payment_method: 'debt' }),
      ],
      expenses: [],
    });

    renderDashboard();

    const card = metricCard('عدد عمليات البيع');
    expect(card).toHaveTextContent('1 نقدي');
    expect(card).toHaveTextContent('2 آجل / دين');
    expect(card).toHaveTextContent('3');
  });

  it('reports a zero average ticket before any sale', async () => {
    // avgTicket divides by the count, so the empty state must not render NaN.
    store.applyCloudSlices({ sales: [], expenses: [] });

    renderDashboard();

    expect(metricCard('عدد عمليات البيع')).toHaveTextContent('0.0');
    expect(metricCard('صافي الربح الفعلي اليوم')).toHaveTextContent('0.00');
    expect(screen.getByText('لا توجد مبيعات مسجلة حتى الآن')).toBeInTheDocument();
  });
});

describe('DashboardView - receivables', () => {
  it('sums customer balances and counts only those who owe', async () => {
    store.applyCloudSlices({
      sales: [],
      expenses: [],
      customers: [
        makeCustomer({ name: 'مدين', balance: 100 }),
        makeCustomer({ name: 'مدين آخر', balance: 50 }),
        makeCustomer({ name: 'مسدد', balance: 0 }),
      ],
    });

    renderDashboard();

    expect(metricCard('إجمالي الديون المستحقة')).toHaveTextContent('150.00');
    expect(metricCard('إجمالي الديون المستحقة')).toHaveTextContent('موزعة على 2 زبائن عليهم ديون');
  });

  it('excludes a customer credit from the debts total', async () => {
    // A negative balance is money the shop owes the customer, a liability, not a
    // receivable. Netting it in made "debts owed to you" read 60 instead of 100
    // while the caption still counted only the one customer who actually owes.
    store.applyCloudSlices({
      sales: [],
      expenses: [],
      customers: [
        makeCustomer({ name: 'مدين', balance: 100 }),
        makeCustomer({ name: 'دائن', balance: -40 }),
      ],
    });

    renderDashboard();

    const card = metricCard('إجمالي الديون المستحقة');
    expect(card).toHaveTextContent('100.00');
    expect(card).toHaveTextContent('موزعة على 1 زبائن عليهم ديون');
  });

  it('ignores a settled customer in both the total and the count', async () => {
    store.applyCloudSlices({
      sales: [],
      expenses: [],
      customers: [
        makeCustomer({ name: 'مدين', balance: 70 }),
        makeCustomer({ name: 'مسدد', balance: 0 }),
      ],
    });

    renderDashboard();

    const card = metricCard('إجمالي الديون المستحقة');
    expect(card).toHaveTextContent('70.00');
    expect(card).toHaveTextContent('موزعة على 1 زبائن عليهم ديون');
  });
});

describe('DashboardView - low stock', () => {
  it('flags a product sitting exactly at its minimum', async () => {
    // The filter is stock <= minimum, so "at the reorder point" already warns.
    store.applyCloudSlices({
      sales: [],
      expenses: [],
      products: [
        makeProduct({ name: 'عند الحد', stock_quantity: 5, minimum_stock: 5 }),
        makeProduct({ name: 'نفد', stock_quantity: 0, minimum_stock: 2 }),
        makeProduct({ name: 'متوفر', stock_quantity: 50, minimum_stock: 5 }),
      ],
    });

    renderDashboard();

    expect(screen.getByText('عند الحد')).toBeInTheDocument();
    expect(screen.getByText('نفد')).toBeInTheDocument();
    expect(screen.queryByText('متوفر')).not.toBeInTheDocument();
    expect(screen.getByText('2 أصناف تتطلب الشراء')).toBeInTheDocument();
  });

  it('shows the all-clear state when nothing is low', async () => {
    store.applyCloudSlices({
      sales: [],
      expenses: [],
      products: [makeProduct({ stock_quantity: 50, minimum_stock: 5 })],
    });

    renderDashboard();

    expect(screen.getByText('لا توجد نواقص في المخزون!')).toBeInTheDocument();
  });
});

describe('DashboardView - top sellers', () => {
  it('ranks only today, ignoring earlier days', async () => {
    // The panel is a shift view: last week's 99 units used to outrank today's and
    // the caption carried no period at all. The all-time picture is still one
    // click away via the full invoice log.
    store.applyCloudSlices({
      sales: [
        saleOf('OLD', localMidnight() - 5 * DAY, [line('قديم', 'p1', 99, 10, 5)]),
        saleOf('NEW', Date.now(), [line('حديث', 'p2', 1, 10, 5)]),
      ],
      expenses: [],
    });

    renderDashboard();

    expect(screen.getByText('حديث')).toBeInTheDocument();
    expect(screen.queryByText('قديم')).not.toBeInTheDocument();
    expect(screen.getByText('1 قطعة مبيعة')).toBeInTheDocument();
    expect(screen.getByText('100% نسبة الدوران')).toBeInTheDocument();
  });

  it('clears the leaderboard when nothing was sold today', async () => {
    store.applyCloudSlices({
      sales: [saleOf('OLD', localMidnight() - 5 * DAY, [line('قديم', 'p1', 99, 10, 5)])],
      expenses: [],
    });

    renderDashboard();

    expect(screen.getByText('لا توجد مبيعات مسجلة حتى الآن')).toBeInTheDocument();
    expect(screen.queryByText('قديم')).not.toBeInTheDocument();
  });

  it('scales each bar against the leading product', async () => {
    store.applyCloudSlices({
      sales: [
        saleOf('A', Date.now(), [line('الأول', 'p1', 10, 10, 5), line('الثاني', 'p2', 5, 10, 5)]),
      ],
      expenses: [],
    });

    renderDashboard();

    expect(screen.getByText('100% نسبة الدوران')).toBeInTheDocument();
    expect(screen.getByText('50% نسبة الدوران')).toBeInTheDocument();
  });

  it('keeps a fractional quantity in the leaderboard', async () => {
    store.applyCloudSlices({
      sales: [saleOf('A', Date.now(), [line('لبن', 'p1', 2.5, 10, 6)])],
      expenses: [],
    });

    renderDashboard();

    expect(screen.getByText('2.5 قطعة مبيعة')).toBeInTheDocument();
  });
});

describe('DashboardView - navigation', () => {
  it('routes each quick action to its tab', async () => {
    const user = userEvent.setup();
    const { onNavigate, onOpenScanner, onOpenAddProduct } = renderDashboard();

    await user.click(screen.getByText('+ بيع جديد (F1)'));
    expect(onNavigate).toHaveBeenCalledWith('pos');

    await user.click(screen.getByText('مسح باركود (F2)'));
    expect(onOpenScanner).toHaveBeenCalled();

    await user.click(screen.getByText('+ إضافة منتج جديد'));
    expect(onOpenAddProduct).toHaveBeenCalled();

    await user.click(screen.getByText('دفتر الديون'));
    expect(onNavigate).toHaveBeenCalledWith('debts');
  });
});
