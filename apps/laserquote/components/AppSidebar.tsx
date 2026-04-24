"use client";

import { SidebarUser } from "@platform/auth/SidebarUser";
import { Sidebar } from "@platform/ui";

export function AppSidebar() {
  return (
    <Sidebar
      appLabel="Laser Quote"
      logoSrc="/laserquote/pss-logo-reversed.png"
      navSections={[
        {
          heading: "Quoting",
          items: [
            { label: "Import", href: "/laserquote/" },
            { label: "Quotes", href: "/laserquote/quotes" },
            { label: "Production", href: "/laserquote/production" },
            { label: "History", href: "/laserquote/history" },
            { label: "Library", href: "/laserquote/programs" },
          ],
        },
        {
          heading: "Machine",
          items: [
            { label: "Mazak", href: "/laserquote/mazak" },
          ],
        },
        {
          heading: "Admin",
          items: [
            { label: "Rates & Settings", href: "/laserquote/settings" },
          ],
        },
      ]}
      userSlot={<SidebarUser />}
    />
  );
}
