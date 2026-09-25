import React from 'react';

interface MobileNavProps {
  currentTab: string;
  onNavigate: (tab: string) => void;
  cartCount?: number;
}

export const MobileNav: React.FC<MobileNavProps> = ({ currentTab, onNavigate, cartCount = 0 }) => {
  const tabs = [
    { id: 'pos', label: 'البيع', icon: 'point_of_sale', badge: cartCount > 0 ? cartCount : undefined },
    { id: 'inventory', label: 'المخزون', icon: 'inventory_2' },
    { id: 'dashboard', label: 'الرئيسية', icon: 'storefront' },
    { id: 'debts', label: 'الديون', icon: 'group' },
    { id: 'reports', label: 'التقارير', icon: 'insights' },
    { id: 'settings', label: 'المزيد', icon: 'menu' },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 h-16 bg-white/95 backdrop-blur-md border-t border-slate-200/90 shadow-lg z-40 flex lg:hidden items-center justify-around px-2 select-none safe-bottom">
      {tabs.map((tab) => {
        const isActive = currentTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onNavigate(tab.id)}
            className={`flex flex-col items-center justify-center flex-1 py-1 relative transition-colors ${
              isActive ? 'text-teal-600 font-bold' : 'text-slate-500 hover:text-slate-800'
            }`}
            type="button"
          >
            <div className="relative">
              <span className={`material-symbols-outlined text-[24px] ${isActive ? 'scale-110' : ''}`}>
                {tab.icon}
              </span>
              {tab.badge !== undefined && (
                <span className="absolute -top-1 -right-2 bg-rose-500 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center animate-bounce">
                  {tab.badge}
                </span>
              )}
            </div>
            <span className="text-[10px] mt-0.5 leading-none">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
};
