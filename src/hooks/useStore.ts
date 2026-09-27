import { useEffect, useState } from 'react';
import { DatabaseState, store } from '../lib/store';
import * as dataSource from '../lib/dataSource';
import { UserSession } from '../types';

/**
 * Every mutation is routed through lib/dataSource, which writes to Supabase in
 * cloud mode and to localStorage in local-only mode. All of them are async, so
 * screens must `await` the returned promise (the local path resolves on the
 * microtask queue, so behaviour is identical offline).
 */
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
    addProduct: (p: Parameters<typeof store.addProduct>[0]) => dataSource.addProduct(p),
    updateProduct: (id: string, updates: Parameters<typeof store.updateProduct>[1]) =>
      dataSource.updateProduct(id, updates),
    deleteProduct: (id: string) => dataSource.deleteProduct(id),
    executeSale: (p: Parameters<typeof store.executeSale>[0]) => dataSource.executeSale(p),
    executePurchase: (p: Parameters<typeof store.executePurchase>[0]) =>
      dataSource.executePurchase(p),
    addCustomer: (p: Parameters<typeof store.addCustomer>[0]) => dataSource.addCustomer(p),
    recordDebtPayment: (p: Parameters<typeof store.recordDebtPayment>[0]) =>
      dataSource.recordDebtPayment(p),
    addExpense: (p: Parameters<typeof store.addExpense>[0]) => dataSource.addExpense(p),
    deleteExpense: (id: string) => dataSource.deleteExpense(id),
    updateSettings: (s: Parameters<typeof store.updateSettings>[0]) => dataSource.updateSettings(s),
    resetToDefault: () => dataSource.resetToDefault(),
    getProductByBarcode: (b: string) => store.getProductByBarcode(b),
    getProductById: (id: string) => store.getProductById(id),
  };
}
