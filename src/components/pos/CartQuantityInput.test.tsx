// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { CartQuantityInput } from './CartQuantityInput';

/**
 * The cart quantity field is the only place a weighed quantity can be entered,
 * so its validation and commit timing are worth pinning down. In particular the
 * local draft must survive intermediate keystrokes ("2.") and must not commit
 * until blur or Enter.
 */

/** Harness mirroring how POSView owns the cart: local state + commit callback. */
function Harness({
  initial,
  max,
  onCommit = () => {},
  onInvalid = () => {},
}: {
  initial: number;
  max: number;
  onCommit?: (id: string, next: number) => void;
  onInvalid?: (message: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <CartQuantityInput
      productId="p1"
      value={value}
      max={max}
      onCommit={(id, next) => {
        onCommit(id, next);
        setValue(next);
      }}
      onInvalid={onInvalid}
    />
  );
}

const field = () => screen.getByLabelText('الكمية') as HTMLInputElement;

describe('CartQuantityInput', () => {
  it('shows the current quantity', () => {
    render(<Harness initial={3} max={10} />);
    expect(field()).toHaveValue(3);
  });

  it('commits a whole-number change on blur', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<Harness initial={1} max={10} onCommit={onCommit} />);

    const input = field();
    await user.clear(input);
    await user.type(input, '4');
    await user.tab();

    expect(onCommit).toHaveBeenCalledWith('p1', 4);
  });

  it('commits a fractional quantity, for weighed goods', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<Harness initial={1} max={10} onCommit={onCommit} />);

    const input = field();
    await user.clear(input);
    await user.type(input, '2.5');
    await user.tab();

    expect(onCommit).toHaveBeenCalledWith('p1', 2.5);
  });

  it('commits on Enter', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<Harness initial={1} max={10} onCommit={onCommit} />);

    const input = field();
    await user.clear(input);
    await user.type(input, '6{Enter}');

    expect(onCommit).toHaveBeenCalledWith('p1', 6);
  });

  it('does not clobber intermediate keystrokes while focused', async () => {
    // Typing "2." must leave "2." in the field. If the value were formatted on
    // every change, the trailing dot would vanish and the field would fight the
    // cashier.
    const user = userEvent.setup();
    render(<Harness initial={1} max={10} />);

    const input = field();
    await user.clear(input);
    await user.type(input, '2.');

    expect(field()).toHaveValue(2);
  });

  it('rejects a quantity above the available stock and reverts', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    const onInvalid = vi.fn();
    render(<Harness initial={1} max={4} onCommit={onCommit} onInvalid={onInvalid} />);

    const input = field();
    await user.clear(input);
    await user.type(input, '5');
    await user.tab();

    expect(onCommit).not.toHaveBeenCalled();
    expect(onInvalid).toHaveBeenCalledWith(expect.stringContaining('4'));
    expect(field()).toHaveValue(1);
  });

  it('allows selling the entire remaining stock', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<Harness initial={1} max={4} onCommit={onCommit} />);

    const input = field();
    await user.clear(input);
    await user.type(input, '4');
    await user.tab();

    expect(onCommit).toHaveBeenCalledWith('p1', 4);
  });

  it('rejects zero and reverts', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    const onInvalid = vi.fn();
    render(<Harness initial={2} max={10} onCommit={onCommit} onInvalid={onInvalid} />);

    const input = field();
    await user.clear(input);
    await user.type(input, '0');
    await user.tab();

    expect(onCommit).not.toHaveBeenCalled();
    expect(onInvalid).toHaveBeenCalledWith(expect.stringContaining('أكبر من الصفر'));
    expect(field()).toHaveValue(2);
  });

  it('rejects a negative quantity and reverts', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<Harness initial={2} max={10} onCommit={onCommit} />);

    const input = field();
    await user.clear(input);
    await user.type(input, '-1');
    await user.tab();

    expect(onCommit).not.toHaveBeenCalled();
    expect(field()).toHaveValue(2);
  });

  it('rejects a non-numeric entry and reverts', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    const onInvalid = vi.fn();
    render(<Harness initial={2} max={10} onCommit={onCommit} onInvalid={onInvalid} />);

    const input = field();
    await user.clear(input);
    // A number input rejects letters, so clear it entirely instead.
    await user.tab();

    expect(onCommit).not.toHaveBeenCalled();
    expect(onInvalid).toHaveBeenCalledWith(expect.stringContaining('رقماً'));
    expect(field()).toHaveValue(2);
  });

  it('reverts on Escape without committing', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<Harness initial={3} max={10} onCommit={onCommit} />);

    const input = field();
    await user.clear(input);
    await user.type(input, '9{Escape}');

    expect(onCommit).not.toHaveBeenCalled();
    expect(field()).toHaveValue(3);
  });

  it('rounds to 3 decimals, matching NUMERIC(10,3)', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<Harness initial={1} max={10} onCommit={onCommit} />);

    const input = field();
    await user.clear(input);
    await user.type(input, '2.5555');
    await user.tab();

    expect(onCommit).toHaveBeenCalledWith('p1', 2.556);
  });

  it('does not rewrite the cart when the value is unchanged', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<Harness initial={3} max={10} onCommit={onCommit} />);

    const input = field();
    await user.click(input);
    await user.tab();

    expect(onCommit).not.toHaveBeenCalled();
  });

  it('reflects an external change to the quantity when not focused', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <CartQuantityInput productId="p1" value={3} max={10} onCommit={() => {}} onInvalid={() => {}} />
    );
    expect(field()).toHaveValue(3);

    // A realtime refresh or a re-render after checkout changes the value.
    rerender(
      <CartQuantityInput productId="p1" value={7} max={10} onCommit={() => {}} onInvalid={() => {}} />
    );
    await user.click(document.body);

    expect(field()).toHaveValue(7);
  });
});
