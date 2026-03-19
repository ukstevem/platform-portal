"use client";

import { SidebarUser } from "@platform/auth/SidebarUser";
import { Sidebar } from "@platform/ui";

export function AppSidebar() {
  return (
    <Sidebar
      appLabel="Document Control"
      logoSrc="/documents/pss-logo-reversed.png"
      navSections={[
        {
          heading: "Documents",
          items: [
            { label: "Dashboard", href: "/documents/" },
            { label: "Upload", href: "/documents/upload" },
          ],
        },
      ]}
      userSlot={<SidebarUser />}
    />
  );
}
