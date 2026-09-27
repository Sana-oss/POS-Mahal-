// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReportsView } from './ReportsView';
import { store } from '../../lib/store';
import { makeSale, makeSaleItem, makeExpense } from '../../test/fixtures';
import type { SaleItem } from '../../types';

const DAY = 86_400_000;

/** Local midnight today, as an epoch. */
const localMidnight = () => {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
};

const iso = (epoch: number) => new Date(epoch).toISOString();

/**
 * A one-line sale: qty x price at cost, so the P&L arithmetic is checkable by hand.
 */
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

function saleOf(
  invoice: string,
  createdAt: number,
  items: SaleItem[],
  overrides: Partial<ReturnType<typeof makeSale>> = {}
) {
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
const money = (n: number) => `${n.toFixed(2)} ${currency()}`;

/**
 * Scope to a P&L summary card by its caption. Revenue also appears in the sales
 * table and total expenses in the metrics grid, so a bare text match is ambiguous.
 */
function summaryCard(label: string): HTMLElement {
  const found = screen.getByText(label).closest('div.rounded-2xl');
  if (!found) throw new Error(`no summary card for ${label}`);
  return found as HTMLElement;
}

/** Scope to one of the small metrics tiles. */
function metricCard(label: string): HTMLElement {
  const found = screen.getByText(label).closest('div.rounded-xl');
  if (!found) throw new Error(`no metric card for ${label}`);
  return found as HTMLElement;
}

function seed(sales: ReturnType<typeof makeSale>[], expenses: ReturnType<typeof makeExpense>[] = []) {
  store.applyCloudSlices({ sales, expenses });
}

const renderReports = (onPrintSale = vi.fn()) => {
  const props = { onPrintSale };
  render(<ReportsView {...props} />);
  return { onPrintSale };
};

beforeEach(() => {
  store.resetToDefault();
});

describe('ReportsView - P&L figures', () => {
  it('derives gross and net profit from the PRD formulas', async () => {
    // Revenue 100, COGS 60, operating expenses 10 => gross 40, net 30.
    seed([
      saleOf('INV-1', Date.now(), [line('صنف', 'p1', 10, 10, 6)]),
    ], [makeExpense({ amount: 10, created_at: iso(Date.now()) })]);

    renderReports();

    expect(summaryCard('إجمالي المبيعات (Revenue)')).toHaveTextContent(money(100));
    expect(summaryCard('تكلفة البضاعة المباعة (COGS)')).toHaveTextContent(money(60));
    expect(summaryCard('مجمل الربح (Gross Profit)')).toHaveTextContent(money(40));
    expect(summaryCard('صافي الربح الفعلي (Net Profit)')).toHaveTextContent(money(30));

    expect(summaryCard('مجمل الربح (Gross Profit)')).toHaveTextContent('هامش مجمل ربح: 40.0%');
    expect(summaryCard('صافي الربح الفعلي (Net Profit)')).toHaveTextContent('30.0%');
    expect(summaryCard('إجمالي المبيعات (Revenue)')).toHaveTextContent('من 1 فواتير بيع منجزة');
  });

  it('reports a loss when expenses exceed gross profit', async () => {
    seed(
      [saleOf('INV-1', Date.now(), [line('صنف', 'p1', 1, 10, 9)])],
      [makeExpense({ amount: 25, created_at: iso(Date.now()) })]
    );

    renderReports();

    // Gross 1, net -24: a negative figure must render, not clamp to zero.
    expect(summaryCard('مجمل الربح (Gross Profit)')).toHaveTextContent(money(1));
    expect(summaryCard('صافي الربح الفعلي (Net Profit)')).toHaveTextContent(money(-24));
  });

  it('shows a zeroed report rather than NaN when the period is empty', async () => {
    seed([saleOf('INV-OLD', localMidnight() - 2 * DAY, [line('صنف', 'p1', 5, 10, 5)])]);

    renderReports();

    // Guarded divisions: margins fall back to 0 and the average ticket to 0.
    expect(summaryCard('مجمل الربح (Gross Profit)')).toHaveTextContent('هامش مجمل ربح: 0.0%');
    expect(summaryCard('صافي الربح الفعلي (Net Profit)')).toHaveTextContent('0.0%');
    expect(summaryCard('إجمالي المبيعات (Revenue)')).toHaveTextContent('من 0 فواتير بيع منجزة');
    expect(metricCard('متوسط الفاتورة الواحدة')).toHaveTextContent(`0.00 ${currency()}`);
    expect(metricCard('إجمالي عدد الفواتير')).toHaveTextContent('0 فاتورة');
    expect(screen.getByText('لا توجد مبيعات مسجلة في هذه الفترة')).toBeInTheDocument();
  });
});

describe('ReportsView - period boundaries', () => {
  it('excludes yesterday from "today" and includes it in the last 7 days', async () => {
    const user = userEvent.setup();
    seed([
      saleOf('TODAY', Date.now(), [line('صنف', 'p1', 1, 100, 0)]),
      saleOf('YESTERDAY', localMidnight() - DAY, [line('صنف', 'p1', 1, 50, 0)]),
    ]);

    renderReports();
    const revenue = () => summaryCard('إجمالي المبيعات (Revenue)');

    expect(revenue()).toHaveTextContent(money(100));
    expect(revenue()).not.toHaveTextContent(money(150));

    await user.click(screen.getByText('آخر 7 أيام'));

    expect(revenue()).toHaveTextContent(money(150));
  });

  it('files a sale at 23:59:59 local under yesterday, not today', async () => {
    // The comparison is against local midnight, not a UTC day, so an evening
    // shift is not credited to the next day.
    const user = userEvent.setup();
    seed([saleOf('LATE', localMidnight() - 1000, [line('صنف', 'p1', 1, 77, 0)])]);

    renderReports();
    const revenue = () => summaryCard('إجمالي المبيعات (Revenue)');

    expect(revenue()).not.toHaveTextContent(money(77));

    await user.click(screen.getByText('كل الفترات'));

    expect(revenue()).toHaveTextContent(money(77));
  });

  it('includes a sale made exactly at local midnight', async () => {
    seed([saleOf('MIDNIGHT', localMidnight(), [line('صنف', 'p1', 1, 33, 0)])]);

    renderReports();

    expect(summaryCard('إجمالي المبيعات (Revenue)')).toHaveTextContent(money(33));
  });

  it('counts only the expenses inside the selected period', async () => {
    const user = userEvent.setup();
    seed([], [
      makeExpense({ amount: 30, created_at: iso(Date.now()) }),
      makeExpense({ amount: 70, created_at: iso(localMidnight() - 10 * DAY) }),
    ]);

    renderReports();
    const expenses = () => metricCard('إجمالي المصروفات');

    expect(expenses()).toHaveTextContent(`30.00 ${currency()}`);

    await user.click(screen.getByText('كل الفترات'));

    expect(expenses()).toHaveTextContent(`100.00 ${currency()}`);
  });
});

describe('ReportsView - top products', () => {
  it('aggregates the same product across several invoices', async () => {
    seed([
      saleOf('INV-1', Date.now(), [line('حليب', 'p1', 2, 10, 4)]),
      saleOf('INV-2', Date.now(), [line('حليب', 'p1', 3, 10, 4)]),
      saleOf('INV-3', Date.now(), [line('خبز', 'p2', 4, 5, 2)]),
    ]);

    renderReports();

    // حليب: 5 units across two invoices, revenue 50, profit 30.
    const milkRow = screen.getByText('حليب').closest('div[class*="rounded-xl"]')!;
    expect(milkRow).toHaveTextContent('5 قطعة مبيعة');
    expect(milkRow).toHaveTextContent(`50.00 ${currency()}`);
    expect(milkRow).toHaveTextContent(`ربح: +30.00 ${currency()}`);

    // Ranked by quantity: خبز 4 units is second, حليب 5 is first.
    const rows = screen.getAllByText(/قطعة مبيعة/).map((el) => el.closest('div[class*="rounded-xl"]')!);
    expect(rows[0]).toHaveTextContent('حليب');
    expect(rows[1]).toHaveTextContent('خبز');
  });

  it('keeps a fractional quantity fractional', async () => {
    // NUMERIC(10,3) quantities exist, so the leaderboard must not round them away.
    seed([saleOf('INV-1', Date.now(), [line('لبن', 'p1', 2.5, 10, 6)])]);

    renderReports();

    expect(screen.getByText('2.5 قطعة مبيعة')).toBeInTheDocument();
  });

  it('shows at most five products', async () => {
    const items = Array.from({ length: 7 }, (_, i) => line(`صنف ${i + 1}`, `p${i + 1}`, 9 - i, 10, 5));
    seed([saleOf('INV-1', Date.now(), items)]);

    renderReports();

    expect(screen.getAllByText(/قطعة مبيعة/)).toHaveLength(5);
  });
});

describe('ReportsView - sales table', () => {
  it('prints the sale that was clicked, not the first one', async () => {
    const user = userEvent.setup();
    seed([
      saleOf('INV-FIRST', Date.now(), [line('أ', 'p1', 1, 10, 5)]),
      saleOf('INV-SECOND', Date.now(), [line('ب', 'p2', 1, 20, 5)]),
    ]);

    const { onPrintSale } = renderReports();

    const secondRow = screen.getByText('INV-SECOND').closest('tr')!;
    await user.click(within(secondRow).getByRole('button'));

    expect(onPrintSale).toHaveBeenCalledTimes(1);
    expect(onPrintSale.mock.calls[0][0].invoice_no).toBe('INV-SECOND');
  });

  it('labels a debt sale with its customer', async () => {
    seed([
      saleOf('INV-CASH', Date.now(), [line('أ', 'p1', 1, 10, 5)], { payment_method: 'cash' }),
      saleOf('INV-DEBT', Date.now(), [line('ب', 'p2', 1, 20, 5)], {
        payment_method: 'debt',
        customer_name: 'أبو سالم',
      }),
    ]);

    renderReports();

    expect(screen.getByText('نقدي')).toBeInTheDocument();
    expect(screen.getByText('دين: أبو سالم')).toBeInTheDocument();
  });
});
