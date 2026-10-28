# CloudLocal — Design System

Captured from project sources. Every value below is quoted from the source path named next to it; nothing is invented.

Sources read:
- `client/src/index.css` (tokens, components, breakpoints, motion)
- `client/tailwind.config.js` (Tailwind is used only for resets/utilities; theme is not extended, so all visual values live in CSS custom properties)
- `client/src/App.tsx`, `client/src/components/*` (component inventory and states)
- `client/public/cloudlocal.svg` (brand logo: gradient `#2563eb` → `#3b82f6` → `#f59e0b` → `#fbbf24` with a white 2.5px outline; it is embedded inline as-is on the dark rail, never recolored)

Archetype: Records / Workflow (file manager). Expression: L2 Characterful utility. Energy: calm precision to quiet execution.

Note on light mode: `:root` defines a neutral base, but `:root:not([data-theme="dark"])` overrides it with the warm cream palette that actually ships. The cream values are the design system; the neutral ones are the base layer.

---

## Colors — light (effective default)

Source: `client/src/index.css` lines 12-72 (`:root` overridden by `:root:not([data-theme="dark"])`).

| Token | Value | Usage |
| --- | --- | --- |
| `--bg` | `#f5f0eb` | App canvas behind all content (cream) |
| `--surface` | `#fdfbf6` | Cards, table, topbar, panels |
| `--text` | `#1a1f2b` | Primary text |
| `--muted` | `#5c6674` | Secondary text, inactive controls |
| `--muted2` | `#687382` | Tertiary text, metadata, placeholders |
| `--line` | `#ddd6cd` | Default borders and dividers |
| `--line2` | `#ece7de` | Row dividers, quiet fills |
| `--line-strong` | `#c4bbae` | Hover borders, stronger separation |

## Colors — sidebar (both themes)

| Token | Value | Usage |
| --- | --- | --- |
| `--sidebar` | `#0b1120` | Sidebar and access-gate background |
| `--sidebar2` | `#131d33` | Secondary sidebar surface |
| `--sidebar-text` | `#94a3b8` | Sidebar labels and icons |
| `--sidebar-active` | `#1e293b` | Active nav item background |
| `--sidebar-hover` | `#1a2640` | Nav hover background |

**Effective light rail** (`client/src/index.css`, light override and `.rail`): `--sidebar:#122a27`, `--sidebar2:#16332f`, `--sidebar-hover:#17332f`, `--sidebar-active:#1c3a36`; rail icons use `#8b9dab`. Dark mode uses the dark-theme sidebar tokens.

## Colors — accent (teal, "chosen and committed")

| Token | Value | Usage |
| --- | --- | --- |
| `--accent` | `#0d9488` | Primary actions, links, active states, focus ring |
| `--accent2` | `#14b8a6` | Hover of primary actions, dark-mode accent |
| `--accent3` | `#5eead4` | Gradient highlights (access panel top rail) |
| `--accent-bg` | `rgba(13,148,136,0.06)` | Tinted hover background, selected rows |
| `--accent-hover` | `rgba(13,148,136,0.12)` | Stronger tinted hover |
| `--accent-light` | `rgba(13,148,136,0.04)` | Faintest tint (grid hover, notice bar) |

## Colors — danger and status

| Token | Value | Usage |
| --- | --- | --- |
| `--danger` | `#dc2626` | Destructive actions, errors |
| `--danger-bg` | `rgba(220,38,38,0.05)` | Destructive hover fill, error surface |
| `--danger-hover` | `rgba(220,38,38,0.10)` | Destructive hover |
| `#10b981` | status dot / done | Online pulse, upload done |
| `#d97706` | paused | Upload paused |
| `#f59e0b` | warning rail | Environment warning |

## Sidebar and status text (source values)

Also present in `client/src/index.css`; they are real UI colors, not accents.

| Value | Usage |
| --- | --- |
| `#f1f5f9` | Sidebar wordmark and active nav label |
| `#475569` | Sidebar caption and storage footnote |
| `#6ee7b7` | Sidebar server-status text |
| `#10b981` | Status dot, upload-done rail |
| `#f87171` | Error text on dark surfaces |
| `#fafbfc` | Neutral `:root` base background (superseded by the cream override) |
| `#0891b2` | Image tint hue (`rgba(8,145,178,...)` plates) |
| `#16a34a` | Spreadsheet tint hue (`rgba(22,163,74,...)` plates) |
| `#7c3aed` | Code tint hue (`rgba(139,92,246,...)` plates) |

## Derived inks for type plates

Each file-type plate keeps the hue the system documents (`rgba` tint per type). The icon ink is that same hue pushed for AA contrast on the plate, in both themes. These are derived, not new tokens; an artboard may use only these:

| Type | Light ink | Dark ink |
| --- | --- | --- |
| pdf / danger | `#b91c1c` | `#fca5a5` |
| sheet / excel | `#15803d` | `#6ee7b7` |
| word / document | `#1d4ed8` | `#93c5fd` |
| code / archive | `#7c3aed` | `#fde047` |
| image | `#0891b2` | `#a5f3fc` |
| video | `#0d9488` | `#99f6e4` |
| paused | `#b45309` | `#fbbf24` |

Imagery placeholders (photo and video previews, aurora gradients) are content, not UI color: they may use free gradients because they stand in for a real file, and they are never applied to controls, text surfaces or chrome.

One documented adjustment: artboards rendered in dark mode lift `--muted2` from `#64748b` to `#8b9bb0` for metadata text, because the product value falls below WCAG AA (4.5:1) on `#141b2d`. The product token in `client/src/index.css` is unchanged; the lift is a presentation-level correction for the design boards.

## Colors — dark theme

Source: `client/src/index.css` lines 1653-1675 (`[data-theme="dark"]`).

| Token | Value |
| --- | --- |
| `--bg` | `#0b0f19` |
| `--surface` | `#141b2d` |
| `--text` | `#e2e8f0` |
| `--muted` | `#94a3b8` |
| `--muted2` | `#64748b` |
| `--line` | `#1e293b` |
| `--line2` | `#162032` |
| `--line-strong` | `#2d3a4f` |
| `--sidebar-hover` | `#1a2332` |
| `--sidebar-active` | `#222d3e` |

Dark keeps the same teal accent family (`--accent2` as the live accent) and inverts surface/bg so `--bg` is deeper than `--surface`.

## Typography

Source: `client/src/index.css` line 82 and type rules throughout.

- UI family: `'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`
- Inter is self-hosted now: `client/public/fonts/inter-latin.woff2` and `inter-latin-ext.woff2` (variable 400-700, latin and latin-ext subsets) are declared with `@font-face` and `font-display: swap` at the top of `client/src/index.css`. Source is Google Fonts v20; nothing is fetched at runtime, so the app keeps working on a LAN without internet. The boards keep system fallbacks because they must stay self-contained, so their glyphs can differ slightly from the app.
- Data family (dates, sizes, hex, shortcuts): `'SF Mono', 'Cascadia Code', 'Fira Code', monospace`
- Base line-height 1.5; body antialiased.

Documented scale (size / weight / letter-spacing / usage):

| Size | Weight | Tracking | Usage |
| --- | --- | --- | --- |
| 2rem | 700 | -.03em | Page title (`.page-title`) |
| 1.15rem | — | — | Sidebar logo / brand |
| 1.08rem | 700 | -.02em | Sidebar wordmark |
| 1.05rem | — | — | Card header icon glyph |
| .95rem | 700 | -.015em | Card h2 |
| .92rem | 700 | -.01em | Settings h2 |
| .88rem | 700 | — | Card h3, folder form heading |
| .85rem | 600/700 | — | Access submit, upload card h3 |
| .83rem | 500 | — | Sidebar nav item |
| .82rem | 400-500 | — | Body copy, table rows, inputs |
| .80rem | 500-600 | — | Selection bar, logout |
| .78rem | 500-600 | — | Buttons, labels, chips, subtitles |
| .76rem | 500-600 | — | Dense buttons, upload text |
| .72rem | 600 | — | Breadcrumb, details column (mono) |
| .70rem | 500 | — | Sidebar status, upload badges |
| .68rem | 700 | .10em + uppercase | Access eyebrow |
| .65rem | 600 | .04em | Table head labels |
| .62rem | 700 | .12em + uppercase | Sidebar caption, shortcut hint (mono) |

Rule: hierarchy comes from weight and tracking more than from size; sizes stay inside .62rem to 2rem.

## Spacing

No spacing tokens exist; observed rhythm (from `client/src/index.css`):

- App shell: icon rail `64px`, fluid main column; selected items add a `344px` inspector on wide screens (`client/src/index.css`, `.app-shell`).
- Page padding: `1.25rem 1.75rem 3rem` (workspace), `1rem 1.25rem 3rem` at <=1024px, `.65rem .5rem` at <=768px.
- Card padding: `1rem 1.15rem`; compact card ` .75rem 1rem`.
- Topbar padding: `.85rem 1.5rem`; `.45rem .5rem` on mobile, sticky at top.
- Table: columns `32px | minmax(0,1fr) | 260px | 100px`, gap `1rem`, row padding `.5rem 1.2rem`.
- Grid: `repeat(auto-fill, minmax(125px, 1fr))`, gap `.85rem`.
- Gaps: `.15rem` inside icon clusters, `.3rem-.4rem` between toolbar controls, `.55rem-.65rem` between related rows, `1rem` between cards, `1.25rem` between toolbar and table.

## Radius

Source: `client/src/index.css` lines 48-51.

| Token | Value | Usage |
| --- | --- | --- |
| `--radius-sm` | `5px` | Buttons, nav items, inputs, chips |
| `--radius` | `8px` | Search, selection bar, grid items, cards' inner blocks |
| `--radius-lg` | `12px` | Cards, settings panel, upload box |
| `--radius-xl` | `16px` | Access panel, preview modal, drag overlay |

Pills use `20px` (`.upload-warning`) and `50%` (status dots, toggle thumbs).

## Shadows

Source: `client/src/index.css` lines 53-59; light-specific layered overrides exist for cards, topbar and search.

| Token | Value |
| --- | --- |
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,.035), 0 1px 1px rgba(0,0,0,.025)` |
| `--shadow` | `0 1px 3px rgba(0,0,0,.04), 0 1px 2px rgba(0,0,0,.03)` |
| `--shadow-md` | `0 4px 12px rgba(0,0,0,.06), 0 2px 4px rgba(0,0,0,.03)` |
| `--shadow-lg` | `0 10px 30px rgba(0,0,0,.08), 0 4px 8px rgba(0,0,0,.04)` |
| `--shadow-sm-accent` | `0 1px 3px rgba(13,148,136,.08)` |

Rule: elevation is whisper-quiet in light mode; dark mode raises opacity instead of adding blur. Cards rely on border plus shadow, never on shadow alone.

## Motion

Source: `client/src/index.css` lines 60-63 and 1850-1861.

- `--ease: cubic-bezier(0.4, 0, 0.2, 1)`, `--duration: 150ms`, `--duration-slow: 250ms`.
- Micro-interactions: hover tint + `translateY(-1px)` on primary buttons, `scale(.98)` on press.
- Entrances: `slideUp` (selection bar), `toastIn` (notice), `preview-in` (scale .92 → 1), `access-panel-in`.
- `@media (prefers-reduced-motion: reduce)` collapses every animation and transition to `.01ms`.

## Component rules

Source: `client/src/index.css` component blocks; markup inventory from `client/src/App.tsx` and `client/src/components/*`.

- **Rail** (`client/src/index.css`, `.rail`, `.rbtn`): sticky full-height 64px icon rail with 40px controls and `--radius` corners. Active controls use `--sidebar-active`, `--accent3` and a 3px teal marker; hover and focus reveal tooltips.
- **Topbar**: sticky, surface background, 1px `--line` bottom border, whisper shadow. Left cluster stacks breadcrumb over page title and subtitle; right cluster holds outlined icon buttons plus one teal primary.
- **Buttons**: `.btn-icon` outlined (`--line`), `.78rem/500`, radius `--radius-sm`, hover tints to accent. `.btn-primary` / `.btn-upload` teal fill, white text, `.78rem/600`, hover lifts 1px with `0 2px 8px rgba(13,148,136,.25)`. `.btn-ghost` text-only, hover turns danger. `.btn-danger` outlined danger that inverts to solid on hover. `.btn-action` is icon-only `28x28`.
- **Focus**: `:focus-visible` = `2px solid var(--accent)` with `2px` offset, globally; inside the view toggle the ring sits at `-2px`. Never remove it.
- **Search**: surface input, radius `--radius`, `.82rem`, right-side clear button; focus = accent border plus `0 0 0 3px rgba(13,148,136,.1)` halo.
- **Table**: header row `.65rem/600` with `.04em` tracking on `--muted2`, 1px `--line` bottom border; rows separated by `--line2` hairlines with faint vertical column ticks; hover fills `rgba(13,148,136,.02)`; drag target adds a 2.5px teal left edge.
- **Grid**: item `--surface` on a transparent border `1.5px`, radius `--radius`, hover lifts 2px with border + shadow, selected turns accent border with a 1px accent ring and one-time pulse. Icons sit in a 58px rounded tinted plate, one gradient tint per file type (folder, pdf, image, video, audio, word, excel, powerpoint, archive, code, text, unknown).
- **Selection bar**: gradient from `rgba(13,148,136,.03)` to surface, accent border at 10%, count in accent `.8rem/600`, action buttons outlined `.76rem`, enters with `slideUp`.
- **Cards**: surface + 1px `--line` + `--radius-lg`; accent and upload variants add a faint top-down teal gradient. Hover raises to `--shadow` and `--line-strong`.
- **Badges/chips**: `.62rem` mono for shortcut hints, `.65rem/600` for disk badge, pill radius `20px` for upload warnings; all tinted, never saturated.
- **Notice / error**: notice = `--accent-light` fill with 12% accent border; error = `--danger-bg` with danger text; both `.78rem` and radius `--radius`.
- **Access gate**: full-bleed `--sidebar` stage with a soft radial teal glow; `400px` max panel, radius `--radius-xl`, 3px teal-to-mint top rail, teal full-width submit, `.68rem` uppercase eyebrow.
- **Preview modal**: surface, `min(820px, 100% - 2rem)`, radius `--radius-xl`, heavy soft shadow, `preview-in` entrance, media capped at `70vh`.
- **Move dialog** (`client/src/index.css`, `.move-dialog`, `.move-browser`, `.move-list`): surface with `--radius-xl`; the destination breadcrumb uses `--bg` and `--line`, folder rows use the accent for icons and hover, and the footer pairs the destination summary with cancel and a primary action. The footer stacks at 520px.
- **Upload queue**: per-item 3px left status rail (teal uploading, amber paused, red error, green done), 4px gradient progress bar, mono progress text at `.68rem`.

## Layout and breakpoints

Source: `client/src/index.css` lines 1773-1850.

- Shell: `grid-template-columns: 64px minmax(0, 1fr)`; with an inspector on wide screens, add `344px`. The rail is sticky and `100vh`.
- `<=1024px`: table drops the details column (`32px | minmax(80px,1fr) | 100px`), padding tightens.
- `<=768px`: the icon rail remains at `64px`; the inspector changes to the responsive presentation in `client/src/index.css`. The toolbar wraps, and gallery tiles use a smaller image plate.
- `<=480px`: 3-column grid, `.66rem` names, sidebar 260px.

## Accessibility contract

Source: same file.

- Skip link, landmarks, ARIA roles on interactive surfaces.
- Visible `:focus-visible` on every control.
- Metadata never encoded by color alone in text contexts (labels accompany status dots).
- `@media (forced-colors: active)` provides Highlight/HighlightText fallbacks for selection and active toggles.
- `prefers-reduced-motion` collapses motion.
