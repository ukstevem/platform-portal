# PSS Design System — Usage Guide

How to consume the PSS design system inside a platform app. Intended audience: app developers building or maintaining a Next.js app inside `platform-portal/apps/*` or a standalone `pss-*` repo.

> **Status:** stub. This file will be filled in once Claude Design produces the system. Until then, it documents the **target shape** so you can plan migrations and so Claude Design knows what the consumer-facing doc should look like.

---

## Quick start (target shape)

In your app's `globals.css`:

```css
@import "tailwindcss";
@source "../../../packages/ui";
@source "../../../packages/auth";

@import "@platform/ui/tokens.css";     /* CSS variables — light + dark */
@import "@platform/ui/theme.css";      /* Tailwind v4 @theme inline */
@import "@platform/ui/platform.css";   /* component CSS layer */
```

In your `app/layout.tsx`:

```tsx
import { Montserrat } from "next/font/google";
import { ThemeProvider } from "@platform/ui";

const montserrat = Montserrat({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-montserrat",
});

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={montserrat.variable} suppressHydrationWarning>
      <body>
        <ThemeProvider defaultTheme="light">{children}</ThemeProvider>
      </body>
    </html>
  );
}
```

---

## Theming

The system ships two themes selected by `data-theme` on `<html>`:

- `data-theme="light"` — desk-app default
- `data-theme="dark"` — kiosk / immersive default

`ThemeProvider` handles persistence (localStorage) and route-based forcing (`?kiosk=true` or `/kiosk/*` paths force dark). User toggle lives in the sidebar.

To force a theme on a specific route or component, set `data-theme` on the nearest wrapping element — tokens cascade.

```tsx
<section data-theme="dark" className="bg-[var(--surface-page)]">…</section>
```

---

## Tokens, not hex codes

Never write a hex value inside a component. Reach for a token:

```tsx
// ❌
<div className="text-[#061b37]">…</div>

// ✅
<div className="text-[var(--text-primary)]">…</div>

// ✅ (preferred — Tailwind utility wired to the token)
<div className="text-fg">…</div>
```

The token catalogue lives in `packages/ui/tokens.css`. The Tailwind utility names that wrap them live in `packages/ui/theme.css`. The Storybook (`/styleguide`) renders the live values in both themes.

---

## Common recipes

> _Filled in once Claude Design has shipped components. Each recipe will show the correct component import, the props, and the rendered look in both themes._

- **Page shell** — `LayoutShell` + `Sidebar` + `PageHeader`
- **Form page** — `Field`, `Input`, `Select`, `Button`
- **Data table page** — `DataTable` with `StatusDot` cells
- **Dashboard page** — `Stat` row + `Card` + `DataTable`
- **Kiosk page** — `KioskFrame`, dark theme forced
- **Empty / error / loading states** — `EmptyState`, `Alert`, `Spinner` / `PageLoading`

---

## Components

> _List populated by Claude Design._ Every component is exported from `@platform/ui`. Refer to the Storybook (`/styleguide`) for live examples and prop tables.

**Existing (restyled, API stable):** `Sidebar`, `PageHeader`, `LayoutShell`, `Alert`, `EmptyState`, `Spinner`, `PageLoading`.

**New:** `Button`, `Input`, `Field`, `Select`, `Checkbox`, `Switch`, `Card`, `Stat`, `DataTable`, `Tabs`, `Toast`, `Dialog`, `Drawer`, `Tooltip`, `Breadcrumb`, `StatusDot`, `KioskFrame`, `Hero`, `AppCard`, `ThemeProvider`, `useTheme`.

---

## Migration notes

> _Filled in once Claude Design has shipped._ Will list:

- Existing classes that still work (`pss-btn`, `pss-btn-outline`, `badge-*`, `alert-*`, `pss-sidebar`, `pss-accent-bar`, `pss-toggle-active`, `platform-spinner`)
- Classes that are deprecated (preferred component instead)
- Anything removed (none expected)

---

## Accessibility

The system targets WCAG AA in both themes. Specific to PSS:

- **Kiosk views** must be readable at ~3m. Body text on kiosk surfaces ≥18px, headlines ≥32px.
- **Status colour** is never the only signal — pair with an icon, label, or position.
- **Reduced motion** is honoured automatically — token-driven durations collapse to instant when `prefers-reduced-motion` is set.

---

## Need to extend the system?

If you find yourself reaching for a hex code or composing a one-off component three apps in a row, **lift it into `@platform/ui`** rather than copy-pasting. File an issue tagged `design-system` and link the use-cases.
