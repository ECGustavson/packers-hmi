// On-screen keyboard for short text such as user names.
// Shift is on at the start and after a space, so names capitalize themselves, like a phone keyboard.

import { useEffect, useState } from 'react';
import { Modal } from './Modal';

const ROWS = ['1234567890', 'QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];

export function TextPad({ title, initial = '', maxLength = 24, onEnter, onCancel }: {
  title: string;
  initial?: string;
  maxLength?: number;
  onEnter: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const [shift, setShift] = useState(initial === '');
  const valid = text.trim().length > 0;

  const type = (ch: string) => {
    setText((t) => (t.length < maxLength ? t + (shift ? ch.toUpperCase() : ch.toLowerCase()) : t));
    setShift(false);
  };
  const space = () => {
    setText((t) => (t.length < maxLength && t !== '' && !t.endsWith(' ') ? t + ' ' : t));
    setShift(true);
  };
  const back = () => setText((t) => t.slice(0, -1));
  const enter = () => { if (valid) onEnter(text.trim()); };

  // Physical keyboard also works
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^[a-zA-Z0-9]$/.test(e.key)) {
        setText((t) => (t.length < maxLength ? t + e.key : t));
        setShift(false);
      }
      else if (e.key === ' ') space();
      else if (e.key === 'Backspace') back();
      else if (e.key === 'Enter') enter();
      else if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <Modal label={`Enter ${title}`} onClose={onCancel} wide>
      <div className="np-head">
        <span>{title}</span>
        <span className="np-small">{text.length} / {maxLength}</span>
      </div>
      <div className="np-display text">{text || '\u00a0'}</div>

      <div className="kb">
        {ROWS.map((row) => (
          <div key={row} className="kb-row">
            {row.split('').map((ch) => (
              <button key={ch} onClick={() => type(ch)}>{shift ? ch : ch.toLowerCase()}</button>
            ))}
          </div>
        ))}
        <div className="kb-row">
          <button className={shift ? 'kb-wide selected' : 'kb-wide'} onClick={() => setShift((s) => !s)}>Shift</button>
          <button className="kb-space" onClick={space}>Space</button>
          <button className="kb-wide" onClick={back} aria-label="Backspace">⌫</button>
        </div>
      </div>
      <div className="np-actions">
        <button className="np-fn" onClick={onCancel}>Cancel</button>
        <button className="np-enter" disabled={!valid} onClick={enter}>Done</button>
      </div>
    </Modal>
  );
}
