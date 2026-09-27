import React from 'react';
import { Cloud, Loader2 } from 'lucide-react';
import { useStore } from '../../hooks/useStore';
import { useSyncStatus } from '../../hooks/useSyncStatus';
import { PWAInstallButton } from '../pwa/PWAInstallButton';
import { useAuth } from '../auth/AuthProvider';

interface HeaderProps {
  onOpenScanner: () => void;
  onNavigate: (tab: string) => void;
  currentTab: string;
}

export const Header: React.FC<HeaderProps> = ({ onOpenScanner, onNavigate }) => {
  const { state } = useStore();
  const { profile, mode } = useAuth();
  const sync = useSyncStatus();
  const settings = state.settings;

  return (
    <header className="fixed top-0 right-0 left-0 lg:right-64 h-16 bg-white/95 backdrop-blur-md border-b border-slate-200/80 z-30 flex items-center justify-between px-4 sm:px-6 transition-all">
      {/* Right side: Shop name & quick barcode */}
      <div className="flex items-center gap-3 sm:gap-4">
        {/* Mobile brand badge */}
        <div className="flex items-center gap-2 lg:hidden">
          <div className="w-9 h-9 rounded-xl bg-teal-600 flex items-center justify-center text-white font-bold text-lg shadow-sm">
            م
          </div>
          <span className="font-bold text-teal-800 text-lg">محل POS</span>
        </div>

        {/* Desktop Shop & Branch identifier */}
        <div className="hidden sm:flex items-center gap-2 text-slate-600 text-sm bg-slate-100/90 px-3 py-1.5 rounded-xl border border-slate-200/60">
          <span className="material-symbols-outlined text-[18px] text-teal-600">store</span>
          <span className="font-bold text-slate-800">{settings.shop_name}</span>
          <span className="text-slate-400">•</span>
          <span className="text-slate-500 text-xs">{settings.branch_name}</span>
        </div>

        {/* Cloud sync indicator: tells the cashier the register is writing to the DB.
            Three states, not two. A failed write leaves `pending` back at 0 while
            `state` is 'error', so branching on `pending` alone showed the reassuring
            "synced" badge immediately after a write that had been rejected. */}
        {mode === 'cloud' && (
          <div
            className={`hidden md:flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-xl border text-slate-500 ${
              sync.state === 'error'
                ? 'border-rose-200 bg-rose-50 text-rose-700'
                : 'border-slate-200/60 bg-slate-50'
            }`}
            role="status"
            title={sync.error ?? undefined}
          >
            {sync.pending > 0 ? (
              <>
                <Loader2 size={13} className="animate-spin" />
                <span>جاري الحفظ في السحابة...</span>
              </>
            ) : sync.state === 'error' ? (
              <>
                <Cloud size={13} className="text-rose-600" />
                <span>تعذر الحفظ في السحابة</span>
              </>
            ) : (
              <>
                <Cloud size={13} className="text-teal-600" />
                <span>متزامن مع السحابة</span>
              </>
            )}
          </div>
        )}

        {/* Quick Barcode Scanner button */}
        <button
          onClick={onOpenScanner}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-50 hover:bg-teal-100 text-teal-800 border border-teal-200/80 rounded-xl transition text-xs sm:text-sm font-semibold active:scale-95 shadow-2xs"
          type="button"
          title="مسح باركود بالكاميرا (F2)"
        >
          <span className="material-symbols-outlined text-[20px] text-teal-600">barcode_scanner</span>
          <span>مسح باركود <kbd className="hidden md:inline px-1 py-0.5 bg-teal-200/60 rounded text-[10px] font-mono">F2</kbd></span>
        </button>
      </div>

      {/* Left side: Sync status, PWA install, notifications, User avatar */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Install PWA button */}
        <PWAInstallButton className="hidden sm:flex" />

        {/* Storage status: cloud account vs. local-only */}
        <div className="hidden md:flex flex-col text-left pl-2">
          <span className="text-[11px] text-slate-400 leading-none">حالة النظام</span>
          <span
            className={`text-xs font-semibold flex items-center gap-1 mt-0.5 ${
              mode === 'cloud' ? 'text-teal-600' : 'text-amber-600'
            }`}
            title={
              mode === 'cloud'
                ? 'متصل بحساب سحابي'
                : 'البيانات محفوظة على هذا الجهاز فقط (وضع محلي)'
            }
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                mode === 'cloud' ? 'bg-teal-500 animate-pulse' : 'bg-amber-500'
              }`}
            ></span>
            {mode === 'cloud' ? 'جاهز ومحفوظ' : 'حفظ محلي'}
          </span>
        </div>

        <div className="h-6 w-px bg-slate-200 mx-1 hidden sm:block"></div>

        {/* Quick link to reports or settings */}
        <button
          onClick={() => onNavigate('reports')}
          className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition"
          title="التقارير والأرباح"
          type="button"
        >
          <span className="material-symbols-outlined text-[20px]">insights</span>
        </button>

        {/* User Profile. A real button, not a clickable div: the div had no role and
            no keyboard handler, so settings were unreachable without a mouse. */}
        <button
          type="button"
          onClick={() => onNavigate('settings')}
          className="flex items-center gap-2 p-1 pl-2 rounded-xl hover:bg-slate-100 transition select-none text-right"
          title="إعدادات الحساب والمتجر"
        >
          <div className="w-8 h-8 rounded-full bg-teal-600 text-white flex items-center justify-center font-bold text-xs shadow-xs ring-2 ring-teal-100">
            {profile?.full_name ? profile.full_name.charAt(0) : 'م'}
          </div>
          <div className="hidden sm:flex flex-col text-right">
            <span className="text-xs font-bold text-slate-800 leading-none">{profile?.full_name || 'المستخدم'}</span>
            <span className="text-[10px] text-slate-400 mt-0.5">{profile?.role === 'owner' ? 'المالك' : 'كاشير'}</span>
          </div>
        </button>
      </div>
    </header>
  );
};
