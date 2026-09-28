// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UpdatePasswordView } from './UpdatePasswordView';
import { AuthContext } from './AuthProvider';
import type { AuthContextType } from './AuthProvider';

/**
 * The screen a cashier lands on after following a recovery link.
 *
 * It exists because Supabase establishes a full session from that link before any
 * new password exists. Without this screen the recovery would drop them into the
 * POS with the forgotten password still in force, and the reset would have
 * achieved nothing.
 */

const updatePassword = vi.fn();
const cancelRecovery = vi.fn();

function renderScreen() {
  const value = {
    session: null,
    user: null,
    shopId: 'shop-1',
    profile: null,
    loading: false,
    mode: 'cloud',
    signOut: vi.fn(),
    recoveryMode: true,
    updatePassword,
    cancelRecovery,
  } as unknown as AuthContextType;

  return render(
    <AuthContext.Provider value={value}>
      <UpdatePasswordView />
    </AuthContext.Provider>
  );
}

const field = (label: RegExp) => screen.getByLabelText(label);

beforeEach(() => {
  updatePassword.mockReset().mockResolvedValue(undefined);
  cancelRecovery.mockReset().mockResolvedValue(undefined);
});

async function fill(user: ReturnType<typeof userEvent.setup>, a: string, b: string) {
  await user.type(field(/كلمة المرور الجديدة/), a);
  await user.type(field(/تأكيد كلمة المرور/), b);
}

describe('UpdatePasswordView', () => {
  it('asks for the new password twice', () => {
    renderScreen();
    expect(field(/كلمة المرور الجديدة/)).toBeTruthy();
    expect(field(/تأكيد كلمة المرور/)).toBeTruthy();
  });

  it('saves a matching, long enough password', async () => {
    const user = userEvent.setup();
    renderScreen();

    await fill(user, 'newsecret', 'newsecret');
    await user.click(screen.getByRole('button', { name: /حفظ كلمة المرور/ }));

    await waitFor(() => expect(updatePassword).toHaveBeenCalledWith('newsecret'));
  });

  it('refuses a password that is too short, before any round trip', async () => {
    const user = userEvent.setup();
    renderScreen();

    await fill(user, 'abc', 'abc');
    await user.click(screen.getByRole('button', { name: /حفظ كلمة المرور/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/قصيرة/);
    expect(updatePassword).not.toHaveBeenCalled();
  });

  it('refuses a mismatch before any round trip', async () => {
    const user = userEvent.setup();
    renderScreen();

    await fill(user, 'newsecret', 'different');
    await user.click(screen.getByRole('button', { name: /حفظ كلمة المرور/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/غير متطابقتين/);
    expect(updatePassword).not.toHaveBeenCalled();
  });

  it('shows a rejection from the server rather than claiming success', async () => {
    const user = userEvent.setup();
    updatePassword.mockRejectedValue(new Error('New password should be different from the old password.'));
    renderScreen();

    await fill(user, 'newsecret', 'newsecret');
    await user.click(screen.getByRole('button', { name: /حفظ كلمة المرور/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/different from the old/);
    // Still on the form, so the cashier can try again.
    expect(screen.getByRole('button', { name: /حفظ كلمة المرور/ })).toBeTruthy();
  });

  it('confirms once the password is saved', async () => {
    const user = userEvent.setup();
    renderScreen();

    await fill(user, 'newsecret', 'newsecret');
    await user.click(screen.getByRole('button', { name: /حفظ كلمة المرور/ }));

    await waitFor(() => expect(screen.getByText(/تم تغيير كلمة المرور بنجاح/)).toBeTruthy());
  });

  it('can be abandoned, which signs the recovery session out', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole('button', { name: /إلغاء والعودة/ }));

    await waitFor(() => expect(cancelRecovery).toHaveBeenCalled());
  });

  it('masks both fields', () => {
    renderScreen();
    expect(field(/كلمة المرور الجديدة/)).toHaveAttribute('type', 'password');
    expect(field(/تأكيد كلمة المرور/)).toHaveAttribute('type', 'password');
  });
});
