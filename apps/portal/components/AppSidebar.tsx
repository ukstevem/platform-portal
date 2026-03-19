"use client";

import { SidebarUser } from "@platform/auth/SidebarUser";
import { Sidebar } from "@platform/ui";

export function AppSidebar() {
  return (
    <Sidebar
      appLabel="Platform Portal"
      logoSrc="/pss-logo-reversed.png"
      navSections={[
        {
          heading: "Home",
          items: [
            { label: "Dashboard", href: "/" },
          ],
        },
      ]}
      userSlot={<SidebarUser />}
    />
  );
}
