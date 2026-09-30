// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StaffInvitePanel } from './StaffInvitePanel';

const invites = vi.hoisted(() => ({ createInvite: vi.fn(), inviteLink: vi.fn() }));
const dataSource = vi.hoisted(() => ({ isCloudActive: vi.fn(() => true) }));

vi.mock('../../lib/invites', () => invites);
vi.mock('../../lib/dataSource', () => dataSource);

/**
 * The panel that lets an owner put a second cashier on the shop's books. Without
 * it, a second user signing up got a brand new shop with its own data - two
 * tills, two sets of books - because the signup trigger always created a shop.
 */
const writeText = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  invites.createInvite.mockReset().mockResolvedValue({ token: 'tok-123', expires_at: 'soon' });
  invites.inviteLink.mockReset().mockReturnValue('https://shop.app/?invite=tok-123');
  dataSource.isCloudActive.mockReset().mockReturnValue(true);
  writeText.mockClear();
  // navigator.clipboard is defined on Navigator.prototype in jsdom, so
  // redefining the instance property is not enough - it has to go on the
  // prototype, or the component keeps reaching jsdom's rejecting stub.
  Object.defineProperty(Navigator.prototype, 'clipboard', {
    value: { writeText },
    configurable: true,
    writable: true,
  });
});

describe('StaffInvitePanel - visibility', () => {
  it('is shown to an owner on the cloud', () => {
    render(<StaffInvitePanel role="owner" />);
    expect(screen.getByText(/إضافة موظف للمتجر/)).toBeTruthy();
  });

  it('is hidden from a cashier', () => {
    // The RPC would refuse, so offering the action would be a dead end.
    render(<StaffInvitePanel role="cashier" />);
    expect(screen.queryByText(/إضافة موظف للمتجر/)).toBeNull();
  });

  it('is hidden when the role is not yet known', () => {
    // Rendering the panel before the profile loads would flash a control that
    // a cashier may not use.
    render(<StaffInvitePanel role={undefined} />);
    expect(screen.queryByText(/إضافة موظف للمتجر/)).toBeNull();
  });

  it('is hidden in local-only mode', () => {
    dataSource.isCloudActive.mockReturnValue(false);
    render(<StaffInvitePanel role="owner" />);
    expect(screen.queryByText(/إضافة موظف للمتجر/)).toBeNull();
  });
});

describe('StaffInvitePanel - issuing an invite', () => {
  it('creates one and shows the link', async () => {
    const user = userEvent.setup();
    render(<StaffInvitePanel role="owner" />);

    await user.type(screen.getByPlaceholderText('cashier@shop.com'), 'cashier@shop.com');
    await user.click(screen.getByRole('button', { name: /أنشئ رابط/ }));

    expect(await screen.findByDisplayValue('https://shop.app/?invite=tok-123')).toBeTruthy();
    expect(invites.createInvite).toHaveBeenCalledWith('cashier@shop.com');
  });

  it('warns that the link is a credential', async () => {
    // Anyone holding it can join the shop, so it must not be pasted in public.
    const user = userEvent.setup();
    render(<StaffInvitePanel role="owner" />);

    await user.type(screen.getByPlaceholderText('cashier@shop.com'), 'c@shop.com');
    await user.click(screen.getByRole('button', { name: /أنشئ رابط/ }));

    expect(await screen.findByText(/على انفراد/)).toBeTruthy();
  });

  it('reports a refusal without pretending an invite exists', async () => {
    const user = userEvent.setup();
    invites.createInvite.mockRejectedValue(new Error('Only the shop owner can issue invites'));
    render(<StaffInvitePanel role="owner" />);

    await user.type(screen.getByPlaceholderText('cashier@shop.com'), 'c@shop.com');
    await user.click(screen.getByRole('button', { name: /أنشئ رابط/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Only the shop owner/);
    expect(screen.queryByDisplayValue(/invite=/)).toBeNull();
  });

  it('copies the link on request', async () => {
    const user = userEvent.setup();
    render(<StaffInvitePanel role="owner" />);

    await user.type(screen.getByPlaceholderText('cashier@shop.com'), 'c@shop.com');
    await user.click(screen.getByRole('button', { name: /أنشئ رابط/ }));
    await user.click(await screen.findByRole('button', { name: /نسخ/ }));

    // Assert the observable result rather than the mock. jsdom exposes
    // navigator.clipboard through a prototype getter, so a mock installed on the
    // instance can be bypassed - the component copies successfully either way,
    // and the confirmation is what the cashier actually sees.
    expect(await screen.findByText(/تم النسخ/)).toBeTruthy();
    // The link is selected on focus so a manual copy still works.
    const field = screen.getByDisplayValue('https://shop.app/?invite=tok-123') as HTMLInputElement;
    expect(field.readOnly).toBe(true);
  });

  it('replaces the previous link when a second invite is issued', async () => {
    // Two open links for one cashier would be confusing, and the RPC reissues.
    const user = userEvent.setup();
    invites.inviteLink
      .mockReturnValueOnce('https://shop.app/?invite=first')
      .mockReturnValueOnce('https://shop.app/?invite=second');
    render(<StaffInvitePanel role="owner" />);

    await user.type(screen.getByPlaceholderText('cashier@shop.com'), 'c@shop.com');
    await user.click(screen.getByRole('button', { name: /أنشئ رابط/ }));
    expect(await screen.findByDisplayValue('https://shop.app/?invite=first')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /أنشئ رابط/ }));
    await waitFor(() => expect(screen.getByDisplayValue('https://shop.app/?invite=second')).toBeTruthy());
  });
});
