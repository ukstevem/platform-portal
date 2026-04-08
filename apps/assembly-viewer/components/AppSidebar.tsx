"use client";

import { SidebarUser } from "@platform/auth/SidebarUser";
import { Sidebar } from "@platform/ui";

export function AppSidebar() {
  return (
    <Sidebar
      appLabel="Assembly Viewer"
      logoSrc="/assembly/pss-logo-reversed.png"
      navSections={[
        {
          heading: "Viewer",
          items: [
            { label: "Assembly", href: "/assembly/" },
          ],
        },
      ]}
      userSlot={<SidebarUser />}
    />
  );
}
