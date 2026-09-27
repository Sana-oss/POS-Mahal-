import React, { useMemo, useState } from 'react';
import { formatArabicDate, formatCurrency } from '../../lib/calculations';
import { useStore } from '../../hooks/useStore';
import type { Expense } from '../../types';

export const ExpensesView: React.FC = () => {
  const { state, addExpense, deleteExpense } = useStore();
  const { expenses, settings } = state;

  const [isAdding, setIsAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('أكياس ومطبوعات');
  const [note, setNote] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Expense | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const categories = [
    'كهرباء',
    'إيجار',
    'أكياس ومطبوعات',
    'صيانة',
    'نقل وتوصيل',
    'مرتبات',
    'أخرى',
  ];

  // Aggregated total
  const totalExpenses = useMemo(() => {
    return expenses.reduce((acc, e) => acc + e.amount, 0);
  }, [expenses]);

  const filteredExpenses = useMemo(() => {
    if (filterCategory === 'all') return expenses;
    return expenses.filter((e) => e.category === filterCategory);
  }, [expenses, filterCategory]);

  // Subtotal for the rows actually on screen. Without this, selecting one
  // category put a single row worth e.g. 65.00 directly under an all-time
  // headline of 130.00, with nothing on screen saying which scope the headline
  // referred to.
  const filteredTotal = useMemo(() => {
    return filteredExpenses.reduce((acc, e) => acc + e.amount, 0);
  }, [filteredExpenses]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const val = parseFloat(amount);
    if (!title.trim()) {
      setError('عنوان المصروف مطلوب.');
      return;
    }
    if (isNaN(val) || val <= 0) {
      setError('يرجى كتابة مبلغ صحيح أكبر من الصفر.');
      return;
    }

    try {
      await addExpense({
        title: title.trim(),
        amount: val,
        category,
        note: note.trim() || undefined,
      });

      setIsAdding(false);
      setTitle('');
      setAmount('');
      setNote('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    }
  };

  /**
   * Deleting an expense is irreversible and moves net profit, so it is confirmed
   * first. This was the only destructive action in the app without a dialog;
   * product deletion and the demo reset both already confirm.
   */
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setError(null);
    setIsDeleting(true);
    try {
      await deleteExpense(deleteTarget.id);
      setDeleteTarget(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setDeleteTarget(null);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-700 border border-rose-100 flex items-center justify-center shadow-xs">
            <span className="material-symbols-outlined text-[28px]">payments</span>
          </div>
          <div className="flex flex-col">
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900">مصروفات وتشغيل المحل</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              تسجيل المصروفات التشغيلية واليومية لاحتساب صافي الأرباح الدقيق
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="bg-slate-50 px-4 py-2 rounded-xl border border-slate-200 text-right">
            <span className="text-[11px] text-slate-400 font-semibold block">
              {filterCategory === 'all' ? 'إجمالي المصروفات' : `مصروفات: ${filterCategory}`}
            </span>
            <span className="text-lg font-extrabold text-slate-900 font-num">
              {formatCurrency(
                filterCategory === 'all' ? totalExpenses : filteredTotal,
                settings.currency
              )}
            </span>
            {filterCategory !== 'all' && (
              <span className="text-[10px] text-slate-400 block mt-0.5">
                الإجمالي الكلي: {formatCurrency(totalExpenses, settings.currency)}
              </span>
            )}
          </div>

          <button
            onClick={() => setIsAdding(!isAdding)}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-rose-600/20 transition active:scale-95"
            type="button"
          >
            <span className="material-symbols-outlined text-[20px]">
              {isAdding ? 'close' : 'add_circle'}
            </span>
            <span>{isAdding ? 'إغلاق' : '+ تسجيل مصروف جديد'}</span>
          </button>
        </div>
      </div>

      {/* PRD Rule Banner */}
      <div className="p-3 bg-teal-50 border border-teal-200/80 rounded-2xl flex items-center gap-2.5 text-xs text-teal-900">
        <span className="material-symbols-outlined text-[20px] text-teal-600 shrink-0">info</span>
        <span>
          <strong>قاعدة حسابية معتمدة:</strong> المصروفات التشغيلية تخصم من <strong>صافي الربح (Net Profit)</strong> فقط، ولا تؤثر على <strong>مجمل ربح البضاعة (Gross Profit)</strong>.
        </span>
      </div>

      {/*
        Rendered at the top level, not inside the add form. Deleting a row sets
        the same error state, and while the banner lived inside the collapsed
        form a failed delete updated state that was never shown: the row stayed,
        nothing was written, and the cashier was given no indication at all.
      */}
      {error && (
        <div
          role="alert"
          className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-bold"
        >
          {error}
        </div>
      )}

      {/* Add Expense Form */}
      {isAdding && (
        <div className="bg-white rounded-2xl border border-rose-200 shadow-md p-5 flex flex-col gap-3.5 animate-in slide-in-from-top-2">
          <h2 className="text-sm font-bold text-slate-900 flex items-center gap-1.5 pb-2 border-b border-slate-100">
            <span className="material-symbols-outlined text-[20px] text-rose-600">receipt</span>
            <span>تسجيل قيد مصروف جديد</span>
          </h2>

          <form onSubmit={handleAdd} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="flex flex-col gap-1 sm:col-span-2">
              <label htmlFor="expense-title" className="text-xs font-bold text-slate-700">بيان المصروف *</label>
              <input
                id="expense-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="مثال: فاتورة كهرباء المحل / شراء أكياس بلاستيكية"
                className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-rose-500"
                required
                autoFocus
              />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="expense-amount" className="text-xs font-bold text-slate-700">المبلغ *</label>
              <div className="relative">
                <input
                  id="expense-amount"
                  type="number"
                  step="0.01"
                  min="0.5"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-left focus:bg-white pl-8"
                  dir="ltr"
                  required
                />
                <span className="absolute left-2.5 top-2 text-[10px] text-slate-400 font-bold">
                  {settings.currency}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="expense-category" className="text-xs font-bold text-slate-700">بند التصنيف</label>
              <select
                id="expense-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs"
              >
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1 sm:col-span-2">
              <label htmlFor="expense-note" className="text-xs font-bold text-slate-700">ملاحظة إضافية (اختياري)</label>
              <input
                id="expense-note"
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="رقم الوصل أو الشخص المستلم..."
                className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs focus:bg-white"
              />
            </div>

            <div className="sm:col-span-3 flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsAdding(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl"
              >
                إلغاء
              </button>
              <button
                type="submit"
                className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl shadow-sm"
              >
                حفظ المصروف
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Expenses Table */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-2xs flex flex-col gap-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px] text-slate-400">table_rows</span>
            <h2 className="font-bold text-base text-slate-900">سجل المصروفات المسجلة</h2>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-xs text-slate-400">تصفية حسب البند:</span>
            <select
              aria-label="تصفية حسب البند"
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="bg-slate-100 border border-slate-200 px-2 py-1 rounded-lg text-xs font-semibold text-slate-700"
            >
              <option value="all">الكل</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-xs font-bold border-y border-slate-100">
                <th className="py-2.5 px-3">التاريخ</th>
                <th className="py-2.5 px-3">بيان المصروف</th>
                <th className="py-2.5 px-3">البند</th>
                <th className="py-2.5 px-3">المبلغ</th>
                <th className="py-2.5 px-3">ملاحظات</th>
                <th className="py-2.5 px-3 text-center">حذف</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs text-slate-800">
              {filteredExpenses.map((exp) => (
                <tr key={exp.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="py-3 px-3 text-slate-400">{formatArabicDate(exp.created_at)}</td>
                  <td className="py-3 px-3 font-bold text-slate-900">{exp.title}</td>
                  <td className="py-3 px-3">
                    <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[10px] font-semibold">
                      {exp.category}
                    </span>
                  </td>
                  <td className="py-3 px-3 font-bold font-num text-rose-700">
                    {formatCurrency(exp.amount, settings.currency)}
                  </td>
                  <td className="py-3 px-3 text-slate-400">{exp.note || '-'}</td>
                  <td className="py-3 px-3 text-center">
                    <button
                      onClick={() => setDeleteTarget(exp)}
                      className="p-1 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded-lg transition"
                      title="حذف المصروف"
                      type="button"
                    >
                      <span className="material-symbols-outlined text-[16px]">delete</span>
                    </button>
                  </td>
                </tr>
              ))}

              {filteredExpenses.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    لا توجد مصروفات مسجلة في هذا البند
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Delete confirmation. An in-app dialog, not a native confirm(): a native
          dialog cannot be styled and is blocked in some PWA contexts. */}
      {deleteTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="تأكيد حذف المصروف"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
        >
          <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden flex flex-col">
            <div className="px-5 py-4 flex items-center gap-3 border-b border-slate-100">
              <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[20px]">warning</span>
              </div>
              <h3 className="font-bold text-sm text-slate-800">حذف المصروف</h3>
            </div>

            <div className="px-5 py-4">
              <p className="text-xs text-slate-600 leading-6">
                هل تريد حذف مصروف «{deleteTarget.title}» بقيمة{' '}
                <span className="font-bold font-num">
                  {formatCurrency(deleteTarget.amount, settings.currency)}
                </span>{' '}
                نهائياً؟ سيؤثر ذلك على صافي الربح ولا يمكن التراجع عن هذا الإجراء.
              </p>
            </div>

            <div className="px-5 py-3.5 bg-slate-50 flex gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="flex-1 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-700 text-xs font-bold hover:bg-slate-100"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={isDeleting}
                className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isDeleting ? 'جارٍ الحذف...' : 'تأكيد الحذف'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
