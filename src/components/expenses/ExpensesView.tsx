import React, { useMemo, useState } from 'react';
import { formatArabicDate, formatCurrency } from '../../lib/calculations';
import { useStore } from '../../hooks/useStore';

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

  const handleAdd = (e: React.FormEvent) => {
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
      addExpense({
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
            <span className="text-[11px] text-slate-400 font-semibold block">إجمالي المصروفات</span>
            <span className="text-lg font-extrabold text-slate-900 font-num">
              {formatCurrency(totalExpenses, settings.currency)}
            </span>
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

      {/* Add Expense Form */}
      {isAdding && (
        <div className="bg-white rounded-2xl border border-rose-200 shadow-md p-5 flex flex-col gap-3.5 animate-in slide-in-from-top-2">
          <h2 className="text-sm font-bold text-slate-900 flex items-center gap-1.5 pb-2 border-b border-slate-100">
            <span className="material-symbols-outlined text-[20px] text-rose-600">receipt</span>
            <span>تسجيل قيد مصروف جديد</span>
          </h2>

          {error && (
            <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-bold">
              {error}
            </div>
          )}

          <form onSubmit={handleAdd} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="flex flex-col gap-1 sm:col-span-2">
              <label className="text-xs font-bold text-slate-700">بيان المصروف *</label>
              <input
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
              <label className="text-xs font-bold text-slate-700">المبلغ *</label>
              <div className="relative">
                <input
                  type="number"
                  step="0.5"
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
              <label className="text-xs font-bold text-slate-700">بند التصنيف</label>
              <select
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
              <label className="text-xs font-bold text-slate-700">ملاحظة إضافية (اختياري)</label>
              <input
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
                      onClick={() => deleteExpense(exp.id)}
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
    </div>
  );
};
