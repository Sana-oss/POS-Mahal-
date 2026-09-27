import { useSyncExternalStore } from 'react';
import { cartStore } from '../lib/cartStore';
import { CartItem } from '../types';

export type CartUpdater = CartItem[] | ((previous: CartItem[]) => CartItem[]);

/**
 * React binding for the in-memory cart store (see lib/cartStore.ts).
 * The cart survives tab switches because it lives in the module rather than in
 * POSView's component state.
 */
export function useCart(): [CartItem[], (update: CartUpdater) => void] {
  const cart = useSyncExternalStore(
    cartStore.subscribe,
    cartStore.getSnapshot,
    cartStore.getSnapshot
  );

  return [cart, cartStore.setCart];
}
