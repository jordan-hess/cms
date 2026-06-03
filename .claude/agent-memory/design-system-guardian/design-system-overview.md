---
name: design-system-overview
description: Complete design system snapshot for care-cms — styling methodology, color tokens, spacing conventions, typography, component patterns
metadata:
  type: project
---

## Styling Methodology

Tailwind CSS v4 (imported via `@import "tailwindcss"` in globals.css). No tailwind.config.ts — configuration is done inline via `@theme` in globals.css. Class-based dark mode using `.dark` on `<html>` (not `prefers-color-scheme`). Custom variant: `@variant dark (&:where(.dark, .dark *))`.

## Font System

- Root layout: `Inter` from Google Fonts via `next/font/google` (`inter.className` applied to `<body>`)
- globals.css: `--font-sans: var(--font-geist-sans)` and `--font-mono: var(--font-geist-mono)` defined in `@theme inline` — but Geist is NOT actually imported in the root layout. The body uses Inter. This is a latent inconsistency.
- globals.css also sets `font-family: Arial, Helvetica, sans-serif` on `body` — this is overridden by inter.className but represents dead code.

## Color System (Tailwind defaults, no custom tokens)

Brand/accent: `blue-600` (#2563eb) for primary actions, active states, focus rings.
All color usage draws from Tailwind's default palette — no custom design tokens.

### Semantic surface palette
| Surface | Light | Dark |
|---|---|---|
| App shell background | `bg-gray-50` | `dark:bg-gray-950` |
| Card/panel | `bg-white` | `dark:bg-gray-900` |
| Sidebar | `bg-gray-900` (always dark) | — |
| Input background | `bg-white` | `dark:bg-gray-800` |
| Subtle row hover | `hover:bg-gray-50` | `dark:hover:bg-gray-800/40` |
| Table dividers | `divide-gray-50` | `dark:divide-gray-800` |
| Card borders | `border-gray-100` | `dark:border-gray-800` |
| Input borders | `border-gray-300` | `dark:border-gray-700` |
| Header border | `border-b border-gray-200` | `dark:border-gray-700` |
| Header bg | `bg-white` | `dark:bg-gray-900` |

### Status/semantic colors (badge system)
- **success**: `bg-green-100 text-green-700` (dark: `dark:bg-green-900/40 dark:text-green-400`)
- **warning/pending**: `bg-amber-100 text-amber-700` or `bg-yellow-100 text-yellow-700`
- **danger/urgent**: `bg-red-100 text-red-700` (dark: `dark:bg-red-900/40 dark:text-red-400`)
- **info**: `bg-blue-100 text-blue-700` (dark: `dark:bg-blue-900/40 dark:text-blue-400`)
- **default/gray**: `bg-gray-100 text-gray-700` (dark: `dark:bg-gray-800 dark:text-gray-400`)
- **orange/high**: `bg-orange-100 text-orange-700` (dark: `dark:bg-orange-900/40 dark:text-orange-400`)
- **purple**: `bg-purple-100 text-purple-700` (dark: `dark:bg-purple-900/30 dark:text-purple-400`)

### Team color tokens (lib/roster/teamColors.ts)
Green, Blue, Red, Yellow — each has: `bg`, `text`, `border`, `dot`, `lightBg` variants, all with dark counterparts.

## Spacing Scale

- Page padding: `p-6`
- Card padding: `px-5 py-4` (list rows) or `p-5` (stat cards)
- Card header: `px-5 py-4`
- Modal padding: `px-6 py-4` (header), `p-6` (body)
- Form field vertical gap: `space-y-4`
- Section gap: `space-y-6` or `gap-6`
- Icon-text gap: `gap-3` (standard), `gap-2` (compact), `gap-1.5` (tight)
- Button padding: `px-4 py-2.5` (standard), `px-3 py-2` (small), `px-3 py-1.5` (compact)

## Typography Hierarchy

- Page title (Header h1): `text-xl font-semibold text-gray-900 dark:text-white`
- Section heading (h2 in cards): `font-semibold text-gray-900 dark:text-white` (no explicit size = base/16px)
- Card body text: `text-sm text-gray-700 dark:text-gray-300`
- Secondary/meta text: `text-xs text-gray-500 dark:text-gray-400`
- Tertiary/faint text: `text-xs text-gray-400 dark:text-gray-500`
- Stat value: `text-3xl font-bold text-gray-900 dark:text-white`
- Table header: `text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide`
- Section label (sidebar): `text-xs font-semibold text-gray-500 uppercase tracking-wider`
- Label (form): `text-sm font-medium text-gray-700 dark:text-gray-300`

## Component Patterns

### Cards / Panels
`bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-800`

### List rows
`divide-y divide-gray-50 dark:divide-gray-800` with `hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors`

### Stat cards (dashboard)
`bg-white dark:bg-gray-900 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-800 hover:shadow-md transition-shadow`

### Primary button
`bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium px-4 py-2.5 rounded-lg transition-colors`

### Secondary/outline button
`text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-colors`

### Danger button
`bg-red-600 hover:bg-red-700 text-white` (used in EscalationManager)

### Icon-only action button
`p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors`

### Segmented filter tabs
`bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-1` with children `px-3 py-1.5 rounded-md text-xs font-medium` — active: `bg-blue-600 text-white`

### Modal base (components/ui/Modal.tsx)
`fixed inset-0 z-50 flex items-center justify-center p-4` overlay `bg-black/40`, card `bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh]`

### Badge (components/ui/Badge.tsx)
`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium` — 6 variants (default, success, warning, danger, info, purple). NOTE: Badge component is rarely used directly; inline badge classes are more common.

### Form inputs (shared constants)
`inputCls = 'w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none'`
`labelCls = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'`

### Avatar/initials
`w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-sm font-semibold text-white` — varies between w-8/w-9/w-10

### Loading spinner
`<Loader2 className="w-4 h-4 animate-spin" />` from lucide-react — no custom spinner

## Responsive Strategy

No explicit breakpoints configured. Uses Tailwind defaults:
- Dashboard stats: `grid-cols-2 lg:grid-cols-4`
- Admin stats: `grid-cols-2 lg:grid-cols-3`
- Dashboard panels: `grid-cols-1 lg:grid-cols-2`
- No mobile-specific nav (no hamburger, sidebar always renders)
- Roster WeekView: `overflow-x-auto` with `min-w-[700px]` table

## Animation / Transition Patterns

- All interactive elements use `transition-colors` (Tailwind CSS transition)
- Hover shadow on stat cards: `transition-shadow`
- Loading spinner: `animate-spin` (Tailwind built-in)
- **Anime.js v4.4.1 is installed** — see [[animation-patterns]] for v4 API, import patterns, and established motion patterns
- Side panels (RequestsPanel, RequestReviewDrawer) use `animate(el, { translateX: [60,0], opacity: [0,1], ... })` entrance

## New Component Patterns (Requests feature)

### Side panel (dark, right-edge)
The Requests panel and Review drawer use a dark-themed side panel pattern:
- `bg-gray-900 border-l border-gray-800` (always dark, distinct from main content)
- Width: `w-full sm:w-[480px]` (full mobile, fixed desktop)
- Overlay: `bg-black/40` with fade-in, closes on click
- Entrance: `translateX: [60, 0], opacity: [0, 1], duration: 280ms, easeOutQuart`

### Panel header section
`flex items-center justify-between px-5 py-4 border-b border-gray-800` — matches existing card header pattern but for dark panels

### Panel tab switcher (inside dark panel)
`flex items-center border border-gray-700 rounded-lg overflow-hidden` with active tab `bg-blue-600 text-white`

### Dark panel inputs
`w-full px-3 py-2 border border-gray-700 rounded-lg text-sm bg-gray-800 text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none`

### Success state overlay
Form fades out (`opacity: [1,0]`), then `CheckCircle` icon bounces in (`scale: [0.7,1], easeOutBack`), auto-dismisses after 1.7s.

### Editable inline table (OT form)
Grid-based table with `grid-cols-[1fr_44px_80px_60px_60px_60px_32px]`, inputs directly in cells, auto-totals row at bottom.

### Badge on toolbar button
Pending count badge: `absolute -top-1.5 -right-1.5 bg-amber-500 text-white text-xs w-4 h-4 flex items-center justify-center rounded-full` — pattern established on Requests button in RosterManager.

### Request status color map
- `pending` → amber (`bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400`)
- `approved` → green (`bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400`)
- `rejected` → red (`bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400`)
- `changes_requested` → blue (`bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400`)
- `draft` → gray (`bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400`)

## Layout Structure

```
html.dark?
  body (h-full bg-gray-50 dark:bg-gray-950)
    (app)/layout.tsx
      div.flex.h-screen (overflow-hidden)
        Sidebar (w-64, always bg-gray-900)
        div.flex-1.flex.flex-col.overflow-hidden
          main.flex-1.overflow-y-auto
            page children
              Header (h-20, bg-white dark:bg-gray-900, border-b)
              div.p-6.space-y-6
                [page content]
```

## Dark Mode Implementation

- Class-based: `document.documentElement.classList.add('dark')`
- ThemeToggle in sidebar sets localStorage `theme` key
- Root layout inlines a script to apply dark class before first paint (no FOUC)
- `@variant dark (&:where(.dark, .dark *))` in globals.css

**Why:** Jordan prefers sidebar always dark regardless of theme.
