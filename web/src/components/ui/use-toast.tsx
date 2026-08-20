import * as React from 'react';
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from './toast';

type Variant = 'default' | 'destructive' | 'success';

interface ToastItem {
  id: number;
  title: string;
  description?: string;
  variant: Variant;
}

interface ToastContextValue {
  toast: (input: { title: string; description?: string; variant?: Variant }) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

let nextId = 1;

export function Toaster({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);

  const dismiss = React.useCallback((id: number) => {
    setItems((current) => current.filter((t) => t.id !== id));
  }, []);

  const toast = React.useCallback<ToastContextValue['toast']>(({ title, description, variant }) => {
    const id = nextId++;
    setItems((current) => [...current.slice(-3), { id, title, description, variant: variant ?? 'default' }]);
  }, []);

  const value = React.useMemo<ToastContextValue>(
    () => ({
      toast,
      success: (title, description) => toast({ title, description, variant: 'success' }),
      error: (title, description) => toast({ title, description, variant: 'destructive' }),
    }),
    [toast]
  );

  return (
    <ToastContext.Provider value={value}>
      <ToastProvider swipeDirection="right" duration={5000}>
        {children}
        {items.map((item) => (
          <Toast
            key={item.id}
            variant={item.variant}
            onOpenChange={(open) => {
              if (!open) dismiss(item.id);
            }}
          >
            <div className="grid gap-1">
              <ToastTitle>{item.title}</ToastTitle>
              {item.description ? (
                <ToastDescription className="break-words">{item.description}</ToastDescription>
              ) : null}
            </div>
            <ToastClose />
          </Toast>
        ))}
        <ToastViewport />
      </ToastProvider>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <Toaster>');
  return ctx;
}
