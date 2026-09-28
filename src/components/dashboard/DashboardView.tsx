import React from 'react';
import { formatArabicDate, formatCurrency, formatTimeOnly } from '../../lib/calculations';
import { useStore } from '../../hooks/useStore';
import { Sale } from '../../types';

interface DashboardViewProps {
  onNavigate: (tab: string) => void;
  onOpenScanner: () => void;
  onOpenAddProduct: () => void;
  onPrintSale: (sale: Sale) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  onNavigate,
  onOpenScanner,
  onOpenAddProduct,
  onPrintSale,
}) => {
  const { state, session } = useStore();
  const { sales, products, customers, expenses, settings } = state;

  // Filter today's sales (or all recent sales)
  const todaySales = sales.filter((s) => {
    const saleDate = new Date(s.created_at).toDateString();
    const today = new Date().toDateString();
    return saleDate === today;
  });

  // Calculate today's metrics
  const todayRevenue = todaySales.reduce((acc, s) => acc + s.total_amount, 0);
  const todayCOGS = todaySales.reduce((acc, s) => acc + s.total_cost, 0);
  const todayGrossProfit = todayRevenue - todayCOGS;

  const todayExpenses = expenses.reduce((acc, e) => {
    const expDate = new Date(e.created_at).toDateString();
    return expDate === new Date().toDateString() ? acc + e.amount : acc;
  }, 0);

  // Critical PRD formula: Net Profit = Gross Profit - Expenses
  const todayNetProfit = todayGrossProfit - todayExpenses;
  const todaySalesCount = todaySales.length;
  const avgTicket = todaySalesCount > 0 ? todayRevenue / todaySalesCount : 0;

  // Total outstanding customer debts.
  // Only positive balances count. A negative balance is money the shop owes the
  // customer, which is a liability rather than a receivable, so netting it in
  // under-reported what the shop is owed. This also makes the figure agree with
  // the customer count shown in the same card, which already filtered on > 0.
  const owingCustomers = customers.filter((c) => c.balance > 0);
  const totalDebts = owingCustomers.reduce((acc, c) => acc + c.balance, 0);

  // Low stock products
  const lowStockProducts = products.filter((p) => p.stock_quantity <= p.minimum_stock);

  // Top selling products today.
  // Scoped to todaySales to match the rest of this screen, which is a shift view:
  // the revenue, profit and invoice-count cards are all explicitly "today", and
  // this panel sat beside them with an all-time figure and no period in its
  // caption, so a 99-unit total from last week outranked today's sales. The
  // all-time picture is still one click away via the full invoice log.
  const topProductsMap: { [productId: string]: { name: string; quantity: number; revenue: number } } = {};
  todaySales.forEach((s) => {
    s.items.forEach((item) => {
      if (!topProductsMap[item.product_id]) {
        topProductsMap[item.product_id] = {
          name: item.product_name,
          quantity: 0,
          revenue: 0,
        };
      }
      topProductsMap[item.product_id].quantity += item.quantity;
      topProductsMap[item.product_id].revenue += item.total_price;
    });
  });

  const topProducts = Object.values(topProductsMap)
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 4);

  const maxSoldQty = topProducts[0]?.quantity || 1;

  return (
    <div className="flex flex-col gap-5">
      {/* Top Greeting Ribbon */}
      <div className="relative overflow-hidden rounded-2xl bg-white border border-slate-200/80 p-5 sm:p-6 shadow-2xs">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-5 relative z-10">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full bg-teal-50 text-teal-800 border border-teal-200 text-xs font-bold">
                الوردية المباشرة
              </span>
              {/* Only shown when there is a name to show. The account name comes
                  from the signed-in profile, which is the single source of truth -
                  no name is hardcoded here any more. */}
              {session?.name && (
                <span className="text-slate-400 text-xs">• مسجّل باسم {session.name}</span>
              )}
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
              {session?.name ? `مرحبًا بك يا ${session.name} 👋` : 'مرحبًا بك 👋'}{' '}
              <span className="text-slate-400 font-normal text-base">| {settings.shop_name}</span>
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[18px] text-teal-600">calendar_today</span>
              <span>{formatArabicDate(new Date())}</span>
            </p>
          </div>

          {/* Quick Action Ribbon */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
            <button
              onClick={() => onNavigate('pos')}
              className="h-11 px-4 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 shadow-md shadow-teal-600/20 transition active:scale-95"
              type="button"
            >
              <span className="material-symbols-outlined text-[20px]">add_shopping_cart</span>
              <span>+ بيع جديد (F1)</span>
            </button>
            <button
              onClick={onOpenScanner}
              className="h-11 px-3.5 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-1.5 shadow-2xs transition"
              type="button"
            >
              <span className="material-symbols-outlined text-[20px] text-teal-600">barcode_scanner</span>
              <span>مسح باركود (F2)</span>
            </button>
            <button
              onClick={onOpenAddProduct}
              className="h-11 px-3.5 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-1.5 shadow-2xs transition"
              type="button"
            >
              <span className="material-symbols-outlined text-[20px] text-indigo-600">add_box</span>
              <span>+ إضافة منتج جديد</span>
            </button>
            <button
              onClick={() => onNavigate('purchases')}
              className="h-11 px-3.5 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-1.5 shadow-2xs transition"
              type="button"
            >
              <span className="material-symbols-outlined text-[20px] text-amber-600">local_shipping</span>
              <span>+ توريد مشتريات</span>
            </button>
          </div>
        </div>
      </div>

      {/* 4 Focused KPI Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* Metric 1: Revenue */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-2xs flex flex-col justify-between hover:shadow-md transition">
          <div className="flex items-center justify-between">
            <div className="w-10 h-10 rounded-xl bg-teal-50 text-teal-700 border border-teal-100 flex items-center justify-center">
              <span className="material-symbols-outlined text-[22px]">payments</span>
            </div>
            <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold flex items-center gap-1">
              <span className="material-symbols-outlined text-[14px]">trending_up</span>
              اليوم
            </span>
          </div>
          <div className="mt-4">
            <span className="text-xs text-slate-500 font-semibold block">مبيعات اليوم الإجمالية</span>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="text-2xl sm:text-3xl font-extrabold text-slate-900 font-num">
                {todayRevenue.toFixed(2)}
              </span>
              <span className="text-xs text-slate-400 font-bold">{settings.currency}</span>
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-slate-100 text-[11px] text-slate-400 flex items-center justify-between">
            <span>التكلفة (COGS): {todayCOGS.toFixed(2)} {settings.currency}</span>
            <span className="text-teal-600 font-bold">مجمل: {todayGrossProfit.toFixed(2)} {settings.currency}</span>
          </div>
        </div>

        {/* Metric 2: Net Profit */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-2xs flex flex-col justify-between hover:shadow-md transition">
          <div className="flex items-center justify-between">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-100 flex items-center justify-center">
              <span className="material-symbols-outlined text-[22px]">savings</span>
            </div>
            <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold">
              صافي حقيقي
            </span>
          </div>
          <div className="mt-4">
            <span className="text-xs text-slate-500 font-semibold block">صافي الربح الفعلي اليوم</span>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="text-2xl sm:text-3xl font-extrabold text-emerald-700 font-num">
                {todayNetProfit.toFixed(2)}
              </span>
              <span className="text-xs text-slate-400 font-bold">{settings.currency}</span>
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-slate-100 text-[11px] text-slate-400 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
            <span>الربح بعد خصم التكلفة والمصروفات ({todayExpenses.toFixed(2)} {settings.currency})</span>
          </div>
        </div>

        {/* Metric 3: Total Transactions */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-2xs flex flex-col justify-between hover:shadow-md transition">
          <div className="flex items-center justify-between">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-700 border border-indigo-100 flex items-center justify-center">
              <span className="material-symbols-outlined text-[22px]">receipt</span>
            </div>
            <span className="text-xs text-slate-400 font-num">
              معدل الفاتورة: {avgTicket.toFixed(1)} {settings.currency}
            </span>
          </div>
          <div className="mt-4">
            <span className="text-xs text-slate-500 font-semibold block">عدد عمليات البيع</span>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="text-2xl sm:text-3xl font-extrabold text-slate-900 font-num">
                {todaySalesCount}
              </span>
              <span className="text-xs text-slate-400 font-bold">فاتورة منجزة</span>
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-slate-100 text-[11px] text-slate-400 flex items-center gap-1">
            <span className="text-indigo-600 font-bold">{todaySales.filter((s) => s.payment_method === 'cash').length} نقدي</span>
            <span>•</span>
            <span className="text-amber-600 font-bold">{todaySales.filter((s) => s.payment_method === 'debt').length} آجل / دين</span>
          </div>
        </div>

        {/* Metric 4: Debts / Receivables */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-2xs flex flex-col justify-between hover:shadow-md transition">
          <div className="flex items-center justify-between">
            <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-700 border border-amber-100 flex items-center justify-center">
              <span className="material-symbols-outlined text-[22px]">assignment_ind</span>
            </div>
            <button
              onClick={() => onNavigate('debts')}
              className="px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200 text-xs font-bold hover:bg-rose-100 transition"
              type="button"
            >
              دفتر الديون
            </button>
          </div>
          <div className="mt-4">
            <span className="text-xs text-slate-500 font-semibold block">إجمالي الديون المستحقة</span>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="text-2xl sm:text-3xl font-extrabold text-rose-700 font-num">
                {totalDebts.toFixed(2)}
              </span>
              <span className="text-xs text-slate-400 font-bold">{settings.currency}</span>
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-slate-100 text-[11px] text-slate-400 flex items-center justify-between">
            <span>موزعة على {owingCustomers.length} زبائن عليهم ديون</span>
            <span className="text-rose-600 font-bold">مطلوب متابعة</span>
          </div>
        </div>
      </div>

      {/* Dual Split: Low Stock Warning (⚠️) & Top Sellers (🏆) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Low Stock Section (⚠️) */}
        <div className="lg:col-span-7 flex flex-col gap-4 bg-white rounded-2xl p-5 border border-slate-200/80 shadow-2xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse"></span>
              <h2 className="font-bold text-base text-slate-900">نواقص الرف والمخزن</h2>
            </div>
            <span className="px-2.5 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200 text-xs font-bold">
              {lowStockProducts.length} أصناف تتطلب الشراء
            </span>
          </div>

          {/* Quick Notice */}
          <div className="p-3 bg-amber-50/70 border border-amber-200/80 rounded-xl flex items-center gap-2.5 text-xs text-amber-900">
            <span className="material-symbols-outlined text-[20px] text-amber-600 shrink-0">inventory_2</span>
            <span>
              يتم مراقبة الحد الأدنى للمخزون تلقائياً عند كل عملية بيع؛ يُنصح بطلب الأصناف قبل نفادها.
            </span>
          </div>

          {/* Low Stock Item Cards */}
          <div className="flex flex-col gap-2">
            {lowStockProducts.slice(0, 4).map((item) => (
              <div
                key={item.id}
                className="p-3 bg-slate-50/80 hover:bg-slate-100/90 rounded-xl border border-slate-200/60 flex items-center justify-between transition"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center shrink-0 text-slate-600">
                    <span className="material-symbols-outlined text-[20px]">
                      {item.stock_quantity === 0 ? 'error' : 'warning'}
                    </span>
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="font-bold text-xs sm:text-sm text-slate-800 truncate">{item.name}</span>
                    <span className="text-[11px] text-slate-400">
                      سعر التكلفة: {item.average_cost.toFixed(2)} {settings.currency}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <div className="flex flex-col items-end">
                    <span
                      className={`px-2 py-0.5 rounded-md text-xs font-bold ${
                        item.stock_quantity === 0
                          ? 'bg-rose-100 text-rose-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      المخزون: {item.stock_quantity} {item.unit}
                    </span>
                    <span className="text-[10px] text-slate-400 mt-0.5">الحد الأدنى: {item.minimum_stock}</span>
                  </div>

                  <button
                    onClick={() => onNavigate('purchases')}
                    className="h-8 px-2.5 bg-teal-50 hover:bg-teal-600 hover:text-white text-teal-800 border border-teal-200 rounded-lg text-xs font-bold flex items-center gap-1 transition shadow-2xs"
                    type="button"
                  >
                    <span className="material-symbols-outlined text-[16px]">add_shopping_cart</span>
                    <span>توريد</span>
                  </button>
                </div>
              </div>
            ))}

            {lowStockProducts.length === 0 && (
              <div className="py-8 flex flex-col items-center justify-center text-slate-400 gap-1.5">
                <span className="material-symbols-outlined text-[36px] text-emerald-500">check_circle</span>
                <span className="text-xs font-bold text-slate-700">لا توجد نواقص في المخزون!</span>
                <span className="text-[11px]">كل الأصناف فوق الحد الأدنى للطلب.</span>
              </div>
            )}
          </div>

          <div className="pt-1 flex justify-between items-center text-slate-400 text-xs">
            <span>يتم تدقيق الأرصدة تلقائياً</span>
            <button
              onClick={() => onNavigate('inventory')}
              className="text-teal-700 font-bold hover:underline flex items-center gap-1"
              type="button"
            >
              <span>عرض كامل المخزون ({products.length})</span>
              <span className="material-symbols-outlined text-[16px]">arrow_back</span>
            </button>
          </div>
        </div>

        {/* Top Selling Products Today (🏆) */}
        <div className="lg:col-span-5 flex flex-col gap-4 bg-white rounded-2xl p-5 border border-slate-200/80 shadow-2xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[20px] text-amber-500">workspace_premium</span>
              <h2 className="font-bold text-base text-slate-900">الأكثر مبيعاً اليوم</h2>
            </div>
            <span className="text-xs text-slate-400">حسب الكمية</span>
          </div>

          <div className="flex flex-col gap-2.5">
            {topProducts.map((p, idx) => {
              const percentage = Math.round((p.quantity / maxSoldQty) * 100);
              return (
                <div key={idx} className="flex flex-col gap-1 p-2.5 bg-slate-50/70 rounded-xl border border-slate-100">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center text-[10px] font-bold">
                        {idx + 1}
                      </span>
                      <span className="font-bold text-xs text-slate-800 truncate max-w-[170px]">{p.name}</span>
                    </div>
                    <span className="text-xs font-bold text-teal-800 font-num">
                      {p.revenue.toFixed(2)} {settings.currency}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-400 px-7">
                    <span>{p.quantity} قطعة مبيعة</span>
                    <span>{percentage}% نسبة الدوران</span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden mt-0.5">
                    <div className="h-full bg-teal-500 rounded-full transition-all" style={{ width: `${percentage}%` }}></div>
                  </div>
                </div>
              );
            })}

            {topProducts.length === 0 && (
              <div className="py-8 flex flex-col items-center justify-center text-slate-400 gap-1.5">
                <span className="material-symbols-outlined text-[36px] text-slate-300">bar_chart</span>
                <span className="text-xs font-bold text-slate-700">لا توجد مبيعات مسجلة حتى الآن</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Recent Sales Activity Section */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-2xs flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[22px] text-teal-600">receipt_long</span>
            <div>
              <h2 className="font-bold text-base text-slate-900">آخر فواتير المبيعات المنفذة</h2>
              <p className="text-xs text-slate-400">تحديث لحظي لعمليات الكاشير والبيع الآجل</p>
            </div>
          </div>
          <button
            onClick={() => onNavigate('reports')}
            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold flex items-center gap-1 transition self-start sm:self-auto"
            type="button"
          >
            <span>سجل الفواتير الكامل ({sales.length})</span>
            <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          </button>
        </div>

        {/* Transactions Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-xs font-bold border-y border-slate-100">
                <th className="py-2.5 px-3">رقم الفاتورة</th>
                <th className="py-2.5 px-3">التوقيت</th>
                <th className="py-2.5 px-3">الأصناف المشتراة</th>
                <th className="py-2.5 px-3">طريقة السداد</th>
                <th className="py-2.5 px-3">المبلغ الإجمالي</th>
                <th className="py-2.5 px-3">الربح</th>
                <th className="py-2.5 px-3 text-center">الإجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs text-slate-800">
              {sales.slice(0, 5).map((sale) => (
                <tr key={sale.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="py-3 px-3 font-mono font-bold text-slate-900">{sale.invoice_no}</td>
                  <td className="py-3 px-3 text-slate-400">{formatTimeOnly(sale.created_at)}</td>
                  <td className="py-3 px-3 max-w-xs truncate text-slate-600">
                    {sale.items.map((i) => `${i.product_name} (${i.quantity})`).join('، ')}
                  </td>
                  <td className="py-3 px-3">
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                        sale.payment_method === 'cash'
                          ? 'bg-teal-50 text-teal-800 border border-teal-200'
                          : 'bg-indigo-50 text-indigo-800 border border-indigo-200'
                      }`}
                    >
                      <span className="material-symbols-outlined text-[14px]">
                        {sale.payment_method === 'cash' ? 'attach_money' : 'person'}
                      </span>
                      <span>
                        {sale.payment_method === 'cash' ? 'نقدي (كاش)' : `دين: ${sale.customer_name || 'عميل'}`}
                      </span>
                    </span>
                  </td>
                  <td className="py-3 px-3 font-bold font-num text-slate-900">
                    {formatCurrency(sale.total_amount, settings.currency)}
                  </td>
                  <td className="py-3 px-3 font-bold font-num text-emerald-700">
                    +{sale.profit.toFixed(2)} {settings.currency}
                  </td>
                  <td className="py-3 px-3 text-center">
                    <button
                      onClick={() => onPrintSale(sale)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-teal-600 hover:bg-slate-100 transition"
                      title="طباعة الفاتورة"
                      type="button"
                    >
                      <span className="material-symbols-outlined text-[18px]">print</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
