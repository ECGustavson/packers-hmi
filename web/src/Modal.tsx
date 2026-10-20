// Dialog shell: dims the screen, closes when the dimmed area is tapped
import { ReactNode } from 'react';

export function Modal({ label, onClose, wide = false, children }:
  { label: string; onClose: () => void; wide?: boolean; children: ReactNode }) {
  return (
    <div className="np-backdrop" onClick={onClose}>
      <div className={wide ? 'np np-wide' : 'np'} role="dialog" aria-label={label}
        onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
