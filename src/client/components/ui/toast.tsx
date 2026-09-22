import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * App-wide toast notifications — a tiny self-contained store + renderer.
 * No external dependency: components import `toast` and call
 * `toast.success("Saved")` / `toast.error("…")` / `toast.info("…")` /
 * `toast.promise(promise, { loading, success, error })`, and the single
 * <Toaster /> mounted in the app shell renders the stack.
 *
 * Toasts auto-dismiss after 4s (errors after 6s), stack bottom-right,
 * animate in/out, and are instantly disabled by the app's reduced-motion
 * setting (the global `.a11y-reduce-motion` block overrides the keyframes).
 */

export type ToastTone = "success" | "error" | "info" | "loading";

export interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
  /** Errors linger; successes go quickly. */
  duration: number;
  leaving?: boolean;
}

type Listener = (toasts: ToastItem[]) => void;

let toasts: ToastItem[] = [];
const listeners = new Set<Listener>();
let nextId = 1;

function emit() {
  for (const l of listeners) l([...toasts]);
}

function push(tone: ToastTone, message: string, duration?: number): number {
  const id = nextId++;
  const d = duration ?? (tone === "error" ? 6000 : tone === "loading" ? 30_000 : 4000);
  toasts = [...toasts, { id, tone, message, duration: d }];
  // Cap the stack so a burst of actions can't flood the screen.
  if (toasts.length > 5) toasts = toasts.slice(-5);
  emit();
  return id;
}

function dismiss(id: number) {
  // Play the exit animation first, then drop from the store.
  toasts = toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t));
  emit();
  window.setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, 200);
}

export const toast = {
  success: (message: string, duration?: number) => push("success", message, duration),
  error: (message: string, duration?: number) => push("error", message, duration),
  info: (message: string, duration?: number) => push("info", message, duration),
  loading: (message: string) => push("loading", message),
  dismiss,
  /** Swap a loading toast for its result. */
  resolve: (id: number, tone: "success" | "error", message: string) => {
    toasts = toasts.map((t) =>
      t.id === id ? { ...t, tone, message, duration: tone === "error" ? 6000 : 4000, leaving: false } : t,
    );
    emit();
    window.setTimeout(() => dismiss(id), tone === "error" ? 6000 : 4000);
  },
  /** Track a promise: shows loading → success/error with the given messages. */
  promise: <T,>(
    p: Promise<T>,
    msgs: { loading: string; success: string; error?: string },
  ): Promise<T> => {
    const id = push("loading", msgs.loading);
    return p
      .then((v) => {
        toast.resolve(id, "success", msgs.success);
        return v;
      })
      .catch((err) => {
        toast.resolve(id, "error", msgs.error ?? (err as Error).message);
        throw err;
      });
  },
};

const TONE_STYLE: Record<ToastTone, { icon: typeof Info; classes: string; iconClasses: string }> = {
  success: {
    icon: CheckCircle2,
    classes: "border-emerald-300/60 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/90 dark:text-emerald-100",
    iconClasses: "text-emerald-600 dark:text-emerald-400",
  },
  error: {
    icon: AlertTriangle,
    classes: "border-rose-300/60 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-950/90 dark:text-rose-100",
    iconClasses: "text-rose-600 dark:text-rose-400",
  },
  info: {
    icon: Info,
    classes: "border-sky-300/60 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950/90 dark:text-sky-100",
    iconClasses: "text-sky-600 dark:text-sky-400",
  },
  loading: {
    icon: Loader2,
    classes: "border-border bg-card text-card-foreground",
    iconClasses: "text-muted-foreground animate-spin",
  },
};

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>(toasts);

  useEffect(() => {
    listeners.add(setItems);
    return () => {
      listeners.delete(setItems);
    };
  }, []);

  // Timers for auto-dismiss live here so the store stays plain data.
  useEffect(() => {
    const timers = items
      .filter((t) => !t.leaving && t.tone !== "loading")
      .map((t) => window.setTimeout(() => dismiss(t.id), t.duration));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [items]);

  return (
    <div
      aria-live="polite"
      aria-label="Notifications"
      className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(92vw,380px)] flex-col gap-2 print:hidden"
    >
      {items.map((t) => {
        const style = TONE_STYLE[t.tone];
        const Icon = style.icon;
        return (
          <div
            key={t.id}
            role="status"
            className={cn(
              "toast-in pointer-events-auto flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 shadow-lg backdrop-blur",
              style.classes,
              t.leaving && "toast-out",
            )}
          >
            <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", style.iconClasses)} aria-hidden />
            <span className="min-w-0 flex-1 text-sm leading-snug">{t.message}</span>
            {t.tone !== "loading" && (
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                className="shrink-0 rounded p-0.5 opacity-60 transition-opacity hover:opacity-100"
                aria-label="Dismiss notification"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
