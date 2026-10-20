// On-screen numpad for entering values, for touch panels with no OS keyboard.
// Starts empty so the first key replaces the value. Enter stays disabled until the value is in range.

import { useEffect, useState } from 'react';
import { Modal } from './Modal';

type Props = {
  label: string;
  unit?: string;
  value: unknown;      // current PLC value, shown for reference
  min: number;
  max: number;
  decimals?: number;   // 0 = integers only (disables the decimal key)
  onEnter: (v: number) => void;
  onCancel: () => void;
};

export function Numpad({ label, unit = '', value, min, max, decimals = 2, onEnter, onCancel }: Props) {
  const [text, setText] = useState('');
  const n = Number(text);
  const valid = text !== '' && Number.isFinite(n) && n >= min && n <= max;
  const current = typeof value === 'number' ? value.toFixed(decimals) : '--';

  const press = (k: string) => setText((t) => {
    if (k === '±') return t.startsWith('-') ? t.slice(1) : '-' + t;
    if (k === '.') {
      if (decimals === 0 || t.includes('.')) return t;
      return t === '' || t === '-' ? t + '0.' : t + '.';
    }
    if (t.includes('.') && t.split('.')[1].length >= decimals) return t;  // decimal limit
    if (t.replace('-', '').length >= 12) return t;                         // length limit
    if (t === '0') return k;
    if (t === '-0') return '-' + k;
    return t + k;
  });
  const back = () => setText((t) => t.slice(0, -1));
  const enter = () => { if (valid) onEnter(n); };

  // Physical keyboard also works (handy when developing on a laptop)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === '.') press('.');
      else if (e.key === '-' && min < 0) press('±');
      else if (e.key === 'Backspace') back();
      else if (e.key === 'Enter') enter();
      else if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <Modal label={`Enter ${label}`} onClose={onCancel}>
      <div className="np-head">
        <span>{label}</span>
        <span className="np-small">{min} to {max} {unit}</span>
      </div>
      <div className="np-small">Current: {current} {unit}</div>

      <div className={text && !valid ? 'np-display invalid' : 'np-display'}>{text || '\u00a0'}</div>
      <div className="np-msg">{text && !valid ? `Enter a value from ${min} to ${max}` : '\u00a0'}</div>

      <div className="np-keys">
        {['7', '8', '9', '4', '5', '6', '1', '2', '3'].map((k) => (
          <button key={k} onClick={() => press(k)}>{k}</button>
        ))}
        <button onClick={() => press('±')} disabled={min >= 0} aria-label="Plus or minus">±</button>
        <button onClick={() => press('0')}>0</button>
        <button onClick={() => press('.')} disabled={decimals === 0} aria-label="Decimal point">.</button>
        <button className="np-fn" onClick={back} aria-label="Backspace">⌫</button>
        <button className="np-fn" onClick={() => setText('')}>Clear</button>
        <button className="np-fn" onClick={onCancel}>Cancel</button>
      </div>
      <button className="np-enter" disabled={!valid} onClick={enter}>Enter</button>
    </Modal>
  );
}
