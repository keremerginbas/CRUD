import * as React from 'react';
import {AnimatePresence, motion} from 'motion/react';
import {CircleAlert, CircleCheck, X} from 'lucide-react';

type Toast = {id: number; message: string; error: boolean};
let listeners: ((toasts: Toast[]) => void)[] = [];
let toasts: Toast[] = [];
let nextId = 1;
const emit = () => listeners.forEach(listener => listener(toasts));

/** Shows a short status message; errors stay longer. */
export function toast(message: string, error = false) {
  const item = {id: nextId++, message, error};
  toasts = [...toasts.slice(-3), item];
  emit();
  setTimeout(() => dismiss(item.id), error ? 9000 : 5500);
}
function dismiss(id: number) { toasts = toasts.filter(t => t.id !== id); emit(); }

export function Toaster() {
  const [items, setItems] = React.useState<Toast[]>(toasts);
  React.useEffect(() => { listeners.push(setItems); return () => { listeners = listeners.filter(l => l !== setItems); }; }, []);
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[70] flex w-[min(420px,calc(100%-2rem))] flex-col gap-2" role="status" aria-live="polite">
      <AnimatePresence initial={false}>
        {items.map(item => (
          <motion.div key={item.id} layout initial={{opacity: 0, y: 16, scale: 0.97}} animate={{opacity: 1, y: 0, scale: 1}} exit={{opacity: 0, x: 40}} transition={{duration: 0.18}}
            className={`pointer-events-auto flex items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg ${item.error ? 'border-destructive/30 bg-destructive text-white' : 'bg-foreground text-background'}`} data-toast={item.error ? 'error' : 'info'}>
            {item.error ? <CircleAlert className="mt-0.5 size-4 shrink-0" /> : <CircleCheck className="mt-0.5 size-4 shrink-0" />}
            <span className="flex-1 leading-relaxed">{item.message}</span>
            <button type="button" className="opacity-70 hover:opacity-100" onClick={() => dismiss(item.id)} aria-label="Bildirimi kapat"><X className="size-4" /></button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
