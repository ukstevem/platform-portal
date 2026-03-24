"use client";

import { SidebarUser } from "@platform/auth/SidebarUser";
import { Sidebar } from "@platform/ui";

export function AppSidebar() {
  return (
    <Sidebar
      appLabel="QR Scanner"
      logoSrc="/scanner/pss-logo-reversed.png"
      navSections={[
        {
          heading: "Scanner",
          items: [
            { label: "Upload", href: "/scanner/" },
            { label: "History", href: "/scanner/history" },
            { label: "Filing Rules", href: "/scanner/rules" },
          ],
        },
      ]}
      userSlot={<SidebarUser />}
    />
  );
}
