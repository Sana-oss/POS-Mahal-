// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThermalReceiptModal } from './ThermalReceiptModal';
import { formatArabicDate } from '../../lib/calculations';
import { makeSale, makeSaleItem, makeSettings } from '../../test/fixtures';
import type { Sale, Settings } from '../../types';

const CURRENCY = 'د.ل';

function renderReceipt(sale: Sale | null = null, settings: Settings = makeSettings({ currency: CURRENCY })) {
  const props = { sale, settings, onClose: vi.fn() };
  render(<ThermalReceiptModal {...props} />);
  return props;
}

/** The printable 80mm slip, which is what the customer actually receives. */
const slip = () => document.getElementById('printable-receipt')!;

let printSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  printSpy = vi.fn();
  Object.defineProperty(window, 'print', { value: printSpy, writable: true, configurable: true });
});

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).print;
});

describe('ThermalReceiptModal - nothing to show', () => {
  it('renders nothing when there is no sale', () => {
    const { container } = render(<ThermalReceiptModal sale={null} settings={makeSettings()} onClose={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the sale prop is initially null then set', () => {
    // The component returns early, so the F9 listener must be registered before
    // that early return or the hook order would differ between renders.
    const onClose = vi.fn();
    const { rerender, container } = render(
      <ThermalReceiptModal sale={null} settings={makeSettings()} onClose={onClose} />
    );
    expect(container).toBeEmptyDOMElement();

    rerender(
      <ThermalReceiptModal sale={makeSale()} settings={makeSettings()} onClose={onClose} />
    );
    expect(container).not.toBeEmptyDOMElement();
  });
});

describe('ThermalReceiptModal - store header', () => {
  it('prints the shop identity from settings', () => {
    renderReceipt(
      makeSale(),
      makeSettings({
        shop_name: 'سوبرماركت النور',
        branch_name: 'الفرع الرئيسي',
        address: 'شارعfreedom',
        phone: '0910000000',
        currency: CURRENCY,
      })
    );

    expect(screen.getByText('سوبرماركت النور')).toBeInTheDocument();
    expect(screen.getByText('الفرع الرئيسي')).toBeInTheDocument();
    expect(screen.getByText('شارعfreedom')).toBeInTheDocument();
    expect(screen.getByText('هاتف: 0910000000')).toBeInTheDocument();
  });

  it('omits the address and phone when they are not set', () => {
    renderReceipt(
      makeSale(),
      makeSettings({ shop_name: 'محل', branch_name: '', address: '', phone: '', currency: CURRENCY })
    );

    expect(screen.getByText('محل')).toBeInTheDocument();
    expect(slip().textContent).not.toContain('هاتف:');
    expect(slip().querySelectorAll('p')).toHaveLength(2); // shop name + branch line only
  });

  it('prints the receipt footer from settings', () => {
    renderReceipt(makeSale(), makeSettings({ receipt_footer: 'شكراً لزيارتكم', currency: CURRENCY }));

    expect(screen.getByText('شكراً لزيارتكم')).toBeInTheDocument();
  });

  it('does not claim to be a tax invoice while no tax is computed', () => {
    // tax_rate is stored and synced but never applied to any total, and is not
    // editable in Settings, so claiming "simplified tax invoice" on every receipt
    // was unsubstantiated. Reinstate the wording only alongside real tax figures.
    renderReceipt(makeSale(), makeSettings({ currency: CURRENCY }));

    expect(slip()).toHaveTextContent('فاتورة مبيعات');
    expect(slip()).not.toHaveTextContent('ضريبية');
  });
});

describe('ThermalReceiptModal - invoice identity', () => {
  it('prints the invoice number in the header and the barcode', () => {
    renderReceipt(makeSale({ invoice_no: 'INV-7788' }));

    expect(screen.getByText('إيصال الفاتورة #INV-7788')).toBeInTheDocument();
    expect(screen.getByText('*INV-7788*')).toBeInTheDocument();
  });

  it('prints the sale date using the app formatter', () => {
    const created = '2026-03-15T10:30:00.000Z';
    renderReceipt(makeSale({ created_at: created }));

    expect(screen.getByText(formatArabicDate(created))).toBeInTheDocument();
  });

  it('labels a cash sale as cash', () => {
    renderReceipt(makeSale({ payment_method: 'cash', customer_name: 'عميل نقدي عام' }));

    expect(screen.getByText('نقدي (كاش)')).toBeInTheDocument();
  });

  it('names the customer on a debt sale', () => {
    renderReceipt(
      makeSale({ payment_method: 'debt', customer_name: 'أبو سالم', customer_id: 'c1' })
    );

    expect(screen.getByText('آجل (دين: أبو سالم)')).toBeInTheDocument();
    expect(screen.getByText('العميل:')).toBeInTheDocument();
  });
});

describe('ThermalReceiptModal - line items and totals', () => {
  it('prints each line with its quantity, unit price and line total', () => {
    const item = makeSaleItem({
      product_name: 'حليب',
      quantity: 2,
      unit_price: 10,
      unit_cost: 6,
      total_price: 20,
      total_cost: 12,
      profit: 8,
    });

    renderReceipt(makeSale({ items: [item], total_amount: 20, total_cost: 12, items_count: 2 }));

    expect(screen.getByText('حليب')).toBeInTheDocument();
    expect(slip()).toHaveTextContent('20.00'); // line total
    expect(slip()).toHaveTextContent('20.00 د.ل'); // invoice total
  });

  it('keeps a fractional quantity exact on the line and in the summary', () => {
    // 2.5 kg must not print as "2": the label says كمية precisely because
    // "pieces" is untrue for weighed goods.
    const item = makeSaleItem({
      product_name: 'طماطم',
      quantity: 2.5,
      unit_price: 4,
      unit_cost: 2,
      total_price: 10,
      total_cost: 5,
      profit: 5,
    });

    renderReceipt(
      makeSale({ items: [item], total_amount: 10, total_cost: 5, items_count: 2.5 })
    );

    expect(slip()).toHaveTextContent('2.5');
    expect(slip()).toHaveTextContent('2.5 كمية');
    expect(slip()).not.toHaveTextContent('2 كمية');
  });

  it('agrees with itself: the summary quantity is the sum of the printed lines', () => {
    // The slip prints a per-line quantity AND a separate summary figure, so a
    // disagreement would show the customer two contradictory totals. The database
    // documents items_count as matching SUM(sale_items.quantity).
    const items = [
      makeSaleItem({ product_name: 'أ', quantity: 2.5, total_price: 10, total_cost: 5, profit: 5 }),
      makeSaleItem({ product_name: 'ب', quantity: 1, total_price: 8, total_cost: 4, profit: 4 }),
      makeSaleItem({ product_name: 'ج', quantity: 0.5, total_price: 4, total_cost: 2, profit: 2 }),
    ];
    const expected = items.reduce((a, i) => a + i.quantity, 0);

    renderReceipt(
      makeSale({
        items,
        items_count: expected,
        total_amount: items.reduce((a, i) => a + i.total_price, 0),
        total_cost: items.reduce((a, i) => a + i.total_cost, 0),
      })
    );

    expect(slip()).toHaveTextContent(`${expected} كمية`);
  });
});

describe('ThermalReceiptModal - cash received and change', () => {
  it('prints the received amount and the change for a cash sale', () => {
    renderReceipt(
      makeSale({
        payment_method: 'cash',
        total_amount: 20,
        received_amount: 50,
        change_amount: 30,
      })
    );

    expect(screen.getByText('المبلغ المستلم:')).toBeInTheDocument();
    expect(slip()).toHaveTextContent('50.00 د.ل');
    expect(screen.getByText('المبلغ المتبقي (الفكة):')).toBeInTheDocument();
    expect(slip()).toHaveTextContent('30.00 د.ل');
  });

  it('prints zero change for an exact payment', () => {
    renderReceipt(
      makeSale({ payment_method: 'cash', total_amount: 20, received_amount: 20, change_amount: 0 })
    );

    expect(screen.getByText('المبلغ المتبقي (الفكة):')).toBeInTheDocument();
    expect(slip()).toHaveTextContent('0.00 د.ل');
  });

  it('omits the received/change block when the amount is unknown', () => {
    // cloudSync maps a NULL received_amount to undefined precisely so this check
    // can hide the block rather than print a misleading "received 0.00".
    const sale = makeSale({ payment_method: 'cash', total_amount: 20 });
    delete (sale as { received_amount?: number }).received_amount;

    renderReceipt(sale);

    expect(screen.queryByText('المبلغ المستلم:')).not.toBeInTheDocument();
    expect(screen.queryByText('المبلغ المتبقي (الفكة):')).not.toBeInTheDocument();
  });

  it('omits the received/change block on a debt sale', () => {
    // A debt sale collects no cash, so printing a received or change figure
    // would invent money changing hands.
    renderReceipt(
      makeSale({
        payment_method: 'debt',
        customer_id: 'c1',
        customer_name: 'أبو سالم',
        total_amount: 20,
        received_amount: 20,
        change_amount: 0,
      })
    );

    expect(screen.queryByText('المبلغ المستلم:')).not.toBeInTheDocument();
    expect(screen.queryByText('المبلغ المتبقي (الفكة):')).not.toBeInTheDocument();
  });
});

describe('ThermalReceiptModal - actions', () => {
  it('prints from the button', async () => {
    const user = userEvent.setup();
    renderReceipt(makeSale());

    await user.click(screen.getByText('طباعة الإيصال (F9)'));

    expect(printSpy).toHaveBeenCalledTimes(1);
  });

  it('prints from the F9 shortcut, matching the button hint', async () => {
    const user = userEvent.setup();
    renderReceipt(makeSale());

    await user.keyboard('{F9}');

    expect(printSpy).toHaveBeenCalledTimes(1);
  });

  it('ignores other keys', async () => {
    const user = userEvent.setup();
    renderReceipt(makeSale());

    await user.keyboard('{F10}');

    expect(printSpy).not.toHaveBeenCalled();
  });

  it('closes from the footer button and from the top-bar button', async () => {
    const user = userEvent.setup();
    const props = renderReceipt(makeSale());

    await user.click(screen.getByText('إغلاق'));
    expect(props.onClose).toHaveBeenCalledTimes(1);

    // The top-bar control is icon-only, so it needs an explicit label to be
    // reachable by name at all.
    await user.click(screen.getByRole('button', { name: 'إغلاق الإيصال' }));
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });
});
