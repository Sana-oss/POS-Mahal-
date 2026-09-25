import { useEffect, useState } from 'react';
import { DatabaseState, store } from '../lib/store';
import { UserSession } from '../types';

export function useStore() {
  const [state, setState] = useState<DatabaseState>(store.getState());
  const [session, setSession] = useState<UserSession | null>(store.getSession());

  useEffect(() => {
    const unsubscribe = store.subscribe(() => {
      setState({ ...store.getState() });
      setSession(store.getSession());
    });
    return unsubscribe;
  }, []);

  return {
    state,
    session,
    setSession: (s: UserSession | null) => store.setSession(s),
    addProduct: (p: Parameters<typeof store.addProduct>[0]) => store.addProduct(p),
    updateProduct: (id: string, updates: Parameters<typeof store.updateProduct>[1]) => store.updateProduct(id, updates),
    deleteProduct: (id: string) => store.deleteProduct(id),
    executeSale: (p: Parameters<typeof store.executeSale>[0]) => store.executeSale(p),
    executePurchase: (p: Parameters<typeof store.executePurchase>[0]) => store.executePurchase(p),
    addCustomer: (p: Parameters<typeof store.addCustomer>[0]) => store.addCustomer(p),
    recordDebtPayment: (p: Parameters<typeof store.recordDebtPayment>[0]) => store.recordDebtPayment(p),
    addExpense: (p: Parameters<typeof store.addExpense>[0]) => store.addExpense(p),
    deleteExpense: (id: string) => store.deleteExpense(id),
    updateSettings: (s: Parameters<typeof store.updateSettings>[0]) => store.updateSettings(s),
    resetToDefault: () => store.resetToDefault(),
    getProductByBarcode: (b: string) => store.getProductByBarcode(b),
    getProductById: (id: string) => store.getProductById(id),
  };
}
