/**
 * Mahall POS - In-Memory Cart Store
 *
 * The in-progress sale deliberately lives outside the React tree: POSView is
 * unmounted whenever the cashier switches tabs, so holding the cart in local
 * component state silently discards a half-finished sale.
 *
 * It is intentionally NOT persisted to localStorage - a stale cart must never be
 * restored after a page reload.
 */

import { CartItem } from '../types';

type Listener = () => void;

let cart: CartItem[] = [];
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((listener) => listener());
}

export const cartStore = {
  subscribe(listener: Listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  /** Stable snapshot: returns the same array reference until the cart changes. */
  getSnapshot(): CartItem[] {
    return cart;
  },

  /** Accepts a new array or a functional updater, mirroring a useState setter. */
  setCart(update: CartItem[] | ((previous: CartItem[]) => CartItem[])) {
    const next = typeof update === 'function' ? update(cart) : update;
    if (next === cart) return;
    cart = next;
    emit();
  },

  /**
   * Drops the in-progress sale.
   *
   * Called on sign-out / shop switch. A cart line holds a frozen snapshot of a
   * product (price, cost, stock), so a cart built for one shop must never
   * survive into another: the next cashier would be checking out the previous
   * shop's quantities against their own stock, and in local-only mode nothing
   * downstream would catch it.
   *
   * No-ops when already empty so it cannot trigger a pointless re-render.
   */
  clear() {
    if (cart.length === 0) return;
    cart = [];
    emit();
  },
};
