"use client";

import { SidebarUser } from "@platform/auth/SidebarUser";
import { Sidebar } from "@platform/ui";

export function AppSidebar() {
  return (
    <Sidebar
      appLabel="Timesheets"
      logoSrc="/timesheets/pss-logo-reversed.png"
      navSections={[
        {
          heading: "Timesheets",
          items: [
            { label: "Weekly Entry", href: "/timesheets/" },
            { label: "Project Hours Report", href: "/timesheets/reports/" },
            { label: "Wage Preparation", href: "/timesheets/wages/" },
          ],
        },
      ]}
      userSlot={<SidebarUser />}
    />
  );
}
