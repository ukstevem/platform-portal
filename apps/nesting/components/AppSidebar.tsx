"use client";

import { SidebarUser } from "@platform/auth/SidebarUser";
import { Sidebar } from "@platform/ui";

export function AppSidebar() {
  return (
    <Sidebar
      appLabel="Beam Nesting"
      logoSrc="/nesting/pss-logo-reversed.png"
      navSections={[
        {
          heading: "Nesting",
          items: [
            { label: "New Job", href: "/nesting/" },
            { label: "History", href: "/nesting/history" },
          ],
        },
      ]}
      userSlot={<SidebarUser />}
    />
  );
}
