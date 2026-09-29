// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider, useAuth } from './AuthProvider';
import { store } from '../../lib/store';

/**
 * AuthProvider decides which shop a register renders, and it is the guard that
 * stops one cashier from seeing another's data. It had no coverage, so the two
 * paths that matter most -- a session ending without an explicit sign-out, and an
 * explicit sign-out wiping the cache -- were unverified.
 */

const supabaseMock = vi.hoisted(() => ({
  configured: true,
  getSession: vi.fn(),
  signOut: vi.fn(),
  updateUser: vi.fn(),
  profileResult: { data: null as unknown, error: null as unknown },
  listeners: [] as Array<(event: string, session: unknown) => void>,
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
}));

vi.mock('../../lib/supabase', () => ({
  get isSupabaseConfigured() {
    return supabaseMock.configured;
  },
  get supabase() {
    return supabaseMock.configured
      ? {
          auth: {
            getSession: supabaseMock.getSession,
            signOut: supabaseMock.signOut,
            updateUser: supabaseMock.updateUser,
            onAuthStateChange: (cb: (e: string, s: unknown) => void) => {
              supabaseMock.listeners.push(cb);
              return { data: { subscription: { unsubscribe: supabaseMock.unsubscribe } } };
            },
          },
          from: () => ({
            select: () => ({
              eq: () => ({
                single: async () => supabaseMock.profileResult,
              }),
            }),
          }),
        }
      : null;
  },
  requireSupabase: () => null,
}));

const dataSourceMock = vi.hoisted(() => ({ onSessionEnded: vi.fn(), unbindShop: vi.fn() }));
vi.mock('../../lib/dataSource', () => dataSourceMock);

const SESSION = {
  access_token: 'tok',
  user: { id: 'user-1', email: 'owner@shop.test' },
} as never;

function Probe() {
  const auth = useAuth();
  const [pwError, setPwError] = React.useState('');
  return (
    <div>
      <span data-testid="mode">{auth.mode}</span>
      <span data-testid="loading">{String(auth.loading)}</span>
      <span data-testid="shopId">{auth.shopId ?? 'none'}</span>
      <span data-testid="name">{auth.profile?.full_name ?? 'none'}</span>
      <span data-testid="role">{auth.profile?.role ?? 'none'}</span>
      <span data-testid="recovery">{String(auth.recoveryMode)}</span>
      <button onClick={() => void auth.signOut()}>signout</button>
      <button onClick={async () => {
        try {
          await auth.updatePassword('newsecret');
          setPwError('none');
        } catch (e) {
          setPwError(e instanceof Error ? e.message : 'failed');
        }
      }}>setpassword</button>
      <span data-testid="pwerror">{pwError}</span>
    </div>
  );
}

const renderProbe = () =>
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  );

/** Fire the auth listener the way Supabase does on a sign-in/out elsewhere. */
async function fireAuthStateChange(session: unknown, event = 'SIGNED_OUT') {
  await waitFor(() => expect(supabaseMock.listeners.length).toBeGreaterThan(0));
  for (const cb of supabaseMock.listeners) await cb(event, session);
}

beforeEach(() => {
  store.resetToDefault();
  supabaseMock.configured = true;
  supabaseMock.listeners = [];
  supabaseMock.getSession.mockReset().mockResolvedValue({ data: { session: null } });
  supabaseMock.signOut.mockReset().mockResolvedValue({ error: null });
  supabaseMock.updateUser.mockReset().mockResolvedValue({ error: null });
  supabaseMock.profileResult = {
    data: { id: 'user-1', shop_id: 'shop-7', role: 'owner', full_name: 'سارة' },
    error: null,
  };
  supabaseMock.subscribe.mockReset();
  supabaseMock.unsubscribe.mockReset();
  dataSourceMock.onSessionEnded.mockReset();
  dataSourceMock.unbindShop.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('AuthProvider - offline mode', () => {
  it('reports offline and never blocks on a session', async () => {
    supabaseMock.configured = false;
    renderProbe();

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(screen.getByTestId('mode')).toHaveTextContent('offline');
    expect(supabaseMock.getSession).not.toHaveBeenCalled();
  });

  it('mirrors the local cashier session so the header shows a real name', async () => {
    supabaseMock.configured = false;
    store.setSession({
      id: 'local-1',
      name: 'أبو أحمد',
      email: 'a@b.test',
      role: 'owner',
      shift_started_at: new Date().toISOString(),
    });

    renderProbe();

    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('أبو أحمد'));
    expect(screen.getByTestId('role')).toHaveTextContent('owner');
  });

  it('signing out is a no-op with no backend to clear', async () => {
    supabaseMock.configured = false;
    const user = userEvent.setup();
    renderProbe();

    await user.click(screen.getByText('signout'));

    expect(supabaseMock.signOut).not.toHaveBeenCalled();
  });
});

describe('AuthProvider - cloud mode', () => {
  it('reports cloud mode', async () => {
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(screen.getByTestId('mode')).toHaveTextContent('cloud');
  });

  it('restores an existing session and loads the profile', async () => {
    supabaseMock.getSession.mockResolvedValue({ data: { session: SESSION } });
    renderProbe();

    await waitFor(() => expect(screen.getByTestId('shopId')).toHaveTextContent('shop-7'));
    expect(screen.getByTestId('name')).toHaveTextContent('سارة');
  });

  /**
   * The store session is what the header, sidebar and dashboard greeting read.
   * fetchProfile used to update only local context state, so the store kept its
   * seeded placeholder name and the greeting showed 'أبو أحمد' no matter who
   * signed in. The test above passed the whole time, because the context was
   * correct - only the store was not.
   */
  it('mirrors the signed-in profile into the store session', async () => {
    supabaseMock.getSession.mockResolvedValue({ data: { session: SESSION } });
    store.setSession({ id: 'usr-1', name: 'أبو أحمد', email: 'x@y.z', role: 'owner' } as never);

    renderProbe();

    await waitFor(() => expect(store.getSession()?.name).toBe('سارة'));
    expect(store.getSession()?.role).toBe('owner');
  });

  it('clears the mirrored name on sign-out so the next cashier does not inherit it', async () => {
    supabaseMock.getSession.mockResolvedValue({ data: { session: SESSION } });
    supabaseMock.signOut.mockResolvedValue(undefined);
    renderProbe();
    await waitFor(() => expect(store.getSession()?.name).toBe('سارة'));

    await userEvent.click(screen.getByText('signout'));

    await waitFor(() => expect(store.getSession()).toBeNull());
  });

  it('leaves the shop unset when the profile row is missing', async () => {
    // App.tsx shows an error screen when mode is cloud and shopId is null, so this
    // must not resolve to a shop the user does not belong to.
    supabaseMock.getSession.mockResolvedValue({ data: { session: SESSION } });
    supabaseMock.profileResult = { data: null, error: { message: 'no row' } };

    renderProbe();

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(screen.getByTestId('shopId')).toHaveTextContent('none');
  });

  it('survives a thrown getSession', async () => {
    supabaseMock.getSession.mockRejectedValue(new Error('offline'));
    renderProbe();

    // Must not hang on the loading screen forever.
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
  });

  it('unsubscribes on unmount', async () => {
    const { unmount } = renderProbe();
    // A listener must have been registered, otherwise there is nothing to detach.
    await waitFor(() => expect(supabaseMock.listeners.length).toBeGreaterThan(0));

    unmount();

    // Leaving it attached would keep calling setState on an unmounted tree and
    // hold the session in memory after the register is closed.
    expect(supabaseMock.unsubscribe).toHaveBeenCalled();
  });
});

describe('AuthProvider - the session ends without a sign-out', () => {
  it('drops the shop and tears down the live sync', async () => {
    supabaseMock.getSession.mockResolvedValue({ data: { session: SESSION } });
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('shopId')).toHaveTextContent('shop-7'));

    await fireAuthStateChange(null);

    // The subscription and the in-progress cart must not survive, or the next
    // cashier inherits a cart priced from the previous shop.
    expect(dataSourceMock.onSessionEnded).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId('shopId')).toHaveTextContent('none'));
  });
});

describe('AuthProvider - explicit sign-out', () => {
  it('clears the backend session and wipes the cached shop data', async () => {
    supabaseMock.getSession.mockResolvedValue({ data: { session: SESSION } });
    store.addExpense({ title: 'مصروف سابق', amount: 10, category: 'أخرى' });

    const user = userEvent.setup();
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('shopId')).toHaveTextContent('shop-7'));

    await user.click(screen.getByText('signout'));

    expect(supabaseMock.signOut).toHaveBeenCalled();
    // The next cashier must not open the app and see the previous shop's data.
    expect(dataSourceMock.unbindShop).toHaveBeenCalled();
  });
});

/**
 * Password recovery.
 *
 * Supabase establishes a real session from the emailed link *before* any new
 * password exists. The auth event was previously discarded as `_event`, so the
 * app could not tell a recovery from an ordinary sign-in: the cashier following
 * a reset link was dropped straight into the POS with the old password still in
 * force and no prompt to change it. Which is to say, the reset link did nothing.
 */
describe('AuthProvider - password recovery', () => {
  it('enters recovery mode on a PASSWORD_RECOVERY event', async () => {
    supabaseMock.getSession.mockResolvedValue({ data: { session: null } });
    renderProbe();

    await fireAuthStateChange(SESSION, 'PASSWORD_RECOVERY');

    await waitFor(() => expect(screen.getByTestId('recovery')).toHaveTextContent('true'));
  });

  it('stays out of recovery mode for an ordinary sign-in', async () => {
    supabaseMock.getSession.mockResolvedValue({ data: { session: SESSION } });
    renderProbe();

    await fireAuthStateChange(SESSION);

    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('سارة'));
    expect(screen.getByTestId('recovery')).toHaveTextContent('false');
  });

  it('leaves recovery mode once the new password is accepted', async () => {
    supabaseMock.getSession.mockResolvedValue({ data: { session: null } });
    supabaseMock.updateUser.mockResolvedValue({ error: null });
    renderProbe();
    await fireAuthStateChange(SESSION, 'PASSWORD_RECOVERY');
    await waitFor(() => expect(screen.getByTestId('recovery')).toHaveTextContent('true'));

    await userEvent.click(screen.getByText('setpassword'));

    await waitFor(() => expect(screen.getByTestId('recovery')).toHaveTextContent('false'));
    expect(supabaseMock.updateUser).toHaveBeenCalledWith({ password: 'newsecret' });
  });

  it('surfaces a rejected password and stays in recovery mode', async () => {
    supabaseMock.getSession.mockResolvedValue({ data: { session: null } });
    supabaseMock.updateUser.mockResolvedValue({ error: { message: 'too weak' } });
    renderProbe();
    await fireAuthStateChange(SESSION, 'PASSWORD_RECOVERY');
    await waitFor(() => expect(screen.getByTestId('recovery')).toHaveTextContent('true'));

    await userEvent.click(screen.getByText('setpassword'));

    await waitFor(() => expect(screen.getByTestId('pwerror')).toHaveTextContent('too weak'));
    // Staying in recovery matters: leaving it would drop the cashier into the
    // POS still holding the old password they could not remember.
    expect(screen.getByTestId('recovery')).toHaveTextContent('true');
  });
});
