import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

/**
 * In-app notification banners — deliberately NOT window.confirm()/alert().
 * Those are synchronous, blocking dialogs, and browsers are inconsistent about
 * surfacing them promptly (or at all) on a background/unfocused tab, which made
 * real-time events like incoming challenges look like they weren't arriving when
 * they actually were.
 */

export interface NotifyAction {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
}

interface NotifyItem {
  id: string;
  message: string;
  actions: NotifyAction[];
}

interface NotificationContextValue {
  notify: (message: string, actions?: NotifyAction[], autoDismissMs?: number) => string;
  dismiss: (id: string) => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

function variantClasses(variant?: NotifyAction['variant']): string {
  const base = 'px-3 py-1.5 rounded-md text-sm font-semibold transition';
  if (variant === 'secondary') return `${base} bg-neutral-700 hover:bg-neutral-600 text-neutral-100`;
  if (variant === 'danger') return `${base} bg-red-600 hover:bg-red-500 text-white`;
  return `${base} bg-blue-600 hover:bg-blue-500 text-white`;
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<NotifyItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const notify = useCallback(
    (message: string, actions: NotifyAction[] = [], autoDismissMs?: number) => {
      const id = crypto.randomUUID();
      setItems((prev) => [...prev, { id, message, actions }]);
      if (autoDismissMs) setTimeout(() => dismiss(id), autoDismissMs);
      return id;
    },
    [dismiss],
  );

  return (
    <NotificationContext.Provider value={{ notify, dismiss }}>
      {children}
      <div className="fixed top-4 right-4 z-[1000] flex w-80 max-w-[90vw] flex-col gap-2">
        {items.map((item) => (
          <div
            key={item.id}
            className="notify-in rounded-lg border border-blue-500 bg-neutral-800 p-3 shadow-lg"
          >
            <p className="mb-2 text-sm text-neutral-100">{item.message}</p>
            {item.actions.length > 0 && (
              <div className="flex gap-2">
                {item.actions.map((a, i) => (
                  <button
                    key={i}
                    className={variantClasses(a.variant)}
                    onClick={() => {
                      a.onClick();
                      dismiss(item.id);
                    }}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </NotificationContext.Provider>
  );
}

export function useNotify(): NotificationContextValue {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotify must be used within NotificationProvider');
  return ctx;
}
