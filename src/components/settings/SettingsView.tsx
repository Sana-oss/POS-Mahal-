import React, { useState } from 'react';
import {
  BACKUP_ROW_LIMIT,
  fetchFullSnapshot,
  isBackupTruncated,
  type BackupRowCounts,
} from '../../services/cloudSync';
import { getBoundShopId, isCloudActive } from '../../lib/dataSource';
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
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError(null);

    try {
      setIsSaving(true);
      await updateSettings({
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
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  };

  /**
   * Download a JSON snapshot of the shop.
   *
   * In cloud mode this re-reads from Postgres with the history caps lifted
   * rather than serialising the render cache. The cache is deliberately capped
   * (400 sales, 200 purchases) to keep the POS responsive, so exporting it would
   * have produced a file labelled "complete" that silently omitted the shop's
   * older history.
   */
  const handleExportBackup = async () => {
    setSaveError(null);
    setSavedSuccess(false);
    setIsExporting(true);

    try {
      let snapshot: typeof state;
      let truncated = false;
      let counts: BackupRowCounts | null = null;

      if (isCloudActive()) {
        const shopId = getBoundShopId();
        if (!shopId) throw new Error('تعذر تحديد المتجر. أعد تحميل الصفحة ثم حاول مجدداً.');
        snapshot = await fetchFullSnapshot(shopId, state.settings);
        counts = {
          products: snapshot.products.length,
          sales: snapshot.sales.length,
          purchases: snapshot.purchases.length,
          customers: snapshot.customers.length,
          customerPayments: snapshot.customerPayments.length,
          stockMovements: snapshot.stockMovements.length,
          expenses: snapshot.expenses.length,
        };
        truncated = isBackupTruncated(counts);
      } else {
        snapshot = state;
      }

      const payload = {
        ...snapshot,
        // Recorded so a future restore knows what this file is and when it was
        // taken, rather than having to infer it from the rows.
        __backup: {
          app: 'Mahall POS',
          version: 1,
          exported_at: new Date().toISOString(),
          mode: isCloudActive() ? 'cloud' : 'local',
          shop_name: snapshot.settings.shop_name,
          counts,
          truncated,
        },
      };

      const dataStr =
        'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(payload, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute('href', dataStr);
      downloadAnchor.setAttribute(
        'download',
        `mahall_pos_backup_${new Date().toISOString().slice(0, 10)}.json`
      );
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();

      if (truncated) {
        setSaveError(
          `تم تنزيل النسخة، لكن أحد جداول البيانات تجاوز الحد الأقصى (${BACKUP_ROW_LIMIT.toLocaleString('en-US')} صف). قد لا تكون النسخة كاملة.`
        );
      } else {
        setSavedSuccess(true);
        setTimeout(() => setSavedSuccess(false), 4000);
      }
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsExporting(false);
    }
  };

  const handleImportBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSaveError(null);
    setSavedSuccess(false);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        if (parsed.products && parsed.sales) {
          localStorage.setItem('mahall_pos_database_v1', JSON.stringify(parsed));
          window.location.reload();
        } else {
          // Inline, not alert(): a native dialog cannot be styled and is
          // blocked in some PWA contexts.
          setSaveError('ملف النسخة الاحتياطية غير صالح.');
        }
      } catch {
        setSaveError('حدث خطأ أثناء قراءة ملف النسخة الاحتياطية.');
      }
    };
    reader.readAsText(file);
  };

  const handleResetData = () => {
    // Destructive: replaces every product, debt and sale with the demo seed.
    // The confirmation is a real dialog rather than a native confirm().
    setResetOpen(true);
  };

  const confirmResetData = () => {
    try {
      resetToDefault();
      window.location.reload();
    } catch (err: unknown) {
      // Cloud mode keeps the real shop data; the demo reset is local-only.
      setResetOpen(false);
      setSaveError(err instanceof Error ? err.message : String(err));
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

      {/* role=alert / role=status: these appear asynchronously in response to a
          user action, so a screen reader only announces them if they are live
          regions. Plain divs were silently dropped. */}
      {saveError && (
        <div
          role="alert"
          className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-bold flex items-center gap-2"
        >
          <span className="material-symbols-outlined text-[18px]">error</span>
          <span>{saveError}</span>
        </div>
      )}

      {savedSuccess && (
        <div
          role="status"
          className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs font-bold flex items-center gap-2"
        >
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
            <label htmlFor="f-1" className="text-xs font-bold text-slate-700">اسم المحل / البقالة *</label>
            <input
              id="f-1"
              type="text"
              value={shopName}
              onChange={(e) => setShopName(e.target.value)}
              className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
              required
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="f-2" className="text-xs font-bold text-slate-700">اسم الفرع</label>
            <input
              id="f-2"
              type="text"
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs focus:bg-white"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="f-3" className="text-xs font-bold text-slate-700">اسم صاحب المتجر / المدير</label>
            <input
              id="f-3"
              type="text"
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs focus:bg-white"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="f-4" className="text-xs font-bold text-slate-700">رمز العملة (يظهر في الفواتير)</label>
            <input
              id="f-4"
              type="text"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs focus:bg-white"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="f-5" className="text-xs font-bold text-slate-700">رقم هاتف المحل</label>
            <input
              id="f-5"
              type="text"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-left focus:bg-white"
              dir="ltr"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="f-6" className="text-xs font-bold text-slate-700">عنوان المتجر</label>
            <input
              id="f-6"
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs focus:bg-white"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1 pt-2">
          <label htmlFor="f-7" className="text-xs font-bold text-slate-700">رسالة تذييل الفاتورة الحرارية (أسفل الإيصال)</label>
          <textarea
            id="f-7"
            value={receiptFooter}
            onChange={(e) => setReceiptFooter(e.target.value)}
            rows={2}
            className="bg-slate-50 border border-slate-300 rounded-xl p-3 text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={isSaving}
            className="px-6 py-2.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white rounded-xl text-xs font-bold shadow-md shadow-teal-600/20 transition active:scale-95"
          >
            {isSaving ? 'جاري الحفظ في السحابة...' : 'حفظ إعدادات المتجر'}
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
                {isCloudActive()
                  ? 'يتم تنزيل نسخة كاملة من قاعدة بيانات متجرك مباشرة، بدون حدود على عدد الفواتير أو الحركات.'
                  : 'تنزيل ملف JSON يحتوي على كامل المنتجات، المخزون، سجل المبيعات، والديون لحفظها بأمان على هاتفك أو حاسوبك.'}
              </p>
            </div>
            <button
              onClick={handleExportBackup}
              disabled={isExporting}
              className="py-2.5 px-3 bg-white hover:bg-slate-100 border border-slate-300 rounded-xl text-xs font-bold text-slate-700 flex items-center justify-center gap-1.5 shadow-2xs transition disabled:opacity-60 disabled:cursor-not-allowed"
              type="button"
            >
              <span className="material-symbols-outlined text-[18px] text-teal-600">
                {isExporting ? 'hourglass_top' : 'download'}
              </span>
              <span>{isExporting ? 'جارٍ تجهيز النسخة...' : 'تحميل نسخة احتياطية (JSON)'}</span>
            </button>
          </div>

          {/* Restore is deliberately unavailable in cloud mode.
              handleImportBackup writes to localStorage and reloads, but in cloud
              mode bootstrapFromCloud immediately replaces the cache from Postgres,
              so the file was discarded while the UI implied it had been restored.
              The demo reset below is already blocked in cloud mode for the same
              reason; these two controls are now consistent. */}
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 flex flex-col justify-between gap-3">
            <div className="flex flex-col">
              <span className="text-xs font-bold text-slate-800">استعادة بيانات من نسخة سابقة</span>
              <p className="text-[11px] text-slate-500 mt-1">
                {isCloudActive()
                  ? 'غير متاح في وضع السحابة. بيانات متجرك محفوظة في قاعدة البيانات، واستعادة نسخة قد تمسح سجلات حقيقية. النسخ الاحتياطي متاح للتصدير فقط.'
                  : 'رفع ملف JSON تم تنزيله سابقاً لاستعادة قاعدة بيانات المتجر بالكامل.'}
              </p>
            </div>
            {isCloudActive() ? (
              <div className="py-2.5 px-3 bg-slate-100 border border-slate-200 rounded-xl text-xs font-bold text-slate-400 flex items-center justify-center gap-1.5 select-none">
                <span className="material-symbols-outlined text-[18px]">lock</span>
                <span>غير متاح في وضع السحابة</span>
              </div>
            ) : (
              <label className="py-2.5 px-3 bg-white hover:bg-slate-100 border border-slate-300 rounded-xl text-xs font-bold text-slate-700 flex items-center justify-center gap-1.5 shadow-2xs transition cursor-pointer">
                <span className="material-symbols-outlined text-[18px] text-indigo-600">upload_file</span>
                <span>اختيار ملف النسخة الاحتياطية</span>
                <input type="file" accept=".json" onChange={handleImportBackup} className="hidden" />
              </label>
            )}
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

      {/* Destructive reset confirmation */}
      {resetOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden flex flex-col">
            <div className="px-5 py-4 flex items-center gap-3 border-b border-slate-100">
              <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[20px]">warning</span>
              </div>
              <h3 className="font-bold text-sm text-slate-800">استعادة البيانات النموذجية</h3>
            </div>

            <div className="px-5 py-4">
              <p className="text-xs text-slate-600 leading-6">
                سيتم استبدال جميع المنتجات والديون وحركات البيع ببيانات نموذجية تجريبية.
                لا يمكن التراجع عن هذا الإجراء.
              </p>
            </div>

            <div className="px-5 py-3.5 bg-slate-50 flex gap-2">
              <button
                type="button"
                onClick={() => setResetOpen(false)}
                className="flex-1 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-700 text-xs font-bold hover:bg-slate-100"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={confirmResetData}
                className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-sm"
              >
                تأكيد الاستعادة
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
