# PSS Platform Portal — Design Brief for Claude Design

**Audience for this document:** Claude Design (Anthropic's design generation tool) and any human designer reviewing alongside it.

**How to use this brief:** Read this file end-to-end before producing anything. The folder it sits in (`design guide/`) contains the locked brand assets — logos in standard and reversed treatments, font guide PDF, and the company icon set. The GitHub repository link supplied alongside this brief is the live codebase the framework will plug into. Concrete file paths in this brief are relative to the repo root.

**Repository:** the Git repo URL is provided to you separately. Treat it as authoritative for current code state. Reference paths in this brief reflect the state at the time of writing; verify before assuming.

**What you are producing:** a complete, drop-in design system — tokens, theming, Tailwind v4 preset, restyled shared components, new pattern library, and a Storybook (or equivalent showcase route) — for the PSS Platform Portal and its constituent apps. Output should be installable into the existing `@platform/ui` workspace package without forcing app-level rewrites.

---

## 1. The product

**Name:** PSS Platform Portal
**Organisation:** Power System Services (PSS) — a UK structural engineering and steel fabrication firm.
**What it is:** an internal monorepo of small Next.js apps stitched together behind an Nginx gateway. Engineers, project managers, workshop staff, and site staff use it to do their jobs.

### App inventory (current, 12 live + planned)

| Route | App | Primary use |
|------|------|-------------|
| `/` | Portal Home | Landing page, app launcher, kiosk launcher |
| `/timesheets/` | Timesheets | Weekly hours entry, project allocation, overtime |
| `/documents/` | Document Control | Drawing & document management |
| `/jobcards/` | Job Cards | Workshop and site work cards |
| `/operations/` | Operations | Project cost: labour, POs, invoices |
| `/scanner/` | QR Scanner | Mobile-friendly barcode/QR scanning, auto-filing |
| `/laserquote/` | Laser Quote | Nesting import, part pricing, quotes; includes a kiosk production view |
| `/assembly/` | Assembly Viewer | 3D STL viewer with assembly tree (Three.js) |
| `/nesting/` | Beam Nesting | CP-SAT optimisation UI for steel beam cutting |
| `/matl-cert/` | Material Certs | Material certificate traceability |
| `/employee-presence/` | Employee Presence | On-site attendance |
| `/orderbook/` | Orderbook | Project intake & lifecycle |
| `/po-analysis/` | PO Analysis | PO vs budget vs supplier spend |

The portal **is** the launcher. Every app shares chrome (sidebar + content area). One app — Laser Production — also has a **kiosk mode** used full-screen on a workshop monitor; expect more kiosk views to follow.

### Use contexts

1. **Desk** — primary. Laptop / 1080p / 1440p, mouse + keyboard, mostly Chrome and Edge on Windows. Long sessions, dense data.
2. **Kiosk** — large, wall-mounted or workshop-floor screens. Glanceable at distance, high contrast, no chrome, no auth UI in the foreground.
3. **Mobile / tablet** — secondary. Scanner is the only app that's mobile-first; Timesheets and Documents are used occasionally on tablets.
4. **3D / specialist** — Assembly Viewer is a Three.js canvas; Nesting renders SVG layouts. The shell stays consistent; the canvas dominates.

---

## 2. Brand non-negotiables

These are locked. Do not propose alternatives; design **around** them.

### Logo

- Primary: `design guide/PSS_Standard_RGB.png` (full-colour on light)
- Reversed: `design guide/PSS_Reversed_RGB.png` (for dark / navy backgrounds)
- Icon-only mark: `design guide/towers icon 16x16.svg` (favicon, app icons, condensed displays)
- The "towers" silhouette in the logo is a brand cue worth amplifying. Subtle decorative use is welcome (e.g. as a faint background motif, divider element, loading affordance) — but never as a substitute for the wordmark.

### Brand colours (locked)

```
PSS Navy   #061b37   primary, brand identity
PSS Sky    #97caeb   secondary, official brand colour
```

These two are the brand. Everything else in the palette is **derived or supporting** and you have latitude to evolve.

### Wordmark

- "Power System Services" is the full company name. "PSS" is the standard short form.
- Internal product name is "Platform Portal" (or just "Portal").

### Typography (locked family)

- **Montserrat** is the brand typeface. Weights in use: 400, 500, 600, 700.
- Already loaded via `next/font/google` in `apps/portal/app/layout.tsx`.
- See `design guide/PSS Font Guide.pdf` for fuller brand-team guidance.
- You may propose a complementary monospace face for code/numerics (e.g. JetBrains Mono, IBM Plex Mono) — call it out explicitly if you do.

---

## 3. Aesthetic direction

The current portal is functional and clean but generic. We want it to **feel like a serious technology product made by an engineering company**. Pragmatic, precise, confident — not flashy, not consumer-soft, not enterprise-dull.

### References

**SpaceX (spacex.com)** — take from it:
- Deep, near-black backgrounds on hero / kiosk / immersive surfaces
- Generous whitespace, big confident type, restrained palette
- Treats data and imagery as the hero; UI chrome recedes
- Sharp edges, thin rules, geometric precision

**NASA (nasa.gov)** — take from it:
- High-contrast information density that still reads cleanly
- Strong, structured grids; clear hierarchy of headings → meta → body
- Mission-status feel: numbers, tags, timestamps, system labels are first-class
- Confident accent colour against neutral surfaces

**Don't take:**
- SpaceX's marketing-site full-bleed video heroes — this is internal tooling, not a product page
- NASA's older mixed iconography or stock-photo grids
- Either site's consumer-marketing copy register

### Mood words

`engineered` · `precise` · `quiet confidence` · `instrument-panel` · `mission-control` · `legible at distance` · `high contrast` · `unflashy`

### Mood words to avoid

`playful` · `friendly` · `pastel` · `rounded-soft` · `consumer` · `gradient-heavy` · `neumorphic`

---

## 4. Theme system: light + dark

Deliver **both themes**. Both are first-class. Pick a default.

- **Light (default for desk apps):** off-white surfaces, deep navy text, navy and refreshed-cyan accents. NASA-leaning. Used by every app's main work surface.
- **Dark (default for kiosk + immersive surfaces):** near-black/very dark navy backgrounds, near-white text, sky-blue and signal-coloured accents. SpaceX-leaning. Used by kiosk views, the Assembly Viewer canvas, sign-in hero, and any future "command centre" screens.
- User-toggleable per browser via a setting in the sidebar; defaults driven by route (`?kiosk=true` or `/kiosk/*` forces dark).
- Implement via CSS custom properties on `[data-theme="light"]` / `[data-theme="dark"]` selectors, with `prefers-color-scheme` honoured when no explicit choice exists.

---

## 5. Design tokens (the deliverable spec)

Output as CSS custom properties on `:root` and `[data-theme]` selectors **and** as a Tailwind v4 `@theme` block (Tailwind v4 is CSS-first; tokens are exposed via `@theme inline` so utility classes pick them up).

### 5.1 Colour

Keep the existing PSS variable names (`--pss-navy`, `--pss-sky`) as **brand tokens** for backwards compatibility. Layer a **semantic token system** on top. Apps should use semantic tokens; only hero/branded surfaces reach for brand tokens directly.

**Brand (keep, do not rename):**

```
--pss-navy        #061b37    locked
--pss-navy-light  #0c2d5a    locked
--pss-navy-dark   #041224    locked
--pss-sky         #97caeb    locked
--pss-sky-light   #d0e8f7    locked
--pss-sky-pale    #e8f3fb    locked
```

**Semantic (you propose — refresh the accents away from sky-pale-everywhere toward something more technical):**

```
--surface-page          page background
--surface-raised        cards, panels
--surface-overlay       modals, popovers, tooltips
--surface-sunken        wells, code blocks, kiosk hero panels
--border-subtle         hairlines between rows
--border-default        card borders, input borders
--border-strong         focus rings, active separators
--text-primary          body and headings
--text-secondary        meta, captions
--text-muted            placeholders, disabled
--text-on-brand         text on navy surfaces
--accent                primary interactive accent (refresh — see below)
--accent-hover
--accent-muted          subtle backgrounds tinted with accent
--focus-ring            keyboard focus
--signal-success        completed, in-spec
--signal-warning        attention, near-threshold
--signal-danger         error, out-of-spec
--signal-info           neutral notice
--signal-neutral        gray status
```

**Accent refresh — your call, with constraints:**
- Must coexist with PSS Navy and PSS Sky without clashing
- Should feel **technical and confident** (think instrument readouts, status LEDs, mission consoles) rather than soft/decorative
- Candidate directions to consider: an electric cyan (e.g. ~#00B8D4 family), a high-signal blue (~#1E88E5 family), or — if you want a bolder NASA-flavoured cue — a controlled use of NASA-red (~#FC3D21) reserved for critical signal only
- Propose **one accent**, not a rainbow. Status colours are separate.

Status palette: provide warm-yellow / orange / green / red / blue / gray that work at WCAG AA against both surface tones in both themes. Existing `.badge-*` classes in `packages/ui/platform.css` are the current set; restyle, don't merely rename.

### 5.2 Typography

Single family: **Montserrat**. Define a **type scale** with `--font-size-*`, `--line-height-*`, `--font-weight-*`, and a small set of named roles:

```
--text-display   hero, kiosk titles
--text-h1
--text-h2
--text-h3
--text-body
--text-body-sm
--text-meta      labels, table headers, metadata
--text-mono      tabular numerics (use feature-settings 'tnum')
```

Use `tabular-nums` for any numeric data (timesheets, costs, quantities). Headings should feel slightly tighter (-0.01em to -0.02em letter spacing). Section labels — uppercase, tracked, small — are part of the look.

If you propose a complementary monospace face, document the import pattern.

### 5.3 Spacing & layout

4px base unit. Token names `--space-0` through `--space-12` mapped to the 4px scale. Provide layout tokens for:

```
--container-max     readable max-width for forms/text (~72ch)
--container-app     standard app content max-width
--container-wide    data-table / dashboard width
--sidebar-width     current sidebar is 13rem / 208px
--header-height
```

### 5.4 Radius

Lean **subtle**. Big rounded corners feel consumer; small radii feel engineered.

```
--radius-sm   2-4px   inputs, badges, chips
--radius-md   4-6px   buttons, cards
--radius-lg   8-10px  modals, large panels
--radius-pill 9999px  status pills
```

### 5.5 Shadow / elevation

Light theme: very low-contrast shadows — prefer borders + tonal surfaces over heavy drop shadows. Dark theme: avoid shadows, lean on surface tone differences and 1px borders.

### 5.6 Motion

```
--duration-instant   80ms     hover, focus
--duration-fast      150ms    state changes
--duration-normal    240ms    panel transitions
--duration-slow      400ms    route transitions, hero reveals
```

Easing tokens: `--ease-out`, `--ease-in-out`, `--ease-spring` (if used). **Honour `prefers-reduced-motion`** — collapse to instant when set.

### 5.7 Iconography

Pick one icon set and stick to it (Lucide, Phosphor, or Heroicons — your call, document why). Stroke weight should match Montserrat's at 1.5–2px. Provide tokens for icon size: `--icon-sm` 16, `--icon-md` 20, `--icon-lg` 24, `--icon-xl` 32.

---

## 6. Component inventory

### 6.1 Existing — restyle, do not rename

These live in `packages/ui/` and are imported via `@platform/ui` across all apps. Keep the public API stable; only the visuals change.

- `Sidebar` — dark navy permanent left rail. Logo + app label at top, nav sections, platform-wide app list, user/sign-out at bottom. **Source:** `packages/ui/Sidebar.tsx`. **Currently:** 208px wide, navy, sky-coloured section headings.
- `PageHeader` — title + subtitle + optional accent bar. **Source:** `packages/ui/PageHeader.tsx`.
- `LayoutShell` — page wrapper around content. **Source:** `packages/ui/LayoutShell.tsx`.
- `Alert` — inline alert banner (error / success / info). **Source:** `packages/ui/Alert.tsx`.
- `EmptyState` — no-data placeholder. **Source:** `packages/ui/EmptyState.tsx`.
- `Spinner` / `PageLoading` — loading affordances. **Source:** `packages/ui/Spinner.tsx`. Currently a CSS keyframe spin; consider a more characterful brand-aware loading mark.
- Badges — `.badge`, `.badge-green`, `-yellow`, `-orange`, `-blue`, `-red`, `-gray`. **Source:** CSS classes in `packages/ui/platform.css`.
- Buttons — `.pss-btn`, `.pss-btn-outline`, `.pss-toggle-active`. **Source:** CSS classes in `packages/ui/platform.css`. Component-ise these into a `Button` React component with variants (`primary`, `secondary`, `ghost`, `danger`) and sizes (`sm`, `md`, `lg`).

### 6.2 New patterns we need

1. **Button** (component, not just CSS class) — variants, sizes, `loading` and `disabled` states, optional leading/trailing icon.
2. **Input / Field / Form group** — label, help text, error text, prefix/suffix slots, sizes. Numeric variant with right-aligned tabular numerics.
3. **Select / Combobox** — keyboard-accessible, themed.
4. **Checkbox / Radio / Switch.**
5. **Card** — surface container, header/body/footer slots.
6. **KPI / Stat card** — big number, label, delta, optional sparkline slot. (Used in Operations, PO Analysis, Orderbook.)
7. **Data table** — dense rows, sticky header, sortable columns, row hover, selection, status badge cells, tabular numerics. Critical: this is half the app surface area.
8. **Tabs** — currently hand-rolled in the portal home; standardise.
9. **Toast** — transient notifications.
10. **Modal / Dialog.**
11. **Drawer / Sheet** — side-loaded detail panes.
12. **Tooltip / Popover.**
13. **Breadcrumb.**
14. **Search input** — global app search shape, with keyboard shortcut hint chip.
15. **Status indicator** — small dot + label (running, idle, error). For kiosk and process states.
16. **Kiosk frame** — full-screen dark layout with title bar, big content slot, optional footer ticker. Used by Laser Production and future kiosks.
17. **Hero panel** — dark, image-or-pattern-backed, used on portal home and sign-in.
18. **App launcher card** — what the portal home grid uses today; refine.
19. **Sign-in screen.**

### 6.3 App-shell layouts

- **Standard app shell** — Sidebar (left) + main content with PageHeader. Used by every app.
- **Kiosk shell** — no sidebar, full-bleed, dark theme forced, no auth chrome.
- **Canvas shell** — sidebar collapses to icon rail; main is a full-bleed canvas (used by Assembly Viewer, future map views).
- **Mobile shell** — sidebar collapses to a top bar with menu drawer (Scanner uses this).

---

## 7. Key screens to design

Produce concrete designs (or detailed Storybook stories) for at least these:

1. **Portal Home — signed in.** Tab bar (Applications / Kiosk Views), grid of app cards. Currently in `apps/portal/app/page.tsx`. Cards should feel like instrument-panel tiles: name, one-line description, optional status dot (online / coming-soon / restricted).
2. **Portal Home — signed out.** Sign-in hero. Currently a simple centred logo + button. Make it the brand's shopfront — dark hero, towers motif, large wordmark, single sign-in CTA.
3. **Standard app dashboard.** Use Operations as a template: KPI row, data table, secondary chart slot.
4. **Form-heavy app page.** Use Timesheets weekly entry as a template: dense grid of inputs, tabular numerics, totals row, save bar.
5. **Data table page.** Use PO Analysis or Orderbook as a template.
6. **Kiosk view.** Use Laser Production (`/laserquote/production/?kiosk=true`) as a template: large queue, big status badges, readable from across the workshop.
7. **3D viewer page.** Use Assembly Viewer: collapsed icon rail, file/tree pane left, full-bleed canvas right, floating toolbar.
8. **Empty state, error state, loading state** — for tables and pages.

---

## 8. Accessibility

- **WCAG AA minimum** for all text and interactive elements in both themes. AAA where it doesn't compromise the look.
- All status colours must remain meaningful when paired with text or an icon — never colour alone.
- Visible, distinct **focus ring** (use `--focus-ring`); never remove outlines without replacement.
- **Keyboard navigation** is required across every component. Document tab order and shortcuts.
- Respect `prefers-reduced-motion` (collapse motion) and `prefers-contrast` (boost border weight).
- Kiosk views must be readable at ~3m distance; minimum body text on kiosk surfaces is 18px, headlines 32px+.
- All controls hit a 40×40px (mouse) / 44×44px (touch) target where possible.
- Provide a colour-blind-friendly status palette (test against deuteranopia and tritanopia).

---

## 9. Tech constraints

- **Next.js 16** (App Router), **React 19**, **TypeScript 5**.
- **Tailwind v4** — CSS-first, configured via `@import "tailwindcss"` and `@theme`, no `tailwind.config.js`. The preset must work in this model.
- **PostCSS** via `@tailwindcss/postcss`.
- **No CSS-in-JS runtime** (no styled-components, no Emotion). Tailwind utilities + tokenised CSS variables only.
- **`next/font`** for typography loading — Montserrat is already wired up; mirror that pattern for any added face.
- **Monorepo:** pnpm workspaces. The shared package is `@platform/ui` at `packages/ui/`. Apps consume it via workspace protocol.
- **Multi-app:** styles must work consistently across 12+ Next.js apps; the same CSS bundle is imported per app.
- **basePath:** each app is mounted at a subpath (`/timesheets/`, `/assembly/`, etc.) by Nginx. Asset URLs in CSS must respect this — prefer relative URLs or document the basePath assumption.
- **No build-time global config files** if avoidable — Tailwind v4's CSS-first model means tokens belong in CSS, not JS config.
- **Storybook** (or equivalent showcase route): host inside the repo at `apps/styleguide/` or `packages/ui/.storybook/`. If Storybook is heavy, an in-repo Next.js route at `/styleguide/` is acceptable.

---

## 10. Deliverables

Produce all of the following:

1. **`packages/ui/tokens.css`** — design tokens as CSS custom properties, with `[data-theme="light"]` and `[data-theme="dark"]` blocks.
2. **`packages/ui/theme.css`** — Tailwind v4 `@theme inline` block exposing tokens to utility classes.
3. **`packages/ui/platform.css`** — refreshed component CSS (replaces the existing file). Keep existing class names (`.pss-btn`, `.badge-*`, `.alert-*`, `.pss-sidebar`, `.pss-accent-bar`) as a compatibility layer that points at new tokens.
4. **Restyled React components** under `packages/ui/` — `Sidebar`, `PageHeader`, `LayoutShell`, `Alert`, `EmptyState`, `Spinner`. Same exports, same props.
5. **New React components** under `packages/ui/` — `Button`, `Input`, `Field`, `Select`, `Checkbox`, `Switch`, `Card`, `Stat`, `DataTable`, `Tabs`, `Toast`, `Dialog`, `Drawer`, `Tooltip`, `Breadcrumb`, `StatusDot`, `KioskFrame`, `Hero`, `AppCard`.
6. **Theme switcher** — small component + a `useTheme` hook that reads/writes `data-theme` on `<html>` and persists to localStorage; honours route-based forcing for kiosk.
7. **Storybook (or `/styleguide` route)** — every component, every variant, every state, in both themes. Include a "Tokens" page that visualises every CSS variable.
8. **Updated `apps/portal/app/page.tsx`** — portal home redesigned to the new system, signed-in and signed-out states.
9. **`design guide/usage.md`** — a short consumer-facing doc: how an app developer adopts the system (import path, theme attribute, common recipes).
10. **A migration note** — what existing classes still work, what's deprecated, what was removed.

Do **not** ship:
- App-specific business logic changes
- Database migrations or backend changes
- Any rename or removal of existing exports from `@platform/ui` (additive only)

---

## 11. Repository file map (for orientation)

```
platform-portal/
├── apps/
│   ├── portal/                  ← the launcher; primary surface to redesign
│   │   ├── app/
│   │   │   ├── globals.css      ← imports tailwind + @platform/ui platform.css
│   │   │   ├── layout.tsx       ← Montserrat + AuthProvider + AppSidebar
│   │   │   └── page.tsx         ← portal home (cards + tabs)
│   │   └── components/
│   │       └── AppSidebar.tsx   ← thin wrapper around @platform/ui Sidebar
│   ├── timesheets/              ← form-heavy reference
│   ├── operations/              ← KPI + table reference
│   ├── laserquote/              ← has kiosk view at /production/?kiosk=true
│   ├── assembly-viewer/         ← Three.js canvas reference
│   ├── nesting/                 ← SVG layout reference
│   ├── documents/  jobcards/  scanner/
│   └── …
├── packages/
│   ├── ui/                      ← THE TARGET — design system lives here
│   │   ├── platform.css         ← current brand + component CSS
│   │   ├── Sidebar.tsx
│   │   ├── PageHeader.tsx
│   │   ├── LayoutShell.tsx
│   │   ├── Alert.tsx
│   │   ├── EmptyState.tsx
│   │   ├── Spinner.tsx
│   │   ├── index.ts             ← barrel
│   │   └── package.json
│   ├── auth/                    ← AuthProvider + AuthButton + SidebarUser
│   └── supabase/
├── design guide/                ← THIS FOLDER
│   ├── design-brief.md          ← this file
│   ├── PSS_Standard_RGB.png     ← logo (light backgrounds)
│   ├── PSS_Reversed_RGB.png     ← logo (dark backgrounds)
│   ├── PSS Font Guide.pdf       ← brand-team typography guidance
│   ├── PSS Logo & Colours.pdf   ← brand-team colour guidance
│   └── towers icon 16x16.svg    ← icon mark
└── docs/
    └── PORTS.md                 ← app routes & ports map
```

---

## 12. Out of scope

- Backend API design, database schema, or anything in Supabase.
- Email templates, PDF templates, generated documents.
- Mobile native apps (none exist).
- Marketing or external website — this is internal only.
- Renaming or restructuring the existing app routes.
- Replacing Montserrat or the navy + sky brand colours.

---

## 13. Acceptance criteria

A delivered system is acceptable when:

- Both light and dark themes render every component at WCAG AA without ad-hoc overrides
- The portal home (signed-in and signed-out) clearly evokes the SpaceX/NASA references while remaining unmistakably PSS-branded
- All existing `@platform/ui` imports continue to compile in every app without changes to consumer code
- A new app developer can read `design guide/usage.md` and ship a themed page in under 30 minutes
- The kiosk view feels readable at 3m on a workshop monitor with no light pollution issues
- Storybook (or `/styleguide`) shows every component in every state in both themes
- No design token is hard-coded as a hex value inside a component file — everything resolves through `var(--…)`

---

## 14. One last thing

The current portal works. Don't break it for cleverness. The win is **a step change in feel** — when someone opens this thing, they should think *"this is built by people who take their craft seriously."* Steel, structure, signal, precision. Quiet confidence over noise.
