import React, { useMemo, useState } from 'react';
import { formatArabicDate, formatCurrency, deriveOpeningBalance } from '../../lib/calculations';
import { useStore } from '../../hooks/useStore';
import { Customer } from '../../types';

export const DebtsView: React.FC = () => {
  const { state, addCustomer, recordDebtPayment } = useStore();
  const { customers, sales, customerPayments, settings } = state;

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>(customers[0]?.id || '');
  const [showAddCustomerModal, setShowAddCustomerModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);

  // New customer form state
  const [newCustName, setNewCustName] = useState('');
  const [newCustPhone, setNewCustPhone] = useState('');
  const [newCustLimit, setNewCustLimit] = useState('200');
  const [newCustInitial, setNewCustInitial] = useState('0');
  const [newCustNotes, setNewCustNotes] = useState('');
  const [custError, setCustError] = useState<string | null>(null);

  // Payment form state
  const [payAmount, setPayAmount] = useState('');
  const [payNote, setPayNote] = useState('');
  const [payError, setPayError] = useState<string | null>(null);

  // Selected customer
  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === selectedCustomerId) || customers[0],
    [customers, selectedCustomerId]
  );

  // Filtered customer list
  const filteredCustomers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return customers.filter((c) => {
      return !q || c.name.toLowerCase().includes(q) || (c.phone && c.phone.includes(q));
    });
  }, [customers, searchQuery]);

  // Aggregated totals.
  // Both figures come from the same filtered list on purpose. Summing every
  // balance while counting only positive ones made the header total a net figure
  // that disagreed with the customer count beside it, and a customer holding
  // credit (a negative balance, reachable through the initial_balance field)
  // silently reduced the debts the shop is owed.
  const debtors = useMemo(() => customers.filter((c) => c.balance > 0), [customers]);

  const totalOutstandingDebts = useMemo(() => {
    return debtors.reduce((acc, c) => acc + c.balance, 0);
  }, [debtors]);

  const debtorCount = debtors.length;

  // Purchases on credit for selected customer.
  // Filtered on payment_method as well as customer_id: only a DEBT sale moves
  // the balance, so a cash sale that happened to carry a customer would
  // otherwise be listed here as a credit movement of +total_amount that never
  // reached the balance.
  const customerSales = useMemo(() => {
    if (!selectedCustomer) return [];
    return sales.filter(
      (s) => s.customer_id === selectedCustomer.id && s.payment_method === 'debt'
    );
  }, [sales, selectedCustomer]);

  // Payments for selected customer
  const customerLedgerPayments = useMemo(() => {
    if (!selectedCustomer) return [];
    return customerPayments.filter((p) => p.customer_id === selectedCustomer.id);
  }, [customerPayments, selectedCustomer]);

  /**
   * Opening balance: whatever the cashier entered as "دين سابق افتتاحي" when the
   * customer was created. It is part of `balance` but is not stored separately,
   * so it has to be derived. Without showing it, the statement below cannot be
   * reconciled with the balance card.
   */
  const openingBalance = useMemo(() => {
    if (!selectedCustomer) return 0;
    return deriveOpeningBalance(
      selectedCustomer.balance,
      customerSales.map((s) => s.total_amount),
      customerLedgerPayments.map((p) => p.amount)
    );
  }, [selectedCustomer, customerSales, customerLedgerPayments]);

  // Handle add customer
  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    setCustError(null);
    if (!newCustName.trim()) {
      setCustError('اسم العميل مطلوب.');
      return;
    }

    try {
      const created = await addCustomer({
        name: newCustName.trim(),
        phone: newCustPhone.trim(),
        credit_limit: parseFloat(newCustLimit) || 200,
        initial_balance: parseFloat(newCustInitial) || 0,
        notes: newCustNotes.trim(),
      });
      setSelectedCustomerId(created.id);
      setShowAddCustomerModal(false);
      setNewCustName('');
      setNewCustPhone('');
      setNewCustInitial('0');
      setNewCustNotes('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setCustError(msg);
    }
  };

  // Handle payment
  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setPayError(null);
    if (!selectedCustomer) return;

    const amt = parseFloat(payAmount);
    if (isNaN(amt) || amt <= 0) {
      setPayError('يرجى إدخال مبلغ سداد صحيح.');
      return;
    }

    if (amt > selectedCustomer.balance) {
      setPayError(
        `المبلغ المدخل (${amt} د.ل) أكبر من إجمالي الدين المطلوب (${selectedCustomer.balance.toFixed(2)} د.ل). لا يمكن أن يصبح الرصيد سالباً.`
      );
      return;
    }

    try {
      await recordDebtPayment({
        customerId: selectedCustomer.id,
        amount: amt,
        note: payNote.trim() || 'سداد نقدي لحساب الدين',
      });
      setShowPaymentModal(false);
      setPayAmount('');
      setPayNote('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setPayError(msg);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Header & Metrics */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-700 border border-indigo-100 flex items-center justify-center shadow-xs">
            <span className="material-symbols-outlined text-[28px]">group</span>
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900">الديون والعملاء</h1>
              <span className="px-2.5 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200 text-xs font-bold font-num">
                {debtorCount} زبائن عليهم مستحقات
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              دفتر ديون الزبائن، متابعة الأرصدة، تسجيل فواتير الآجل وسندات القبض بدقة
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="bg-slate-50 px-4 py-2 rounded-xl border border-slate-200 text-right">
            <span className="text-[11px] text-slate-400 font-semibold block">إجمالي الديون المطلوبة</span>
            <span className="text-lg font-extrabold text-rose-700 font-num">
              {formatCurrency(totalOutstandingDebts, settings.currency)}
            </span>
          </div>

          <button
            onClick={() => setShowAddCustomerModal(true)}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-indigo-600/20 transition active:scale-95"
            type="button"
          >
            <span className="material-symbols-outlined text-[20px]">person_add</span>
            <span>+ فتح حساب عميل جديد</span>
          </button>
        </div>
      </div>

      {/* Main Two-Zone Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Right Zone: Customers List (5 Cols) */}
        <div className="lg:col-span-5 flex flex-col gap-3">
          <div className="bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-2xs flex flex-col gap-3">
            <div className="relative">
              <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-[20px]">
                search
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ابحث بالاسم أو رقم الهاتف..."
                className="w-full bg-slate-50 text-slate-800 placeholder:text-slate-400 pr-9 pl-3 py-2 rounded-xl text-xs border border-slate-200 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="flex flex-col gap-2 max-h-[600px] overflow-y-auto">
              {filteredCustomers.map((cust) => {
                const isSelected = selectedCustomer?.id === cust.id;
                const hasDebt = cust.balance > 0;

                return (
                  <div
                    key={cust.id}
                    onClick={() => setSelectedCustomerId(cust.id)}
                    className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between ${
                      isSelected
                        ? 'bg-indigo-50/70 border-indigo-300 shadow-2xs'
                        : 'bg-slate-50/70 hover:bg-slate-100 border-slate-200/70'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm shrink-0 ${
                          hasDebt
                            ? 'bg-rose-100 text-rose-800'
                            : 'bg-emerald-100 text-emerald-800'
                        }`}
                      >
                        {cust.name.charAt(0)}
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="font-bold text-slate-900 text-xs sm:text-sm truncate">{cust.name}</span>
                        <span className="text-[11px] text-slate-400 mt-0.5 truncate">{cust.phone || 'بدون هاتف'}</span>
                      </div>
                    </div>

                    <div className="flex flex-col items-end text-left shrink-0">
                      <span
                        className={`font-bold font-num text-sm ${
                          hasDebt ? 'text-rose-700' : 'text-emerald-700'
                        }`}
                      >
                        {cust.balance.toFixed(2)} {settings.currency}
                      </span>
                      <span className="text-[10px] text-slate-400 font-num">
                        سقف: {cust.credit_limit.toFixed(2)} {settings.currency}
                      </span>
                    </div>
                  </div>
                );
              })}

              {filteredCustomers.length === 0 && (
                <div className="py-8 text-center text-slate-400 text-xs">لا يوجد عملاء مسجلين بهذا الاسم</div>
              )}
            </div>
          </div>
        </div>

        {/* Left Zone: Selected Customer Details & Statement Drawer (7 Cols) */}
        <div className="lg:col-span-7 flex flex-col gap-4">
          {selectedCustomer ? (
            <div className="bg-white rounded-2xl border border-slate-200/80 shadow-md p-5 flex flex-col gap-4">
              {/* Customer Header Box */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="w-14 h-14 rounded-2xl bg-indigo-50 text-indigo-700 border border-indigo-100 flex items-center justify-center font-bold text-xl shrink-0">
                    {selectedCustomer.name.charAt(0)}
                  </div>
                  <div className="flex flex-col">
                    <h2 className="text-base sm:text-lg font-bold text-slate-900">{selectedCustomer.name}</h2>
                    <span className="text-xs text-slate-400 flex items-center gap-1.5 mt-0.5">
                      <span className="material-symbols-outlined text-[16px] text-indigo-500">phone</span>
                      <span dir="ltr">{selectedCustomer.phone || 'غير مسجل'}</span>
                      {selectedCustomer.notes && (
                        <>
                          <span>•</span>
                          <span>{selectedCustomer.notes}</span>
                        </>
                      )}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-start sm:self-auto">
                  <button
                    onClick={() => {
                      setPayAmount(selectedCustomer.balance.toString());
                      setShowPaymentModal(true);
                      setPayError(null);
                    }}
                    disabled={selectedCustomer.balance <= 0}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-600/20 transition active:scale-95 flex items-center gap-1.5"
                    type="button"
                  >
                    <span className="material-symbols-outlined text-[18px]">payments</span>
                    <span>قبض دفعة نقدية</span>
                  </button>
                </div>
              </div>

              {/* Balance Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex flex-col">
                  <span className="text-[11px] text-rose-700 font-semibold">إجمالي الدين الحالي</span>
                  <span className="text-xl font-extrabold text-rose-800 font-num mt-1">
                    {formatCurrency(selectedCustomer.balance, settings.currency)}
                  </span>
                </div>

                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex flex-col">
                  <span className="text-[11px] text-slate-500 font-semibold">الحد الائتماني الأقصى</span>
                  <span className="text-lg font-bold text-slate-800 font-num mt-1">
                    {formatCurrency(selectedCustomer.credit_limit, settings.currency)}
                  </span>
                </div>

                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex flex-col">
                  <span className="text-[11px] text-emerald-700 font-semibold">المتبقي من سقف الائتمان</span>
                  <span className="text-lg font-bold text-emerald-800 font-num mt-1">
                    {formatCurrency(
                      Math.max(0, selectedCustomer.credit_limit - selectedCustomer.balance),
                      settings.currency
                    )}
                  </span>
                </div>
              </div>

              {/* Transactions Tab (Credit Sales & Payments) */}
              <div className="flex flex-col gap-3 pt-2">
                <h3 className="font-bold text-sm text-slate-800 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[18px] text-indigo-600">receipt_long</span>
                  <span>كشف حساب وسجل حركات الدين للعميل</span>
                </h3>

                <div className="flex flex-col gap-2 max-h-[350px] overflow-y-auto">
                  {/* Opening balance, so the movements below reconcile with the card */}
                  {openingBalance !== 0 && (
                    <div className="p-3 rounded-xl bg-slate-100 border border-slate-300 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-slate-300 text-slate-700 flex items-center justify-center shrink-0">
                          <span className="material-symbols-outlined text-[18px]">history</span>
                        </div>
                        <div className="flex flex-col">
                          {/* "رصيد افتتاحي" (opening balance) rather than
                              "دين سابق" (prior debt): this is a derived plug that
                              reconciles the movements to the balance card, and it
                              can legitimately be negative if the stored rows are
                              inconsistent. Calling it a debt would misdescribe it. */}
                          <span className="font-bold text-slate-800">رصيد افتتاحي</span>
                          <span className="text-[10px] text-slate-500">
                            الفرق بين الرصيد المسجل والحركات أدناه
                          </span>
                        </div>
                      </div>
                      <span className="font-bold font-num text-slate-700 text-sm">
                        {formatCurrency(openingBalance, settings.currency)}
                      </span>
                    </div>
                  )}

                  {/* Credit Purchases */}
                  {customerSales.map((sale) => (
                    <div
                      key={sale.id}
                      className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between text-xs"
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
                          <span className="material-symbols-outlined text-[18px]">shopping_cart</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="font-bold text-slate-800">
                            شراء آجل فاتورة #{sale.invoice_no} ({sale.items_count} كمية)
                          </span>
                          <span className="text-[10px] text-slate-400">
                            {formatArabicDate(sale.created_at)}
                          </span>
                        </div>
                      </div>
                      <span className="font-bold font-num text-rose-700 text-sm">
                        +{formatCurrency(sale.total_amount, settings.currency)}
                      </span>
                    </div>
                  ))}

                  {/* Payments */}
                  {customerLedgerPayments.map((pay) => (
                    <div
                      key={pay.id}
                      className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200/80 flex items-center justify-between text-xs"
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                          <span className="material-symbols-outlined text-[18px]">price_check</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="font-bold text-emerald-900">سند قبض دفعة دين</span>
                          <span className="text-[10px] text-slate-400">
                            {formatArabicDate(pay.created_at)} {pay.note ? `• ${pay.note}` : ''}
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-col items-end">
                        <span className="font-bold font-num text-emerald-700 text-sm">
                          -{formatCurrency(pay.amount, settings.currency)}
                        </span>
                        <span className="text-[10px] text-slate-400 font-num">
                          الرصيد بعد السداد: {pay.new_balance.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  ))}

                  {customerSales.length === 0 && customerLedgerPayments.length === 0 && (
                    <div className="py-8 text-center text-slate-400 text-xs">
                      لا توجد فواتير آجل أو دفعات مسجلة لهذا العميل بعد
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-400">
              اختر عميلاً من القائمة لعرض كشف حسابه
            </div>
          )}
        </div>
      </div>

      {/* Record Payment Modal */}
      {showPaymentModal && selectedCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="font-bold text-sm text-slate-800 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[20px] text-emerald-600">payments</span>
                <span>تسجيل دفعة سداد دين</span>
              </h3>
              <button onClick={() => setShowPaymentModal(false)} className="text-slate-400 hover:text-slate-600">
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            {payError && (
              <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-bold">
                {payError}
              </div>
            )}

            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 flex flex-col gap-1 text-xs">
              <div className="flex justify-between text-slate-500">
                <span>اسم الزبون:</span>
                <span className="font-bold text-slate-800">{selectedCustomer.name}</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>إجمالي الدين الحالي:</span>
                <span className="font-bold text-rose-700 font-num">
                  {formatCurrency(selectedCustomer.balance, settings.currency)}
                </span>
              </div>
            </div>

            <form onSubmit={handleRecordPayment} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label htmlFor="debt-payment-amount" className="text-xs font-bold text-slate-700">المبلغ المقبوض *</label>
                <div className="relative">
                  <input
                    id="debt-payment-amount"
                    type="number"
                    step="0.01"
                    min="0.5"
                    max={selectedCustomer.balance}
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm font-bold text-left focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 pl-8"
                    dir="ltr"
                    required
                    autoFocus
                  />
                  <span className="absolute left-2.5 top-2.5 text-xs font-bold text-slate-400">
                    {settings.currency}
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor="f-1" className="text-xs font-bold text-slate-700">ملاحظة أو سند (اختياري)</label>
                <input
                  id="f-1"
                  type="text"
                  value={payNote}
                  onChange={(e) => setPayNote(e.target.value)}
                  placeholder="سداد نقدي نقداً / حوالة..."
                  className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs focus:bg-white"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowPaymentModal(false)}
                  className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-sm"
                >
                  تأكيد وقبض السداد
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Customer Modal */}
      {showAddCustomerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="font-bold text-sm text-slate-800 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[20px] text-indigo-600">person_add</span>
                <span>فتح دفتر ديون لزبون جديد</span>
              </h3>
              <button
                onClick={() => setShowAddCustomerModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            {custError && (
              <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-bold">
                {custError}
              </div>
            )}

            <form onSubmit={handleCreateCustomer} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label htmlFor="f-2" className="text-xs font-bold text-slate-700">الاسم الثلاثي أو اللقب المعروف *</label>
                <input
                  id="f-2"
                  type="text"
                  value={newCustName}
                  onChange={(e) => setNewCustName(e.target.value)}
                  placeholder="مثال: خالد الفرجاني (المقاول)"
                  className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  required
                  autoFocus
                />
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor="f-3" className="text-xs font-bold text-slate-700">رقم الهاتف</label>
                <input
                  id="f-3"
                  type="text"
                  value={newCustPhone}
                  onChange={(e) => setNewCustPhone(e.target.value)}
                  placeholder="091xxxxxxx"
                  className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-left focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  dir="ltr"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label htmlFor="f-4" className="text-xs font-bold text-slate-700">سقف الائتمان</label>
                  <input
                    id="f-4"
                    type="number" step="0.01"
                    value={newCustLimit}
                    onChange={(e) => setNewCustLimit(e.target.value)}
                    className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-left"
                    dir="ltr"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="f-5" className="text-xs font-bold text-slate-700">دين سابق افتتاحي</label>
                  <input
                    id="f-5"
                    type="number" step="0.01"
                    value={newCustInitial}
                    onChange={(e) => setNewCustInitial(e.target.value)}
                    className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-left"
                    dir="ltr"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor="f-6" className="text-xs font-bold text-slate-700">ملاحظات العميل</label>
                <input
                  id="f-6"
                  type="text"
                  value={newCustNotes}
                  onChange={(e) => setNewCustNotes(e.target.value)}
                  placeholder="مكان السكن أو طبيعة العمل..."
                  className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs focus:bg-white"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddCustomerModal(false)}
                  className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-sm"
                >
                  حفظ وتأكيد
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
