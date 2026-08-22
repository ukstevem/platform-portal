"use client";

import { LayoutShell as BaseLayoutShell } from "@platform/ui";
import { AppSidebar } from "./AppSidebar";
import { ReactNode } from "react";

export function LayoutShell({ children }: { children: ReactNode }) {
  return (
    <BaseLayoutShell sidebar={<AppSidebar />}>
      {children}
    </BaseLayoutShell>
  );
}
