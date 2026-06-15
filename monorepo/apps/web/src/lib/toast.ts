/**
 * Minimal toast pub/sub — decoupled from React so it can be called from the
 * TanStack Query MutationCache (outside the component tree). The <Toaster/>
 * subscribes and renders.
 */
export type ToastVariant = "error" | "success" | "info";

export interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
}

type Listener = (toast: ToastItem) => void;

const listeners = new Set<Listener>();
let counter = 0;

export function toast(message: string, variant: ToastVariant = "info"): void {
  counter += 1;
  const item: ToastItem = { id: counter, message, variant };
  listeners.forEach((l) => l(item));
}

export function subscribeToasts(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
