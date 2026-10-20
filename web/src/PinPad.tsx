// On-screen PIN entry. Digits are masked. PINs are 4 to 8 digits.
// onSubmit may be async; if it throws, the message is shown and the PIN is cleared.

import { useEffect, useState } from 'react';
import { Modal } from './Modal';

const MIN_LENGTH = 4;
const MAX_LENGTH = 8;

export function PinPad({ title, subtitle, submitLabel, onSubmit, onCancel }: {
  title: string;
  subtitle: string;
  submitLabel: string;
  onSubmit: (pin: string) => Promise<void> | void;
  onCancel: () => void;
}) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const valid = pin.length >= MIN_LENGTH;

  const press = (d: string) => { setError(''); setPin((p) => (p.length < MAX_LENGTH ? p + d : p)); };
  const back = () => setPin((p) => p.slice(0, -1));

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      await onSubmit(pin);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  // Physical keyboard also works
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') back();
      else if (e.key === 'Enter') submit();
      else if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <Modal label={`${title}: ${subtitle}`} onClose={onCancel}>
      <div className="np-head"><span>{title}</span></div>
      <div className="np-small">{subtitle}</div>

      <div className="np-display pin" aria-label={`${pin.length} digits entered`}>
        {pin ? '●'.repeat(pin.length) : '\u00a0'}
      </div>
      <div className="np-msg">{error || '\u00a0'}</div>

      <div className="np-keys">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => (
          <button key={k} onClick={() => press(k)}>{k}</button>
        ))}
        <button className="np-fn" onClick={() => setPin('')}>Clear</button>
        <button onClick={() => press('0')}>0</button>
        <button className="np-fn" onClick={back} aria-label="Backspace">⌫</button>
      </div>
      <div className="np-actions">
        <button className="np-fn" onClick={onCancel}>Cancel</button>
        <button className="np-enter" disabled={!valid || busy} onClick={submit}>{submitLabel}</button>
      </div>
    </Modal>
  );
}
