"use client";

import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { PwaRegister } from "../components/app-shell/pwa-register";
import { Toaster } from "../components/toast/toaster";
import { ApiRequestError } from "../lib/api/client";
import { toast } from "../lib/toast";
import { MswProvider } from "../mocks/MswProvider";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        // Surface otherwise-silent mutation failures globally. 409s are handled
        // inline by the screens (slot conflict, gate block), so skip those.
        mutationCache: new MutationCache({
          onError: (error) => {
            if (error instanceof ApiRequestError && error.status === 409) return;
            const message =
              error instanceof ApiRequestError ? error.message : "Algo salió mal";
            toast(message, "error");
          },
        }),
        defaultOptions: {
          queries: { refetchOnWindowFocus: false, retry: 1 },
        },
      }),
  );

  return (
    <MswProvider>
      <QueryClientProvider client={queryClient}>
        <PwaRegister />
        {children}
        <Toaster />
      </QueryClientProvider>
    </MswProvider>
  );
}
