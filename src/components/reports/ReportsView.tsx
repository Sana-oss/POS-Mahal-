import React, { useMemo, useState } from 'react';
import { formatArabicDate, formatCurrency, formatTimeOnly } from '../../lib/calculations';
import { useStore } from '../../hooks/useStore';
import { Sale } from '../../types';

interface ReportsViewProps {
  onPrintSale: (sale: Sale) => void;
}

export const ReportsView: React.FC<ReportsViewProps> = ({ onPrintSale }) => {
  const { state } = useStore();
  const { sales, expenses, products, settings } = state;

  const [period, setPeriod] = useState<'today' | 'week' | 'month' | 'all'>('today');

  // Filter sales and expenses by period
  const filteredData = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const weekStart = todayStart - 7 * 86400000;
    const monthStart = todayStart - 30 * 86400000;

    let startTime = 0;
    if (period === 'today') startTime = todayStart;
    else if (period === 'week') startTime = weekStart;
    else if (period === 'month') startTime = monthStart;

    const periodSales = sales.filter((s) => new Date(s.created_at).getTime() >= startTime);
    const periodExpenses = expenses.filter((e) => new Date(e.created_at).getTime() >= startTime);

    return { periodSales, periodExpenses };
  }, [sales, expenses, period]);

  // Aggregated calculations
  const totalRevenue = useMemo(
    () => filteredData.periodSales.reduce((acc, s) => acc + s.total_amount, 0),
    [filteredData.periodSales]
  );

  const totalCOGS = useMemo(
    () => filteredData.periodSales.reduce((acc, s) => acc + s.total_cost, 0),
    [filteredData.periodSales]
  );

  // Critical PRD formula: Gross Profit = Sales Revenue - Cost of Goods Sold
  const grossProfit = totalRevenue - totalCOGS;

  const totalOperatingExpenses = useMemo(
    () => filteredData.periodExpenses.reduce((acc, e) => acc + e.amount, 0),
    [filteredData.periodExpenses]
  );

  // Critical PRD formula: Net Profit = Gross Profit - Expenses
  const netProfit = grossProfit - totalOperatingExpenses;

  const grossMarginPercent = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;
  const netMarginPercent = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;
  const salesCount = filteredData.periodSales.length;
  const averageTicket = salesCount > 0 ? totalRevenue / salesCount : 0;

  // Top products in period
  const topProducts = useMemo(() => {
    const map: { [id: string]: { name: string; qty: number; revenue: number; profit: number } } = {};
    filteredData.periodSales.forEach((s) => {
      s.items.forEach((item) => {
        if (!map[item.product_id]) {
          map[item.product_id] = {
            name: item.product_name,
            qty: 0,
            revenue: 0,
            profit: 0,
          };
        }
        map[item.product_id].qty += item.quantity;
        map[item.product_id].revenue += item.total_price;
        map[item.product_id].profit += item.profit;
      });
    });
    return Object.values(map)
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);
  }, [filteredData.periodSales]);

  return (
    <div className="flex flex-col gap-5">
      {/* Top Banner & Period Selector */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-teal-50 text-teal-700 border border-teal-100 flex items-center justify-center shadow-xs">
            <span className="material-symbols-outlined text-[28px]">insights</span>
          </div>
          <div className="flex flex-col">
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900">التقارير وصافي الأرباح</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              تحليل المبيعات، تكلفة البضاعة المباعة (COGS)، وهامش الربح الإجمالي والصافي
            </p>
          </div>
        </div>

        {/* Period Filter Tabs */}
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200 self-start md:self-auto select-none">
          <button
            onClick={() => setPeriod('today')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
              period === 'today' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
            type="button"
          >
            اليوم
          </button>
          <button
            onClick={() => setPeriod('week')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
              period === 'week' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
            type="button"
          >
            آخر 7 أيام
          </button>
          <button
            onClick={() => setPeriod('month')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
              period === 'month' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
            type="button"
          >
            آخر 30 يوماً
          </button>
          <button
            onClick={() => setPeriod('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
              period === 'all' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
            type="button"
          >
            كل الفترات
          </button>
        </div>
      </div>

      {/* Financial Statement P&L Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Revenue */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400 font-semibold">إجمالي المبيعات (Revenue)</span>
            <span className="w-8 h-8 rounded-lg bg-teal-50 text-teal-700 flex items-center justify-center">
              <span className="material-symbols-outlined text-[18px]">payments</span>
            </span>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-extrabold text-slate-900 font-num">
              {formatCurrency(totalRevenue, settings.currency)}
            </span>
          </div>
          <div className="mt-2 text-[11px] text-slate-400">
            من {salesCount} فواتير بيع منجزة
          </div>
        </div>

        {/* COGS */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400 font-semibold">تكلفة البضاعة المباعة (COGS)</span>
            <span className="w-8 h-8 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center">
              <span className="material-symbols-outlined text-[18px]">inventory_2</span>
            </span>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-extrabold text-slate-700 font-num">
              {formatCurrency(totalCOGS, settings.currency)}
            </span>
          </div>
          <div className="mt-2 text-[11px] text-slate-400">
            محسوبة بتكلفة الشراء وقت كل عملية بيع
          </div>
        </div>

        {/* Gross Profit */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400 font-semibold">مجمل الربح (Gross Profit)</span>
            <span className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center">
              <span className="material-symbols-outlined text-[18px]">trending_up</span>
            </span>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-extrabold text-teal-800 font-num">
              {formatCurrency(grossProfit, settings.currency)}
            </span>
          </div>
          <div className="mt-2 text-[11px] text-teal-700 font-bold">
            هامش مجمل ربح: {grossMarginPercent.toFixed(1)}%
          </div>
        </div>

        {/* Net Profit */}
        <div className="bg-emerald-50/80 p-5 rounded-2xl border border-emerald-200 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs text-emerald-800 font-bold">صافي الربح الفعلي (Net Profit)</span>
            <span className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center shadow-xs">
              <span className="material-symbols-outlined text-[18px]">savings</span>
            </span>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-extrabold text-emerald-900 font-num">
              {formatCurrency(netProfit, settings.currency)}
            </span>
          </div>
          <div className="mt-2 text-[11px] text-emerald-800 font-semibold flex items-center justify-between">
            <span>بعد خصم المصاريف ({totalOperatingExpenses.toFixed(2)})</span>
            <span className="font-bold">{netMarginPercent.toFixed(1)}%</span>
          </div>
        </div>
      </div>

      {/* Breakdown Dual-Section */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Top Products in Period (5 cols) */}
        <div className="lg:col-span-5 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-base text-slate-900 flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[20px] text-amber-500">workspace_premium</span>
              <span>المنتجات الأعلى ربحية ومبيعاً</span>
            </h2>
            <span className="text-xs text-slate-400">في هذه الفترة</span>
          </div>

          <div className="flex flex-col gap-2.5">
            {topProducts.map((p, idx) => (
              <div key={idx} className="p-3 bg-slate-50 rounded-xl border border-slate-100 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2.5">
                  <span className="w-6 h-6 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-xs shrink-0">
                    {idx + 1}
                  </span>
                  <div className="flex flex-col">
                    <span className="font-bold text-slate-900 truncate max-w-[150px]">{p.name}</span>
                    <span className="text-[10px] text-slate-400">{p.qty} قطعة مبيعة</span>
                  </div>
                </div>

                <div className="flex flex-col items-end">
                  <span className="font-bold text-slate-800 font-num">{p.revenue.toFixed(2)} {settings.currency}</span>
                  <span className="text-[10px] text-emerald-700 font-bold font-num">
                    ربح: +{p.profit.toFixed(2)} {settings.currency}
                  </span>
                </div>
              </div>
            ))}

            {topProducts.length === 0 && (
              <div className="py-8 text-center text-slate-400 text-xs">
                لا توجد مبيعات مسجلة في هذه الفترة
              </div>
            )}
          </div>
        </div>

        {/* Operating Metrics & Average Basket (7 cols) */}
        <div className="lg:col-span-7 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs flex flex-col gap-4">
          <h2 className="font-bold text-base text-slate-900 flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[20px] text-teal-600">query_stats</span>
            <span>مؤشرات أداء الكاشير والمتجر</span>
          </h2>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex flex-col">
              <span className="text-[11px] text-slate-400 font-semibold">متوسط الفاتورة الواحدة</span>
              <span className="text-lg font-bold text-slate-800 font-num mt-1">
                {averageTicket.toFixed(2)} {settings.currency}
              </span>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex flex-col">
              <span className="text-[11px] text-slate-400 font-semibold">إجمالي عدد الفواتير</span>
              <span className="text-lg font-bold text-slate-800 font-num mt-1">
                {salesCount} فاتورة
              </span>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex flex-col">
              <span className="text-[11px] text-slate-400 font-semibold">إجمالي المصروفات</span>
              <span className="text-lg font-bold text-rose-700 font-num mt-1">
                {totalOperatingExpenses.toFixed(2)} {settings.currency}
              </span>
            </div>
          </div>

          {/* Detailed Sales History Table in Period */}
          <div className="mt-2 flex flex-col gap-2">
            <span className="text-xs font-bold text-slate-700">سجل فواتير الفترة المحددة:</span>
            <div className="max-h-[280px] overflow-y-auto border border-slate-100 rounded-xl">
              <table className="w-full text-right border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 font-bold sticky top-0 border-b border-slate-100">
                    <th className="py-2 px-3">رقم الفاتورة</th>
                    <th className="py-2 px-3">التوقيت</th>
                    <th className="py-2 px-3">طريقة الدفع</th>
                    <th className="py-2 px-3">المبيعات</th>
                    <th className="py-2 px-3">الربح</th>
                    <th className="py-2 px-3 text-center">طباعة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-800">
                  {filteredData.periodSales.map((sale) => (
                    <tr key={sale.id} className="hover:bg-slate-50">
                      <td className="py-2.5 px-3 font-mono font-bold">{sale.invoice_no}</td>
                      <td className="py-2.5 px-3 text-slate-400">{formatTimeOnly(sale.created_at)}</td>
                      <td className="py-2.5 px-3">
                        <span className="px-2 py-0.5 rounded-full text-[10px] bg-slate-100 text-slate-700">
                          {sale.payment_method === 'cash' ? 'نقدي' : `دين: ${sale.customer_name || 'عميل'}`}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-bold font-num">{sale.total_amount.toFixed(2)}</td>
                      <td className="py-2.5 px-3 font-bold text-emerald-700 font-num">+{sale.profit.toFixed(2)}</td>
                      <td className="py-2.5 px-3 text-center">
                        <button
                          onClick={() => onPrintSale(sale)}
                          className="p-1 hover:bg-slate-100 text-slate-400 hover:text-teal-600 rounded"
                          type="button"
                        >
                          <span className="material-symbols-outlined text-[16px]">print</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
