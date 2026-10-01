import { useEffect, useRef, useState, type ReactNode } from 'react';

export function MethodBadge({ method }: { method: string }) {
  return <span className={`method method-${method}`}>{method.toUpperCase()}</span>;
}

export function StatusBadge({ status }: { status: string | number }) {
  const cls = String(status)[0];
  return <span className={`status status-${/[1-5]/.test(cls) ? cls : 'x'}`}>{status}</span>;
}

/** Pretty-printed JSON with minimal syntax highlighting. */
export function JsonView({ value }: { value: unknown }) {
  const text = JSON.stringify(value, null, 2) ?? 'undefined';
  const parts = text.split(/("(?:\\.|[^"\\])*"(?:\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g);
  return (
    <pre className="json">
      {parts.map((p, i) => {
        if (i % 2 === 0) return p;
        const cls = p.endsWith(':') ? 'j-key' : p.startsWith('"') ? 'j-str' : /true|false|null/.test(p) ? 'j-lit' : 'j-num';
        return (
          <span key={i} className={cls}>
            {p}
          </span>
        );
      })}
    </pre>
  );
}

/**
 * Button with a menu that opens on hover (and on click, for touch devices).
 * The menu stays open while the pointer is over the button or the menu.
 */
export function HoverMenu({
  label,
  title,
  className = '',
  align = 'right',
  children,
}: {
  label: ReactNode;
  title?: string;
  className?: string;
  align?: 'left' | 'right';
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const show = () => {
    window.clearTimeout(timer.current);
    setOpen(true);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(false), 180);
  };
  return (
    <span className={`hover-menu ${className}`} onMouseEnter={show} onMouseLeave={hide}>
      <button type="button" className="ghost small" title={title} onClick={() => setOpen((o) => !o)}>
        {label}
      </button>
      {open && <div className={`popover menu align-${align}`}>{children(() => setOpen(false))}</div>}
    </span>
  );
}

export function Modal({ title, onClose, children, footer }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog">
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function preview(value: unknown, max = 40): string {
  const s = typeof value === 'string' ? JSON.stringify(value) : JSON.stringify(value) ?? 'undefined';
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
