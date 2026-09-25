import React, { useState } from 'react';
import { useStore } from '../../hooks/useStore';

export const SettingsView: React.FC = () => {
  const { state, updateSettings, resetToDefault } = useStore();
  const settings = state.settings;

  const [shopName, setShopName] = useState(settings.shop_name);
  const [branchName, setBranchName] = useState(settings.branch_name);
  const [ownerName, setOwnerName] = useState(settings.owner_name);
  const [phone, setPhone] = useState(settings.phone);
  const [address, setAddress] = useState(settings.address);
  const [currency, setCurrency] = useState(settings.currency);
  const [receiptFooter, setReceiptFooter] = useState(settings.receipt_footer);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    updateSettings({
      shop_name: shopName.trim() || 'بقالة البركة والخير',
      branch_name: branchName.trim() || 'الفرع الرئيسي',
      owner_name: ownerName.trim() || 'أبو أحمد',
      phone: phone.trim(),
      address: address.trim(),
      currency: currency.trim() || 'د.ل',
      receipt_footer: receiptFooter.trim(),
    });
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  const handleExportBackup = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(state, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute(
      'download',
      `mahall_pos_backup_${new Date().toISOString().slice(0, 10)}.json`
    );
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const handleImportBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        if (parsed.products && parsed.sales) {
          localStorage.setItem('mahall_pos_database_v1', JSON.stringify(parsed));
          window.location.reload();
        } else {
          alert('ملف النسخة الاحتياطية غير صالح.');
        }
      } catch {
        alert('حدث خطأ أثناء قراءة ملف النسخة الاحتياطية.');
      }
    };
    reader.readAsText(file);
  };

  const handleResetData = () => {
    if (
      confirm(
        'هل أنت متأكد من استعادة البيانات النموذجية الأولية؟ سيتم تحديث المنتجات والديون وحركات البيع التجريبية.'
      )
    ) {
      resetToDefault();
      window.location.reload();
    }
  };

  return (
    <div className="flex flex-col gap-5 max-w-4xl mx-auto">
      {/* Top Banner */}
      <div className="flex items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-700 flex items-center justify-center shadow-xs">
            <span className="material-symbols-outlined text-[28px]">settings</span>
          </div>
          <div className="flex flex-col">
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900">إعدادات المحل والنظام</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              تخصيص بيانات المتجر، ترويسة وتذييل الفاتورة، والنسخ الاحتياطي
            </p>
          </div>
        </div>
      </div>

      {savedSuccess && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs font-bold flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]">check_circle</span>
          <span>تم حفظ الإعدادات بنجاح!</span>
        </div>
      )}

      {/* Main Settings Form */}
      <form onSubmit={handleSave} className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-2xs flex flex-col gap-4">
        <h2 className="text-sm font-bold text-slate-800 pb-2 border-b border-slate-100 flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[20px] text-teal-600">store</span>
          <span>بيانات المتجر والفرع</span>
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-slate-700">اسم المحل / البقالة *</label>
            <input
              type="text"
              value={shopName}
              onChange={(e) => setShopName(e.target.value)}
              className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
              required
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-slate-700">اسم الفرع</label>
            <input
              type="text"
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs focus:bg-white"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-slate-700">اسم صاحب المتجر / المدير</label>
            <input
              type="text"
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs focus:bg-white"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-slate-700">رمز العملة (يظهر في الفواتير)</label>
            <input
              type="text"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs focus:bg-white"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-slate-700">رقم هاتف المحل</label>
            <input
              type="text"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-left focus:bg-white"
              dir="ltr"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-slate-700">عنوان المتجر</label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs focus:bg-white"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1 pt-2">
          <label className="text-xs font-bold text-slate-700">رسالة تذييل الفاتورة الحرارية (أسفل الإيصال)</label>
          <textarea
            value={receiptFooter}
            onChange={(e) => setReceiptFooter(e.target.value)}
            rows={2}
            className="bg-slate-50 border border-slate-300 rounded-xl p-3 text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            className="px-6 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold shadow-md shadow-teal-600/20 transition active:scale-95"
          >
            حفظ إعدادات المتجر
          </button>
        </div>
      </form>

      {/* Backup & System Reset Section */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-2xs flex flex-col gap-4">
        <h2 className="text-sm font-bold text-slate-800 pb-2 border-b border-slate-100 flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[20px] text-indigo-600">cloud_sync</span>
          <span>النسخ الاحتياطي وحفظ البيانات</span>
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 flex flex-col justify-between gap-3">
            <div className="flex flex-col">
              <span className="text-xs font-bold text-slate-800">تصدير نسخة احتياطية من البيانات</span>
              <p className="text-[11px] text-slate-500 mt-1">
                تنزيل ملف JSON يحتوي على كامل المنتجات، المخزون، سجل المبيعات، والديون لحفظها بأمان على هاتفك أو حاسوبك.
              </p>
            </div>
            <button
              onClick={handleExportBackup}
              className="py-2.5 px-3 bg-white hover:bg-slate-100 border border-slate-300 rounded-xl text-xs font-bold text-slate-700 flex items-center justify-center gap-1.5 shadow-2xs transition"
              type="button"
            >
              <span className="material-symbols-outlined text-[18px] text-teal-600">download</span>
              <span>تحميل نسخة احتياطية (JSON)</span>
            </button>
          </div>

          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 flex flex-col justify-between gap-3">
            <div className="flex flex-col">
              <span className="text-xs font-bold text-slate-800">استعادة بيانات من نسخة سابقة</span>
              <p className="text-[11px] text-slate-500 mt-1">
                رفع ملف JSON تم تنزيله سابقاً لاستعادة قاعدة بيانات المتجر بالكامل.
              </p>
            </div>
            <label className="py-2.5 px-3 bg-white hover:bg-slate-100 border border-slate-300 rounded-xl text-xs font-bold text-slate-700 flex items-center justify-center gap-1.5 shadow-2xs transition cursor-pointer">
              <span className="material-symbols-outlined text-[18px] text-indigo-600">upload_file</span>
              <span>اختيار ملف النسخة الاحتياطية</span>
              <input type="file" accept=".json" onChange={handleImportBackup} className="hidden" />
            </label>
          </div>
        </div>

        <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
          <span className="text-xs text-slate-400">إعادة تعيين البيانات للوضع الأولي التجريبي:</span>
          <button
            onClick={handleResetData}
            className="px-3 py-1.5 text-rose-700 hover:bg-rose-50 border border-rose-200 rounded-xl text-xs font-bold transition"
            type="button"
          >
            إعادة تعيين البيانات النموذجية
          </button>
        </div>
      </div>
    </div>
  );
};
