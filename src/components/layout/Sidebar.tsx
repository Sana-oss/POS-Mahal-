import React from 'react';
import { useStore } from '../../hooks/useStore';

interface SidebarProps {
  currentTab: string;
  onNavigate: (tab: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ currentTab, onNavigate }) => {
  const { session } = useStore();

  const navItems = [
    { id: 'dashboard', label: 'الرئيسية', icon: 'storefront' },
    { id: 'inventory', label: 'المخزون', icon: 'inventory_2' },
    { id: 'purchases', label: 'المشتريات', icon: 'shopping_bag' },
    { id: 'debts', label: 'الديون والعملاء', icon: 'group' },
    { id: 'expenses', label: 'المصروفات', icon: 'payments' },
    { id: 'reports', label: 'التقارير والأرباح', icon: 'insights' },
    { id: 'settings', label: 'الإعدادات', icon: 'settings' },
  ];

  return (
    <aside className="fixed right-0 top-0 h-full w-64 bg-white border-l border-slate-200/80 shadow-xs z-40 hidden lg:flex flex-col justify-between select-none">
      <div className="flex flex-col">
        {/* Brand header */}
        <div className="h-16 px-4 flex items-center justify-between border-b border-slate-100 bg-slate-50/70">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-teal-600 flex items-center justify-center text-white font-bold text-xl shadow-sm">
              م
            </div>
            <div className="flex flex-col">
              <span className="font-bold text-teal-900 text-base leading-tight">محل POS</span>
              <span className="text-[11px] text-slate-400">بقالة وتجزئة</span>
            </div>
          </div>
          <div className="flex items-center gap-1 px-2 py-0.5 bg-teal-50 text-teal-700 border border-teal-200/60 rounded-full text-[11px] font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-pulse"></span>
            متصل
          </div>
        </div>

        {/* Primary POS Action Button */}
        <div className="p-3">
          <button
            onClick={() => onNavigate('pos')}
            className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl shadow-md font-bold text-sm transition-all active:scale-98 ${
              currentTab === 'pos'
                ? 'bg-teal-600 text-white shadow-teal-600/25 ring-2 ring-teal-400/50'
                : 'bg-teal-600 hover:bg-teal-700 text-white shadow-teal-700/20'
            }`}
            type="button"
          >
            <span className="material-symbols-outlined text-[22px]">point_of_sale</span>
            <span>نقطة البيع (F1)</span>
          </button>
        </div>

        {/* Navigation Links */}
        <nav className="flex flex-col gap-1 px-3 mt-1">
          {navItems.map((item) => {
            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl font-semibold text-sm transition-colors text-right ${
                  isActive
                    ? 'bg-teal-50 text-teal-800 font-bold border border-teal-100/80 shadow-2xs'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
                type="button"
              >
                <span
                  className={`material-symbols-outlined text-[20px] ${
                    isActive ? 'text-teal-600' : 'text-slate-400'
                  }`}
                >
                  {item.icon}
                </span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Bottom Shift / Cashier Box */}
      <div className="p-3 m-3 bg-slate-50 border border-slate-200/70 rounded-2xl flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-sm">
            {session?.name ? session.name.charAt(0) : 'س'}
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-bold text-slate-800 truncate">الوردية الصباحية</span>
            <span className="text-[10px] text-slate-400">منذ 07:00 ص</span>
          </div>
        </div>
        <button
          onClick={() => onNavigate('settings')}
          className="p-1.5 text-slate-400 hover:text-teal-600 hover:bg-white rounded-lg transition"
          title="قفل أو تغيير الوردية"
          type="button"
        >
          <span className="material-symbols-outlined text-[18px]">lock_clock</span>
        </button>
      </div>
    </aside>
  );
};
