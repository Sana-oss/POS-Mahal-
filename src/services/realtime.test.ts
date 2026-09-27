import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startRealtime, stopRealtime } from './realtime';

/**
 * realtime.ts is the only place a second register's writes reach this one, and it
 * had no coverage at all. It is pure logic over module-level state plus a Supabase
 * channel, so it is fully testable offline: fake the channel, fire the callbacks
 * a real transaction would produce, and drive the clock.
 */

/**
 * vi.mock factories are hoisted above the imports, so the recording surface has to
 * be created with vi.hoisted or the factory hits the temporal dead zone.
 */
const net = vi.hoisted(() => ({
  channels: [] as { regs: { table: string; filter: string; cb: () => void }[] }[],
  removed: 0,
  configured: true,
}));

vi.mock('../lib/supabase', () => {
  const client = {
    channel(_name: string) {
      const entry: { regs: { table: string; filter: string; cb: () => void }[] } = { regs: [] };
      net.channels.push(entry);
      const api = {
        on(_event: string, opts: { table: string; filter: string }, cb: () => void) {
          entry.regs.push({ table: opts.table, filter: opts.filter, cb });
          return api;
        },
        subscribe() {
          return api;
        },
      };
      return api;
    },
    async removeChannel() {
      net.removed += 1;
    },
  };
  return {
    // A getter, not a value: realtime.ts reads `supabase` at call time, so a test
    // can flip this to null without re-importing the module.
    get supabase() {
      return net.configured ? client : null;
    },
    isSupabaseConfigured: true,
    requireSupabase: () => client,
  };
});

const DEBOUNCE_MS = 400;

/** The nine tables whose movement means the render cache is stale. */
const WATCHED = [
  'products',
  'sales',
  'sale_items',
  'purchases',
  'purchase_items',
  'customers',
  'customer_payments',
  'stock_movements',
  'expenses',
];

const activeChannel = () => net.channels[net.channels.length - 1];

/** Fire every table's callback, as one transaction does. */
const fireBurst = () => activeChannel().regs.forEach((r) => r.cb());

/** Fire a single table's callback, as a one-table UPDATE does. */
const fireTable = (table: string) =>
  activeChannel().regs.filter((r) => r.table === table).forEach((r) => r.cb());

/** A promise the test resolves by hand, to hold a reload "in flight". */
function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  net.channels = [];
  net.removed = 0;
  net.configured = true;
  vi.useFakeTimers();
});

afterEach(() => {
  stopRealtime();
  vi.useRealTimers();
});

describe('realtime - subscription setup', () => {
  it('subscribes once per watched table', () => {
    startRealtime('shop-1', vi.fn());

    const regs = activeChannel().regs;
    expect(regs).toHaveLength(WATCHED.length);
    expect(regs.map((r) => r.table).sort()).toEqual([...WATCHED].sort());
  });

  it('narrows every table to the bound shop', () => {
    // Not the security boundary -- RLS is -- but a missing filter would make a
    // register re-pull on writes it cannot see.
    startRealtime('shop-abc', vi.fn());

    for (const reg of activeChannel().regs) {
      expect(reg.filter).toBe('shop_id=eq.shop-abc');
    }
  });

  it('is a no-op when Supabase is not configured', () => {
    net.configured = false;
    const handler = vi.fn();

    startRealtime('shop-1', handler);

    expect(net.channels).toHaveLength(0);
    expect(handler).not.toHaveBeenCalled();
  });

  it('tears down the previous channel when re-bound', () => {
    startRealtime('shop-1', vi.fn());
    startRealtime('shop-2', vi.fn());

    // Two channels were created; the first must be removed or both stay live.
    expect(net.channels).toHaveLength(2);
    expect(net.removed).toBe(1);
  });
});

describe('realtime - debounce', () => {
  it('collapses a one-event-per-table burst into a single reload', async () => {
    // A single sale writes five tables, so without coalescing each register would
    // pull the full snapshot five times for one transaction.
    const handler = vi.fn().mockResolvedValue(undefined);
    startRealtime('shop-1', handler);

    fireBurst();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('waits out the whole window before reloading', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    startRealtime('shop-1', handler);

    fireTable('products');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1);

    expect(handler).not.toHaveBeenCalled();
  });

  it('restarts the window on each new event', async () => {
    // A trickle of writes must not reload on every event.
    const handler = vi.fn().mockResolvedValue(undefined);
    startRealtime('shop-1', handler);

    for (let i = 0; i < 3; i++) {
      fireTable('sales');
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 100);
      expect(handler).not.toHaveBeenCalled();
    }

    await vi.advanceTimersByTimeAsync(100);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending reload when stopped', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    startRealtime('shop-1', handler);

    fireTable('products');
    stopRealtime();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 2);

    expect(handler).not.toHaveBeenCalled();
  });

  it('stops reacting to callbacks after being stopped', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    startRealtime('shop-1', handler);

    const regs = activeChannel().regs;
    stopRealtime();

    // The channel is detached, so these can no longer reach the nulled handler.
    regs.forEach((r) => r.cb());
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 2);

    expect(handler).not.toHaveBeenCalled();
  });
});

describe('realtime - reload coalescing while a pull is in flight', () => {
  it('runs exactly one follow-up for events that arrive mid-pull', async () => {
    // The dangerous case is one-per-event follow-ups: a busy second register would
    // multiply snapshot pulls instead of collapsing them.
    const gate = deferred();
    const handler = vi.fn().mockReturnValue(gate.promise);
    startRealtime('shop-1', handler);

    fireTable('products');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(handler).toHaveBeenCalledTimes(1);

    // Five more tables land while the first pull is still running.
    fireBurst();
    fireBurst();
    expect(handler).toHaveBeenCalledTimes(1); // still queued, not started

    gate.resolve();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('keeps reloading after a failed pull', async () => {
    // A background re-pull failing must never break the register already working,
    // and must not wedge the subscription either.
    const handler = vi
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValue(undefined);
    startRealtime('shop-1', handler);

    fireTable('products');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(handler).toHaveBeenCalledTimes(1);

    fireTable('sales');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('does not let an earlier session completion clear the new session state', async () => {
    // Regression: runReload's finally writes to module-level `inFlight`, and
    // stopRealtime() resets those same globals. Re-binding mid-pull (shop switch,
    // re-auth) let the OLD pull's finally mark the NEW pull as finished, so the
    // next event started a second concurrent snapshot pull.
    const gateA = deferred();
    const handlerA = vi.fn().mockReturnValue(gateA.promise);
    startRealtime('shop-1', handlerA);
    fireTable('products');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(handlerA).toHaveBeenCalledTimes(1);

    // Re-bind to another shop while that pull is still running.
    const gateB = deferred();
    const handlerB = vi.fn().mockReturnValue(gateB.promise);
    startRealtime('shop-2', handlerB);
    fireTable('sales');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(handlerB).toHaveBeenCalledTimes(1);

    // The old pull finally settles, after the new one is in flight.
    gateA.resolve();
    await vi.advanceTimersByTimeAsync(0);

    // A further change must be queued behind handlerB, not run alongside it.
    fireTable('expenses');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(handlerB).toHaveBeenCalledTimes(1);

    gateB.resolve();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(handlerB).toHaveBeenCalledTimes(2);
  });
});
