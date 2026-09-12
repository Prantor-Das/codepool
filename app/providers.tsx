"use client";

import type { ReactNode } from "react";
import { QueryProvider } from "@/components/providers/query-provider";
import { ThemeProvider } from "@/components/providers/theme-provider";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      scriptProps={{
        type:
          typeof window === "undefined" ? "text/javascript" : "text/plain",
      }}
    >
      <QueryProvider>{children}</QueryProvider>
    </ThemeProvider>
  );
}
