---
name: design-inconsistencies
description: Cross-component inconsistencies, missing patterns, and polish gaps identified in the design system audit
metadata:
  type: project
---

## Architecture / Structural

### No Header in AppLayout
AppLayout (app/(app)/layout.tsx) does NOT render the Header component. Every individual page must render `<Header title="..." userId={...} />` itself. This creates opportunity for pages to accidentally omit it, and the userId must be passed per-page. Consider lifting Header into the layout with a title prop system.

### Sidebar has no responsive behavior
`w-64` is fixed with no mobile breakpoint. On screens below ~1024px, the sidebar just occupies 256px unconditionally with no hamburger/drawer mechanism. No responsive strategy exists.

## Visual / Spacing Inconsistencies

### Avatar size inconsistency
- Sidebar user avatar: `w-8 h-8` (32px)
- Dashboard/admin agent list avatar: `w-8 h-8` (32px)
- AgentManager agent row avatar: `w-10 h-10` (40px)
- DayView profile avatar: `w-9 h-9` (36px)
- WeekView profile avatar: `w-6 h-6` (24px)
- All with `rounded-full` — three different sizes across similar contexts.

### Empty state inconsistency
- CustomerManager, CallbackManager, FollowupManager, EscalationManager all have empty states: `py-16 text-center` with a large icon + 1-2 lines of text. Consistent pattern.
- Dashboard callbacks/followups empty state: `py-8 text-center` with `w-8 h-8` icon — smaller than manager pages. Should probably be `py-12` or match the managers.

### Card shadow inconsistency
- Stat cards use `shadow-sm` + `hover:shadow-md`
- Other cards use `shadow-sm` (no hover)
- WeekView/MonthView/DayView roster cards use `shadow-sm`
- Modal backdrop uses `shadow-2xl`
Inconsistency: stat cards feel interactive because of hover shadow; data cards do not, even though they contain clickable rows. This is actually fine intentionally but should be noted.

### Inline badge vs Badge component
`Badge.tsx` is almost never used. All badge rendering is done inline with template literals. The Badge component is missing dark mode variants. Either standardize on the Badge component (with dark mode) or remove it and document the inline pattern as the canonical approach.

### Segmented tab active color inconsistency
FollowupManager has two segmented tabs — status tab uses blue-600 active, type tab uses `bg-${accent}-600` with accent='indigo'. Since Tailwind 4 JIT requires full class strings, `bg-indigo-600` may not be generated dynamically (the `tabCls` function constructs `bg-${accent}-600` dynamically which won't be included in the Tailwind build). The indigo type tab may never render correctly with its intended color.

### Button variant inconsistency in action rows
AgentManager action buttons are all `text-xs px-2 py-1 rounded-lg border` — significantly smaller than all other buttons in the codebase that use `px-4 py-2.5` or `px-4 py-2`. This is intentional for density but the mixing of `px-2 py-1` buttons with `px-4 py-2.5` main CTA buttons in the same view creates a clear size hierarchy. Acceptable but worth noting.

### `transition-colors` vs `transition`
Login page submit button uses `transition` (all properties). All other buttons use `transition-colors`. Minor, but worth standardizing.

## Accessibility Gaps

### No focus-visible rings on action buttons
All buttons use `outline-none` or don't set outline at all. The icon-only action buttons (edit, delete, attendance mark, override) have no visible focus indicator beyond the hover background. Keyboard navigation is effectively invisible. All interactive elements need `focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2`.

### Missing aria-labels on icon-only buttons
- Header bell button: no aria-label
- Modal close (X) button: no aria-label
- CalendarHeader prev/next buttons: HAVE `aria-label` — good example to follow
- AgentManager action buttons use `title` attribute — not announced by all screen readers the same way aria-label is

### Missing keyboard trap on modals
Modal.tsx does not trap focus inside when open. Screen reader / keyboard users can tab through the entire page behind the overlay.

### Notification dropdown has no keyboard navigation
Header notification dropdown uses `fixed inset-0 z-10` backdrop click to close. No Escape key handler, no focus management when opened.

### `confirm()` dialog in CustomerManager
`handleDelete` uses native `window.confirm()` — browser dialog, not a designed confirmation modal. Inaccessible on many platforms and visually inconsistent with the design language.

### Color-only status differentiation
Status chips and priority badges rely entirely on color to communicate meaning. Should include an icon or text alongside the color for WCAG 1.4.1 compliance (though the labels are present via text, so this is partially mitigated).

## Typography Gaps

### Empty state text missing dark variant in one case
Dashboard callbacks empty state: `<p className="text-sm text-gray-500">No pending callbacks</p>` — missing `dark:text-gray-400`. All other empty states include the dark variant.

### Inconsistent heading level semantics
- Header.tsx renders `<h1>` for the page title
- Dashboard cards use `<h2>` for section headings — correct
- DayView team headers use `<h3>` — correct hierarchy
- But RosterManager, CalendarHeader, and several other sections use `<h2>` or `<p>` with bold styling rather than semantic heading elements

## Missing Patterns / Opportunities

### No skeleton / loading states
There are no loading skeletons on any data surface. Pages are server components that block until data loads, so this is less critical, but client-side mutations via `router.refresh()` show no intermediate loading state on the list itself (only on the submit button).

### No toast/notification feedback for mutations
Successful saves, deletes, and status changes produce no visible feedback outside of modals closing. The only success feedback is the `success` state variable in AgentManager's "Add Team Member" form — and even that renders as a green paragraph inside the modal, not a toast.

### No animation library present
Zero animations beyond CSS `transition-colors` and `transition-shadow`. Entry animations for modals, page transitions, hover micro-interactions, and scroll-reveals are all missing. Anime.js is not installed.

## Login Page Specific

### Hero shape uses hardcoded gray
`.hero-shape` background is `rgba(217, 217, 217, 1)` — a flat mid-gray polygon. It visually conflicts with the `bg-gradient-to-br from-blue-50 to-indigo-100` gradient behind it since they're similar tones. The shape feels like an unfinished design placeholder.

### Login card has no dark mode support
The login page doesn't check for dark preference. If a user has dark mode set and visits /login, they see a fully white card on a light gradient.

**How to apply:** When working in any of these areas, address the specific gap listed above. The dark mode fixes should always follow the inputCls/labelCls pattern established in the manager components.
