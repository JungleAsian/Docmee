"use client";

import { cn } from "@docmee/ui";
import { useEffect, useState } from "react";
import { subscribeToasts, type ToastItem } from "../../lib/toast";

const DISMISS_MS = 5000;

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    return subscribeToasts((t) => {
      setItems((prev) => [...prev, t]);
      setTimeout(() => {
        setItems((prev) => prev.filter((x) => x.id !== t.id));
      }, DISMISS_MS);
    });
  }, []);

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2"
      role="region"
      aria-live="polite"
    >
      {items.map((t) => (
        <div
          key={t.id}
          role="status"
          className={cn(
            "pointer-events-auto rounded-md border bg-card px-4 py-3 text-sm shadow-md",
            t.variant === "error" && "border-destructive text-destructive",
            t.variant === "success" && "border-success",
            t.variant === "info" && "border-border",
          )}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
