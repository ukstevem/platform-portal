"use client";

import { SidebarUser } from "@platform/auth/SidebarUser";
import { Sidebar } from "@platform/ui";

export function AppSidebar() {
  return (
    <Sidebar
      appLabel="Operations"
      logoSrc="/operations/pss-logo-reversed.png"
      navSections={[
        {
          heading: "Operations",
          items: [
            { label: "Project Cost Overview", href: "/operations/" },
            { label: "Earned Value Analysis", href: "/operations/earned-value" },
          ],
        },
      ]}
      userSlot={<SidebarUser />}
    />
  );
}
