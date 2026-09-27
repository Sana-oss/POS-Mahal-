import React, { useEffect, useRef, useState } from 'react';
import { roundQuantity } from '../../lib/calculations';

/**
 * Editable cart-line quantity.
 *
 * The POS fast path is the -/+ stepper (a scanner gun adds one unit per beep), so
 * that is preserved. But weighed goods need precision: `products.unit` already
 * offers 'كجم' and purchases now accept fractional quantities, so a 2.5 kg sale
 * has to be enterable here too. Previously the quantity was a static <span> and
 * the only controls moved it by whole units, which meant fractional stock could
 * be received but never sold.
 *
 * A local draft string is used while focused so intermediate states like "2."
 * or "" are not clobbered by re-formatting on every keystroke. The committed
 * value is only written on blur or Enter, after validation.
 */

interface Props {
  productId: string;
  value: number;
  /** Current stock, used as the upper bound. */
  max: number;
  onCommit: (productId: string, nextQuantity: number) => void;
  onInvalid: (message: string) => void;
}

export const CartQuantityInput: React.FC<Props> = ({ productId, value, max, onCommit, onInvalid }) => {
  const [draft, setDraft] = useState<string>(String(value));
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Escape must cancel, not save. setDraft is async, so blurring right after
  // setting the draft would let onBlur's commit() read the pre-cancel draft and
  // write the value the cashier was trying to discard. This flag is checked
  // synchronously, so it is reliable regardless of React batching.
  const cancelledRef = useRef(false);

  // Track the committed value while the field is not being edited, so an external
  // change (a re-render after checkout, a realtime refresh) is reflected.
  useEffect(() => {
    if (!focused) setDraft(String(value));
  }, [value, focused]);

  const commit = () => {
    const parsed = Number(draft);

    if (draft.trim() === '' || Number.isNaN(parsed)) {
      onInvalid('الكمية يجب أن تكون رقماً صحيحاً.');
      setDraft(String(value));
      return;
    }
    if (parsed <= 0) {
      onInvalid('الكمية يجب أن تكون أكبر من الصفر.');
      setDraft(String(value));
      return;
    }
    if (parsed > max) {
      onInvalid(`الكمية المتوفرة فقط ${max} ${max === 1 ? 'قطعة' : 'وحدة'}.`);
      setDraft(String(value));
      return;
    }

    const next = roundQuantity(parsed);
    // Only write when it actually changes, so re-committing the same number
    // does not churn the cart.
    if (next !== value) onCommit(productId, next);
    setDraft(String(next));
  };

  return (
    <input
      ref={inputRef}
      type="number"
      inputMode="decimal"
      // 0.001 to match the NUMERIC(10,3) quantity columns, the same step the
      // purchase and inventory forms use for stock.
      step="0.001"
      min="0.001"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => {
        cancelledRef.current = false;
        setFocused(true);
      }}
      onBlur={() => {
        setFocused(false);
        if (cancelledRef.current) {
          cancelledRef.current = false;
          setDraft(String(value));
          return;
        }
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          cancelledRef.current = false;
          inputRef.current?.blur();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancelledRef.current = true;
          setDraft(String(value));
          inputRef.current?.blur();
        }
      }}
      aria-label="الكمية"
      className="w-14 text-center font-bold text-xs text-slate-800 font-num bg-transparent border border-transparent rounded-md focus:bg-white focus:border-teal-400 focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      dir="ltr"
    />
  );
};
