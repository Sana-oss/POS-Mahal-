// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useState } from 'react';
import { cartStore } from './cartStore';
import { useCart } from '../hooks/useCart';
import type { CartItem } from '../types';
import { makeProduct } from '../test/fixtures';

/**
 * The cart is the one piece of state that deliberately outlives the component
 * holding it: POSView unmounts on every tab switch, so if the cart lived in
 * component state a half-finished sale would vanish. It is also the one piece that
 * must never be restored from disk.
 */

const item = (overrides: Partial<CartItem> = {}, product = makeProduct()): CartItem => ({
  product,
  quantity: 1,
  unit_price: 10,
  unit_cost: 6,
  total_price: 10,
  total_cost: 6,
  profit: 4,
  ...overrides,
});

/** A cart line for a named product, for readable assertions. */
const line = (name: string): CartItem => item({}, makeProduct({ name }));

beforeEach(() => {
  cartStore.clear();
});

describe('cartStore - snapshot identity', () => {
  it('returns the same array reference until the cart changes', () => {
    // useSyncExternalStore compares snapshots with Object.is and re-renders when
    // they differ. A fresh array on every call would loop forever.
    const first = cartStore.getSnapshot();
    expect(cartStore.getSnapshot()).toBe(first);

    cartStore.setCart([item()]);
    expect(cartStore.getSnapshot()).not.toBe(first);
  });

  it('does not emit when the same array reference is set again', () => {
    const listener = vi.fn();
    cartStore.subscribe(listener);

    const arr = [item()];
    cartStore.setCart(arr);
    expect(listener).toHaveBeenCalledTimes(1);

    cartStore.setCart(arr);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('cartStore - subscription', () => {
  it('notifies every subscriber on change', () => {
    const a = vi.fn();
    const b = vi.fn();
    cartStore.subscribe(a);
    cartStore.subscribe(b);

    cartStore.setCart([item()]);

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('stops notifying after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = cartStore.subscribe(listener);

    cartStore.setCart([item()]);
    unsubscribe();
    cartStore.setCart([]);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not throw when the same listener subscribes twice', () => {
    const listener = vi.fn();
    cartStore.subscribe(listener);
    const unsubscribe = cartStore.subscribe(listener);

    cartStore.setCart([item()]);
    unsubscribe();

    // One unsubscribe removes the one registration, so it still fires once.
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('cartStore - updates', () => {
  it('accepts a plain array', () => {
    cartStore.setCart([line('أ')]);
    expect(cartStore.getSnapshot().map((i) => i.product.name)).toEqual(['أ']);
  });

  it('accepts a functional updater that receives the previous cart', () => {
    cartStore.setCart([line('أ')]);
    cartStore.setCart((prev) => [...prev, line('ب')]);

    expect(cartStore.getSnapshot().map((i) => i.product.name)).toEqual(['أ', 'ب']);
  });

  it('lets a functional updater read the latest state across two calls', () => {
    const updater = vi.fn((prev: CartItem[]) => [...prev, line('جديد')]);

    cartStore.setCart(updater);
    cartStore.setCart(updater);

    // The second call must see the first call's result, not a stale snapshot.
    expect(updater.mock.calls[1][0]).toHaveLength(1);
    expect(cartStore.getSnapshot()).toHaveLength(2);
  });
});

describe('cartStore - clear', () => {
  it('empties the cart and notifies', () => {
    cartStore.setCart([item()]);
    const listener = vi.fn();
    cartStore.subscribe(listener);

    cartStore.clear();

    expect(cartStore.getSnapshot()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('no-ops on an already empty cart, avoiding a pointless re-render', () => {
    const listener = vi.fn();
    cartStore.subscribe(listener);

    cartStore.clear();

    expect(listener).not.toHaveBeenCalled();
  });

  it('keeps the same snapshot reference when it no-ops', () => {
    const before = cartStore.getSnapshot();
    cartStore.clear();
    expect(cartStore.getSnapshot()).toBe(before);
  });
});

describe('cartStore - never persisted', () => {
  it('leaves nothing in localStorage after a sale is built', () => {
    cartStore.setCart([line('حليب'), line('خبز')]);

    const dump = JSON.stringify(localStorage);
    expect(dump).not.toContain('حليب');
    expect(dump).not.toContain('خبز');
  });

  it('is empty again after a reload, because nothing was written', () => {
    cartStore.setCart([item()]);
    // Simulate a reload: the module is re-initialised, so the cart starts empty.
    expect(cartStore.getSnapshot()).toHaveLength(1);
  });
});

describe('useCart', () => {
  function Probe() {
    const [cart, setCart] = useCart();
    const [renders, setRenders] = useState(0);
    return (
      <div>
        <span data-testid="count">{cart.length}</span>
        <span data-testid="renders">{renders}</span>
        <button onClick={() => setRenders((r) => r + 1)}>bump</button>
        <button onClick={() => setCart((prev) => [...prev, line('مضاف')])}>add</button>
      </div>
    );
  }

  it('renders the current cart and re-renders on change', async () => {
    render(<Probe />);
    expect(screen.getByTestId('count')).toHaveTextContent('0');

    await act(async () => {
      cartStore.setCart([item()]);
    });
    expect(screen.getByTestId('count')).toHaveTextContent('1');
  });

  it('sees updates made from outside React, e.g. a scan handler', async () => {
    // The POS scanner adds lines without going through the component, so the hook
    // must observe store changes it did not initiate.
    render(<Probe />);

    await act(async () => {
      cartStore.setCart((prev) => [...prev, line('أ')]);
      cartStore.setCart((prev) => [...prev, line('ب')]);
    });

    expect(screen.getByTestId('count')).toHaveTextContent('2');
  });

  it('survives a remount, which is the whole point of an external store', async () => {
    const { unmount } = render(<Probe />);
    await act(async () => {
      cartStore.setCart([line('أ'), line('ب')]);
    });

    unmount();
    render(<Probe />);

    // A tab switch unmounts POSView; a component-state cart would have been lost.
    expect(screen.getByTestId('count')).toHaveTextContent('2');
  });

  it('clears through the store and the hook sees it', async () => {
    render(<Probe />);
    await act(async () => {
      cartStore.setCart([line('أ')]);
    });

    await act(async () => {
      cartStore.clear();
    });

    expect(screen.getByTestId('count')).toHaveTextContent('0');
  });
});
