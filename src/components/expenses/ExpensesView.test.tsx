// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExpensesView } from './ExpensesView';
import { store } from '../../lib/store';
import { formatArabicDate } from '../../lib/calculations';
import { makeExpense } from '../../test/fixtures';

vi.mock('../../lib/audio', () => ({ playSound: vi.fn() }));
vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

/**
 * Expenses subtract from net profit on both the Reports and Dashboard screens, so
 * a defect here silently moves the number the owner bases decisions on. This had
 * no coverage.
 *
 * deleteExpense is the only seam overridden, so a rejected delete can be observed
 * without mocking the store the component renders from.
 */
const failDelete = { enabled: false };

vi.mock('../../hooks/useStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useStore')>();
  return {
    useStore: () => {
      const real = actual.useStore();
      return {
        ...real,
        deleteExpense: (id: string) =>
          failDelete.enabled
            ? Promise.reject(new Error('تعذر حذف المصروف من السحابة.'))
            : real.deleteExpense(id),
      };
    },
  };
});

const iso = (epoch: number) => new Date(epoch).toISOString();
const currency = () => store.getState().settings.currency;
const money = (n: number) => `${n.toFixed(2)} ${currency()}`;

const titleField = () => screen.getByLabelText('بيان المصروف *');
const amountField = () => screen.getByLabelText('المبلغ *');
const categoryField = () => screen.getByLabelText('بند التصنيف');
const noteField = () => screen.getByLabelText('ملاحظة إضافية (اختياري)');

/** Open the collapsed add form. */
async function openForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /تسجيل مصروف جديد/ }));
}

/** The header total, scoped by its caption. */
const headerTotal = () => screen.getByText('إجمالي المصروفات').closest('div.rounded-xl')!;

/** The category filter select in the table toolbar. */
const filterSelect = () => screen.getByLabelText('تصفية حسب البند') as HTMLSelectElement;

function rowFor(title: string): HTMLElement {
  const row = screen.getByText(title).closest('tr');
  if (!row) throw new Error(`no row for ${title}`);
  return row as HTMLElement;
}

beforeEach(() => {
  store.resetToDefault();
  failDelete.enabled = false;
  // Start from an empty ledger: the demo seed carries its own expenses.
  store.applyCloudSlices({ expenses: [] });
});

describe('ExpensesView - recording an expense', () => {
  it('saves the expense and closes the form', async () => {
    const user = userEvent.setup();
    render(<ExpensesView />);
    await openForm(user);

    await user.type(titleField(), 'فاتورة كهرباء');
    await user.type(amountField(), '45.5');
    await user.selectOptions(categoryField(), 'كهرباء');
    await user.type(noteField(), 'وصل رقم 88');
    await user.click(screen.getByText('حفظ المصروف'));

    const saved = store.getState().expenses;
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      title: 'فاتورة كهرباء',
      amount: 45.5,
      category: 'كهرباء',
      note: 'وصل رقم 88',
    });
    expect(screen.queryByLabelText('بيان المصروف *')).not.toBeInTheDocument();
  });

  it('trims the title and stores no note when it is left blank', async () => {
    const user = userEvent.setup();
    render(<ExpensesView />);
    await openForm(user);

    await user.type(titleField(), '   مصروف بدون ملاحظة   ');
    await user.type(amountField(), '10');
    await user.click(screen.getByText('حفظ المصروف'));

    const saved = store.getState().expenses[0];
    expect(saved.title).toBe('مصروف بدون ملاحظة');
    expect(saved.note).toBeUndefined();
  });

  it('resets the form after saving so the next entry starts clean', async () => {
    const user = userEvent.setup();
    render(<ExpensesView />);
    await openForm(user);

    await user.type(titleField(), 'أول مصروف');
    await user.type(amountField(), '20');
    await user.click(screen.getByText('حفظ المصروف'));
    await openForm(user);

    expect(titleField()).toHaveValue('');
    // An empty number input reports null rather than ''.
    expect(amountField()).toHaveValue(null);
    expect(noteField()).toHaveValue('');
  });

  it('blocks an empty title without writing anything', async () => {
    const user = userEvent.setup();
    render(<ExpensesView />);
    await openForm(user);

    await user.type(amountField(), '30');
    await user.click(screen.getByText('حفظ المصروف'));

    // The field is `required`, so the browser blocks submission outright.
    expect(screen.getByLabelText('بيان المصروف *')).toBeInTheDocument();
    expect(store.getState().expenses).toHaveLength(0);
  });

  it('rejects a zero amount through the submit handler', async () => {
    // min="0.5" stops the browser, so this covers the handler guard itself.
    const user = userEvent.setup();
    render(<ExpensesView />);
    await openForm(user);

    await user.type(titleField(), 'مصروف صفري');
    const form = amountField().closest('form')!;
    fireEvent.submit(form);

    expect(await screen.findByText('يرجى كتابة مبلغ صحيح أكبر من الصفر.')).toBeInTheDocument();
    expect(store.getState().expenses).toHaveLength(0);
  });

  it('discards the entry when cancelled', async () => {
    const user = userEvent.setup();
    render(<ExpensesView />);
    await openForm(user);

    await user.type(titleField(), 'مصروف ملغى');
    await user.type(amountField(), '15');
    await user.click(screen.getByText('إلغاء'));

    expect(store.getState().expenses).toHaveLength(0);
    expect(screen.queryByLabelText('بيان المصروف *')).not.toBeInTheDocument();
  });
});

describe('ExpensesView - totals and filtering', () => {
  // Titles deliberately differ from their category names: a row's category badge
  // and the filter's <option> carry the same word, so a shared string would make
  // every text query ambiguous.
  const powerBill = () => makeExpense({ title: 'فاتورة كهرباء', amount: 30, category: 'كهرباء' });
  const rent = () => makeExpense({ title: 'إيجار المحل', amount: 100, category: 'إيجار' });

  it('sums every expense when no filter is applied', async () => {
    store.applyCloudSlices({ expenses: [powerBill(), rent()] });

    render(<ExpensesView />);

    expect(headerTotal()).toHaveTextContent(money(130));
    expect(screen.getAllByRole('row')).toHaveLength(3); // header + 2 expenses
  });

  it('narrows both the rows and the headline to the selected category', async () => {
    // Regression risk: a single row worth e.g. 100 used to sit under an all-time
    // 130 headline with nothing on screen saying which scope the headline meant.
    const user = userEvent.setup();
    store.applyCloudSlices({ expenses: [powerBill(), rent()] });

    render(<ExpensesView />);
    await user.selectOptions(filterSelect(), 'إيجار');

    expect(rowFor('إيجار المحل')).toBeInTheDocument();
    expect(screen.queryByRole('row', { name: /فاتورة كهرباء/ })).not.toBeInTheDocument();

    // Headline switches to the filtered figure and still states the all-time one.
    const total = screen.getByText('مصروفات: إيجار').closest('div.rounded-xl')!;
    expect(total).toHaveTextContent(money(100));
    expect(total).toHaveTextContent(`الإجمالي الكلي: ${money(130)}`);
  });

  it('reports zero for a category with nothing in it', async () => {
    const user = userEvent.setup();
    store.applyCloudSlices({ expenses: [powerBill()] });

    render(<ExpensesView />);
    await user.selectOptions(filterSelect(), 'صيانة');

    expect(screen.getByText('لا توجد مصروفات مسجلة في هذا البند')).toBeInTheDocument();
    expect(screen.getByText('مصروفات: صيانة').closest('div.rounded-xl')).toHaveTextContent(
      money(0)
    );
  });

  it('returns to the all-time total when the filter is cleared', async () => {
    const user = userEvent.setup();
    store.applyCloudSlices({ expenses: [powerBill(), rent()] });

    render(<ExpensesView />);
    await user.selectOptions(filterSelect(), 'إيجار');
    await user.selectOptions(filterSelect(), 'all');

    expect(headerTotal()).toHaveTextContent(money(130));
    expect(screen.getAllByRole('row')).toHaveLength(3);
  });
});

describe('ExpensesView - deleting an expense', () => {
  const deleteDialog = () => screen.getByRole('dialog', { name: 'تأكيد حذف المصروف' });
  // queryBy, not getBy: asserting absence with a throwing query fails the test.
  const queryDeleteDialog = () => screen.queryByRole('dialog', { name: 'تأكيد حذف المصروف' });

  it('asks for confirmation instead of deleting on the first click', async () => {
    // An expense is a financial record and deleting it moves net profit, so a
    // single tap on a small trash icon must not destroy it.
    const user = userEvent.setup();
    store.applyCloudSlices({
      expenses: [makeExpense({ title: 'فاتورة كهرباء', amount: 30, category: 'كهرباء' })],
    });

    render(<ExpensesView />);
    await user.click(within(rowFor('فاتورة كهرباء')).getByTitle('حذف المصروف'));

    expect(deleteDialog()).toBeInTheDocument();
    expect(deleteDialog()).toHaveTextContent('فاتورة كهرباء');
    expect(deleteDialog()).toHaveTextContent(money(30));
    // Nothing is written until confirmed.
    expect(store.getState().expenses).toHaveLength(1);
  });

  it('keeps the expense when cancelled', async () => {
    const user = userEvent.setup();
    store.applyCloudSlices({
      expenses: [makeExpense({ title: 'فاتورة كهرباء', amount: 30, category: 'كهرباء' })],
    });

    render(<ExpensesView />);
    await user.click(within(rowFor('فاتورة كهرباء')).getByTitle('حذف المصروف'));
    await user.click(within(deleteDialog()).getByText('إلغاء'));

    expect(queryDeleteDialog()).not.toBeInTheDocument();
    expect(store.getState().expenses).toHaveLength(1);
  });

  it('removes only the confirmed row and updates the total', async () => {
    const user = userEvent.setup();
    store.applyCloudSlices({
      expenses: [
        makeExpense({ title: 'فاتورة كهرباء', amount: 30, category: 'كهرباء' }),
        makeExpense({ title: 'إيجار المحل', amount: 100, category: 'إيجار' }),
      ],
    });

    render(<ExpensesView />);
    await user.click(within(rowFor('فاتورة كهرباء')).getByTitle('حذف المصروف'));
    await user.click(within(deleteDialog()).getByText('تأكيد الحذف'));

    expect(store.getState().expenses.map((e) => e.title)).toEqual(['إيجار المحل']);
    expect(headerTotal()).toHaveTextContent(money(100));
  });

  it('surfaces a failed deletion instead of swallowing it', async () => {
    // Regression: the error banner lived inside the add form, which is collapsed
    // by default, so a rejected delete updated state that was never rendered. The
    // cashier saw nothing happen and assumed the expense was gone.
    const user = userEvent.setup();
    failDelete.enabled = true;
    store.applyCloudSlices({
      expenses: [makeExpense({ title: 'فاتورة كهرباء', amount: 30, category: 'كهرباء' })],
    });

    render(<ExpensesView />);
    // The add form stays closed, which is where the failure used to vanish.
    await user.click(within(rowFor('فاتورة كهرباء')).getByTitle('حذف المصروف'));
    await user.click(within(deleteDialog()).getByText('تأكيد الحذف'));

    expect(await screen.findByRole('alert')).toHaveTextContent('تعذر حذف المصروف من السحابة.');
    expect(queryDeleteDialog()).not.toBeInTheDocument();
    expect(store.getState().expenses).toHaveLength(1);
  });
});

describe('ExpensesView - date handling', () => {
  it('renders an expense recorded now under today', async () => {
    const now = new Date();
    store.applyCloudSlices({
      expenses: [makeExpense({ title: 'مصروف اليوم', amount: 5, created_at: iso(Date.now()) })],
    });

    render(<ExpensesView />);

    expect(rowFor('مصروف اليوم')).toHaveTextContent(formatArabicDate(now));
  });
});
