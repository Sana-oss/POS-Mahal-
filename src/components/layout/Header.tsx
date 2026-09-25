import React from 'react';
import { useStore } from '../../hooks/useStore';
import { PWAInstallButton } from '../pwa/PWAInstallButton';

interface HeaderProps {
  onOpenScanner: () => void;
  onNavigate: (tab: string) => void;
  currentTab: string;
}

export const Header: React.FC<HeaderProps> = ({ onOpenScanner, onNavigate }) => {
  const { state, session } = useStore();
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

        {/* Sync status */}
        <div className="hidden md:flex flex-col text-left pl-2">
          <span className="text-[11px] text-slate-400 leading-none">حالة النظام</span>
          <span className="text-xs font-semibold text-teal-600 flex items-center gap-1 mt-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-pulse"></span>
            جاهز ومحفوظ
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

        {/* User Profile */}
        <div
          onClick={() => onNavigate('settings')}
          className="flex items-center gap-2 p-1 pl-2 rounded-xl hover:bg-slate-100 cursor-pointer transition select-none"
          title="إعدادات الحساب والمتجر"
        >
          <div className="w-8 h-8 rounded-full bg-teal-600 text-white flex items-center justify-center font-bold text-xs shadow-xs ring-2 ring-teal-100">
            {session?.name ? session.name.charAt(0) : 'م'}
          </div>
          <div className="hidden sm:flex flex-col text-right">
            <span className="text-xs font-bold text-slate-800 leading-none">{session?.name || 'أبو أحمد'}</span>
            <span className="text-[10px] text-slate-400 mt-0.5">مدير المتجر</span>
          </div>
        </div>
      </div>
    </header>
  );
};
