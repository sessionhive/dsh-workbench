import type { ToastItem } from '../types';
import { Icon } from './icons';

export function Toasts({ items }: { items: ToastItem[] }) {
  return (
    <div className="toasts" aria-live="polite">
      {items.map((toast) => (
        <div key={toast.id} className={`toast ${toast.tone}`}>
          <Icon
            name={toast.tone === 'success' ? 'check' : toast.tone === 'warn' ? 'alert' : 'spark'}
            size={14}
          />
          <span>{toast.message}</span>
        </div>
      ))}
    </div>
  );
}
