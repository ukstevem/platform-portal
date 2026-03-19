"use client";

import { SidebarUser } from "@platform/auth/SidebarUser";
import { Sidebar } from "@platform/ui";

export function AppSidebar() {
  return (
    <Sidebar
      appLabel="Job Cards"
      logoSrc="/jobcards/pss-logo-reversed.png"
      navSections={[
        {
          heading: "Job Cards",
          items: [
            { label: "Dashboard", href: "/jobcards/" },
          ],
        },
      ]}
      userSlot={<SidebarUser />}
    />
  );
}
