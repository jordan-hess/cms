---
name: dark-mode-issues
description: All confirmed dark mode gaps — elements that remain light/unreadable in dark mode
metadata:
  type: project
---

## Critical — Forms in modals with missing dark counterparts

### MarkAttendanceModal.tsx
- Context box: `bg-gray-50 rounded-lg` — no `dark:bg-gray-800`
- Status button unselected: `text-gray-600 border-gray-300 hover:bg-gray-50` — no dark variants
- Textarea: `border-gray-300 rounded-lg ... focus:ring-2` — no `dark:border-gray-700 dark:bg-gray-800 dark:text-white`
- Labels: `text-gray-700` — no `dark:text-gray-300`

### RosterOverrideModal.tsx
- Context box: `bg-amber-50 rounded-lg border border-amber-100` — no dark counterpart
- Radio option cards: `border-gray-200 hover:bg-gray-50` / `border-blue-500 bg-blue-50` — no dark variants
- Shift template select: `border border-gray-300 rounded-lg` — no dark variants
- Textarea: `border border-gray-300` — no dark variants  
- Labels throughout: `text-gray-700` — no `dark:text-gray-300`
- Description text: `text-gray-500` and `text-gray-900` — no dark variants

### AssignShiftModal.tsx
- Context box: `bg-gray-50 rounded-lg` — no `dark:bg-gray-800`
- Week date input: `border border-gray-300 rounded-lg` — no dark variants
- Day selector buttons (unselected): `text-gray-600 border-gray-300 hover:bg-gray-50` — no dark variants
- Labels: `text-gray-700` — no `dark:text-gray-300`
- Summary box: `bg-blue-50 border border-blue-100` — no dark variants

### AssignTeamModal.tsx (partial)
- Agent label: `text-gray-700` — missing `dark:text-gray-300`
- Cancel button: `text-gray-700 border-gray-300 hover:bg-gray-50` — no dark variants
- Error message: `bg-red-50 px-3 py-2` — no `dark:bg-red-900/30`

### ManageTeamsModal.tsx
- "Create new team" heading: `text-gray-700` — no dark variant
- Team name label: `text-gray-600` — no dark variant
- Color selector label: `text-gray-600` — no dark variant
- Unselected color button: `bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100` — no dark variants

## Major — Badge component missing dark mode

`components/ui/Badge.tsx` — all 6 variants use only light-mode classes:
- `bg-gray-100 text-gray-700` (no dark)
- `bg-green-100 text-green-700` (no dark)
- `bg-yellow-100 text-yellow-700` (no dark)
- `bg-red-100 text-red-700` (no dark)
- `bg-blue-100 text-blue-700` (no dark)
- `bg-purple-100 text-purple-700` (no dark)

Inline badge patterns in other components DO have dark variants, making Badge.tsx inconsistent.

## Minor — Notification badge colors

Header.tsx `badgeColor` map:
```js
escalation: 'bg-red-100 text-red-700',
followup: 'bg-blue-100 text-blue-700',
reminder: 'bg-yellow-100 text-yellow-700',
info: 'bg-gray-100 text-gray-700',
```
No dark counterparts — notification type badges will appear white-background in dark mode.

## Fixed — Login page

Login page (`app/login/page.tsx`) now has full dark mode support, matching the `inputCls`/`errorCls` pattern from `change-password/page.tsx`: gradient background, card, inputs, labels, all fp-* views, and the `.hero-shape` (dark override added in `globals.css` via `.dark .hero-shape`).

**How to apply:** When fixing any of these modals, apply the full inputCls/labelCls pattern with dark variants consistently, matching the established pattern from CustomerManager/CallbackManager/FollowupManager/EscalationManager.
