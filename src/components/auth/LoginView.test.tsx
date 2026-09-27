// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginView } from './LoginView';

vi.mock('lucide-react', () => ({
  Store: () => null,
  Loader2: () => null,
  LogIn: () => null,
}));

const supabaseMock = vi.hoisted(() => ({
  client: null as { auth: { signInWithPassword: ReturnType<typeof vi.fn> } } | null,
}));

vi.mock('../../lib/supabase', () => ({
  get supabase() {
    return supabaseMock.client;
  },
  isSupabaseConfigured: true,
  requireSupabase: () => supabaseMock.client,
}));

const signIn = vi.fn();
const emailField = () => screen.getByLabelText('البريد الإلكتروني');
const passwordField = () => screen.getByLabelText('كلمة المرور');
const submit = () => screen.getByRole('button');

async function fillAndSubmit() {
  const user = userEvent.setup();
  await user.type(emailField(), 'owner@shop.test');
  await user.type(passwordField(), 'secret123');
  await user.click(submit());
}

beforeEach(() => {
  supabaseMock.client = { auth: { signInWithPassword: signIn } };
  signIn.mockReset();
  signIn.mockResolvedValue({ error: null });
  render(<LoginView />);
});

describe('LoginView - successful sign-in', () => {
  it('sends the typed credentials', async () => {
    await fillAndSubmit();
    expect(signIn).toHaveBeenCalledWith({
      email: 'owner@shop.test',
      password: 'secret123',
    });
  });

  it('shows no error when the server accepts', async () => {
    await fillAndSubmit();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('LoginView - rejected sign-in', () => {
  it('translates invalid credentials into Arabic', async () => {
    // Supabase's raw message is English; a cashier needs to read it.
    signIn.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
    await fillAndSubmit();

    expect(screen.getByRole('alert')).toHaveTextContent(
      'البريد الإلكتروني أو كلمة المرور غير صحيحة'
    );
  });

  it('surfaces any other server message verbatim', async () => {
    signIn.mockResolvedValue({ error: { message: 'Email not confirmed' } });
    await fillAndSubmit();

    expect(screen.getByRole('alert')).toHaveTextContent('Email not confirmed');
  });

  it('survives a thrown network error', async () => {
    signIn.mockRejectedValue(new Error('Failed to fetch'));
    await fillAndSubmit();

    expect(screen.getByRole('alert')).toHaveTextContent('Failed to fetch');
  });

  it('survives a rejection with no message', async () => {
    signIn.mockRejectedValue({});
    await fillAndSubmit();

    expect(screen.getByRole('alert')).toHaveTextContent('حدث خطأ');
  });

  it('re-enables the button so the cashier can retry', async () => {
    signIn.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
    await fillAndSubmit();

    expect(submit()).not.toBeDisabled();
  });

  it('clears a previous error on the next attempt', async () => {
    signIn.mockResolvedValueOnce({ error: { message: 'Invalid login credentials' } });
    await fillAndSubmit();
    expect(screen.getByRole('alert')).toBeInTheDocument();

    signIn.mockResolvedValueOnce({ error: null });
    await userEvent.setup().click(submit());

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('LoginView - required fields', () => {
  it('will not submit an empty form', async () => {
    const user = userEvent.setup();
    await user.click(submit());
    expect(signIn).not.toHaveBeenCalled();
  });

  it('rejects a malformed email through the browser', async () => {
    const user = userEvent.setup();
    await user.type(emailField(), 'not-an-email');
    await user.type(passwordField(), 'secret123');
    await user.click(submit());

    expect(signIn).not.toHaveBeenCalled();
  });
});

describe('LoginView - local-only deployment', () => {
  it('explains that there is nothing to sign in to', async () => {
    // Without Supabase there is no backend identity; the app runs on the device.
    supabaseMock.client = null;
    const user = userEvent.setup();

    await user.type(emailField(), 'owner@shop.test');
    await user.type(passwordField(), 'secret123');
    await user.click(submit());

    expect(screen.getByRole('alert')).toHaveTextContent(/الوضع المحلي/);
  });
});

describe('LoginView - accessibility', () => {
  it('binds both labels to their controls', () => {
    expect(emailField()).toHaveAttribute('type', 'email');
    expect(passwordField()).toHaveAttribute('type', 'password');
  });

  it('masks the password field', () => {
    expect(passwordField()).toHaveAttribute('type', 'password');
  });
});
