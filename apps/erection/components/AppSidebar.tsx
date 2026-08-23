"use client";

import { SidebarUser } from "@platform/auth/SidebarUser";
import { Sidebar } from "@platform/ui";

export function AppSidebar() {
  return (
    <Sidebar
      appLabel="Erection Planner"
      logoSrc="/erection/pss-logo-reversed.png"
      navSections={[
        {
          heading: "Planning",
          items: [{ label: "Models", href: "/erection/" }],
        },
      ]}
      userSlot={<SidebarUser />}
    />
  );
}
