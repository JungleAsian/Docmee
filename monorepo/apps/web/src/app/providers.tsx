"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { PwaRegister } from "../components/app-shell/pwa-register";
import { MswProvider } from "../mocks/MswProvider";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
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
      </QueryClientProvider>
    </MswProvider>
  );
}
