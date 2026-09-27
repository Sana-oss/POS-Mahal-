import React, { useEffect } from 'react';
import { formatArabicDate, formatCurrency } from '../../lib/calculations';
import { Sale, Settings } from '../../types';

interface ThermalReceiptModalProps {
  sale: Sale | null;
  settings: Settings;
  onClose: () => void;
}

export const ThermalReceiptModal: React.FC<ThermalReceiptModalProps> = ({
  sale,
  settings,
  onClose,
}) => {
  // F9 shortcut prints the receipt currently on screen, matching the
  // "طباعة الإيصال (F9)" hint on the button. Declared before the early return so
  // the hook order stays stable across renders.
  useEffect(() => {
    if (!sale) return;

    const handlePrintShortcut = (event: KeyboardEvent) => {
      if (event.key === 'F9') {
        event.preventDefault();
        window.print();
      }
    };

    window.addEventListener('keydown', handlePrintShortcut);
    return () => window.removeEventListener('keydown', handlePrintShortcut);
  }, [sale]);

  if (!sale) return null;

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Controls Top Bar */}
        <div className="bg-slate-900 text-white px-4 py-3 flex items-center justify-between no-print">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-teal-400 text-[20px]">receipt_long</span>
            <span className="font-bold text-sm">إيصال الفاتورة #{sale.invoice_no}</span>
          </div>
          <button
            onClick={onClose}
            // Icon-only control: without a label a screen reader announces
            // nothing at all, leaving no way to dismiss the receipt. Distinct
            // from the footer's "إغلاق" so the two are not conflated.
            aria-label="إغلاق الإيصال"
            className="w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center text-slate-300 hover:text-white"
            type="button"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        {/* Printable Receipt Preview (80mm styling) */}
        <div className="p-4 overflow-y-auto bg-slate-50 flex justify-center">
          <div
            id="printable-receipt"
            className="bg-white p-5 rounded-lg border border-slate-200/80 shadow-xs w-full max-w-[320px] text-slate-900 font-mono text-xs select-text"
          >
            {/* Store Header */}
            <div className="text-center pb-3 border-b border-dashed border-slate-300">
              <h2 className="text-base font-bold font-sans text-slate-900">{settings.shop_name}</h2>
              <p className="text-[11px] text-slate-600 mt-0.5">{settings.branch_name}</p>
              {settings.address && <p className="text-[10px] text-slate-500 mt-0.5">{settings.address}</p>}
              {settings.phone && <p className="text-[10px] text-slate-500" dir="ltr">هاتف: {settings.phone}</p>}
              <div className="mt-2 text-[10px] bg-slate-100 py-1 rounded">
                {/*
                  A plain sales invoice, deliberately. The header used to read
                  "فاتورة مبيعات نقدية / ضريبية مبسطة" (simplified tax invoice),
                  but `tax_rate` is never applied to any total and is not even
                  editable in Settings, so the slip claimed to be a tax document
                  while showing no tax line at all. Reinstating the tax wording
                  means computing tax end to end (settings field -> sale total ->
                  receipt -> invoice numbering), which is a decision about what a
                  shop is required to charge, not a labelling tweak.
                */}
                فاتورة مبيعات
              </div>
            </div>

            {/* Invoice Meta */}
            <div className="py-2.5 border-b border-dashed border-slate-300 text-[11px] space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-500">رقم الفاتورة:</span>
                <span className="font-bold">{sale.invoice_no}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">التاريخ:</span>
                <span>{formatArabicDate(sale.created_at)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">طريقة الدفع:</span>
                <span className="font-bold">
                  {sale.payment_method === 'cash' ? 'نقدي (كاش)' : `آجل (دين: ${sale.customer_name})`}
                </span>
              </div>
              {sale.customer_name && (
                <div className="flex justify-between">
                  <span className="text-slate-500">العميل:</span>
                  <span className="font-bold">{sale.customer_name}</span>
                </div>
              )}
            </div>

            {/* Line Items Table */}
            <div className="py-2.5 border-b border-dashed border-slate-300">
              <div className="flex justify-between text-[10px] text-slate-500 pb-1 font-bold">
                <span className="w-1/2">الصنف</span>
                <span className="w-1/6 text-center">الكمية</span>
                <span className="w-1/6 text-center">السعر</span>
                <span className="w-1/6 text-left">الإجمالي</span>
              </div>
              <div className="divide-y divide-dotted divide-slate-200">
                {sale.items.map((item) => (
                  <div key={item.id} className="py-1.5 flex justify-between items-center text-[11px]">
                    <div className="w-1/2 truncate font-sans font-medium" title={item.product_name}>
                      {item.product_name}
                    </div>
                    <div className="w-1/6 text-center">{item.quantity}</div>
                    <div className="w-1/6 text-center font-num">{item.unit_price.toFixed(2)}</div>
                    <div className="w-1/6 text-left font-bold font-num">{item.total_price.toFixed(2)}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Totals */}
            <div className="py-2.5 border-b border-dashed border-slate-300 space-y-1.5 text-xs">
              <div className="flex justify-between text-slate-600">
                {/* "كمية" (quantity), not "قطعة" (pieces): the count is the exact
                    sum of line quantities and is fractional for weighed goods,
                    so 2.5 kg would otherwise be printed as "2.5 pieces". */}
                <span>الكمية الإجمالية:</span>
                <span className="font-num">{sale.items_count} كمية</span>
              </div>
              <div className="flex justify-between text-base font-bold text-slate-900 pt-1 border-t border-slate-200">
                <span>صافي الفاتورة:</span>
                <span className="font-num text-teal-700">{formatCurrency(sale.total_amount, settings.currency)}</span>
              </div>

              {sale.payment_method === 'cash' && sale.received_amount !== undefined && (
                <>
                  <div className="flex justify-between text-[11px] text-slate-600">
                    <span>المبلغ المستلم:</span>
                    <span className="font-num">{formatCurrency(sale.received_amount, settings.currency)}</span>
                  </div>
                  <div className="flex justify-between text-[11px] font-bold text-slate-800">
                    <span>المبلغ المتبقي (الفكة):</span>
                    <span className="font-num">{formatCurrency(sale.change_amount || 0, settings.currency)}</span>
                  </div>
                </>
              )}
            </div>

            {/* Simulated Barcode */}
            <div className="pt-3 text-center flex flex-col items-center">
              <div className="flex gap-[2px] h-9 items-center justify-center w-44 bg-slate-900/10 px-2 py-1 rounded">
                <span className="w-1 h-full bg-slate-900"></span>
                <span className="w-0.5 h-full bg-transparent"></span>
                <span className="w-2 h-full bg-slate-900"></span>
                <span className="w-0.5 h-full bg-slate-900"></span>
                <span className="w-1.5 h-full bg-slate-900"></span>
                <span className="w-1 h-full bg-slate-900"></span>
                <span className="w-2 h-full bg-slate-900"></span>
                <span className="w-0.5 h-full bg-slate-900"></span>
                <span className="w-1 h-full bg-slate-900"></span>
                <span className="w-2.5 h-full bg-slate-900"></span>
                <span className="w-1 h-full bg-slate-900"></span>
                <span className="w-0.5 h-full bg-slate-900"></span>
                <span className="w-2 h-full bg-slate-900"></span>
                <span className="w-1 h-full bg-slate-900"></span>
              </div>
              <span className="text-[10px] text-slate-500 font-mono tracking-widest mt-1">*{sale.invoice_no}*</span>
            </div>

            {/* Footer Message */}
            <div className="mt-3 text-center text-[10px] text-slate-500 font-sans leading-relaxed border-t border-slate-100 pt-2">
              <p>{settings.receipt_footer}</p>
            </div>
          </div>
        </div>

        {/* Modal Action Buttons */}
        <div className="p-4 bg-white border-t border-slate-200 flex gap-2 no-print">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-bold transition"
            type="button"
          >
            إغلاق
          </button>
          <button
            onClick={handlePrint}
            className="flex-2 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-md transition active:scale-95"
            type="button"
          >
            <span className="material-symbols-outlined text-[18px]">print</span>
            <span>طباعة الإيصال (F9)</span>
          </button>
        </div>
      </div>
    </div>
  );
};
