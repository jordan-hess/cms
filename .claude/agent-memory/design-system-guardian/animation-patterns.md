---
name: animation-patterns
description: Anime.js v4 usage patterns established in care-cms Requests feature — API, import, and motion patterns
metadata:
  type: project
---

## Current Animation State

Anime.js v4.4.1 IS installed and in active use (added during Requests feature implementation).

### Anime.js v4 API — Critical Notes
- **Named export, not default**: import as `import('animejs').then(({ animate }) => { ... })`
- **NOT** `{ default: anime }` — that pattern does not work with v4
- **NOT** `anime({ targets: ... })` — the v4 function is `animate(target, params)`
- **Call signature**: `animate(element, { opacity: [0, 1], duration: 280, easing: 'easeOutQuart' })`
- The `complete` callback is now `onComplete` in the params object
- Dynamic import pattern used for SSR safety in Next.js client components

### Established Animation Patterns (from Requests feature)

#### Slide-in side panel (right edge entry)
```typescript
animate(panelRef.current!, {
  translateX: [60, 0],
  opacity: [0, 1],
  duration: 280,
  easing: 'easeOutQuart',
})
```

#### Slide-out exit (with callback)
```typescript
animate(panelRef.current!, {
  translateX: [0, 60],
  opacity: [1, 0],
  duration: 200,
  easing: 'easeInQuad',
  onComplete: () => onClose(),
})
```

#### Overlay fade
```typescript
animate(overlayRef.current, { opacity: [0, 1], duration: 200, easing: 'easeOutQuad' })
```

#### Tab content switch
```typescript
animate(contentRef.current!, {
  opacity: [0, 1],
  translateX: [10, 0],
  duration: 180,
  easing: 'easeOutQuad',
})
```

#### Success state (form to checkmark)
```typescript
// Step 1: fade out form
animate(formRef.current, { opacity: [1, 0], duration: 200, easing: 'easeOutQuad' })
// Step 2 (after 220ms): bounce in checkmark
animate(successRef.current, { opacity: [0, 1], scale: [0.7, 1], duration: 400, easing: 'easeOutBack' })
```

CSS transitions still in use:
- `transition-colors` on all interactive elements
- `transition-shadow` on stat cards
- `animate-spin` via Tailwind on Loader2 loading icons

## Anime.js Opportunities (prioritized)

### High value / easy wins
1. **Modal enter animation** — `opacity: 0 → 1` + `translateY: 20 → 0` on the modal card div. Currently modals just appear instantly. Duration: ~250ms ease-out.
2. **Stat card counter animation** — On dashboard page load, animate the large number values from 0 to their actual value. Duration: ~600ms ease-out. Creates a "dashboard came alive" feel.
3. **Toast notification** — Any future toast system should slide in from the top-right. Duration: ~300ms spring.

### Medium value
4. **Sidebar active item indicator** — Animate the blue background sliding between nav items on route change. Duration: ~200ms ease.
5. **Notification dropdown slide-down** — Header notification panel should animate open (`scaleY: 0.95 → 1`, `opacity: 0 → 1`). Duration: ~200ms.
6. **Empty state icon entrance** — Subtle bounce or fade for the placeholder icons in empty list states. Duration: ~400ms.

### Nice to have
7. **Row hover accent** — A subtle left-border color slide on list row hover rather than just background. Pure CSS can do this with `transition` on border-left-width or using a pseudo-element.
8. **Calendar chip stagger** — On Month view render, stagger in the team chips per day cell. Duration: 20ms stagger, 150ms per chip.

## Implementation Notes

- If Anime.js is added, use `useEffect` with a ref on the target element in client components.
- Always check `window.matchMedia('(prefers-reduced-motion: reduce)')` before running non-essential animations.
- Modals are controlled by `if (!open) return null` — to animate exit, need to switch to a visibility/opacity approach that delays unmount. Consider using a CSS class toggle pattern instead of early return.
- The `transition-colors` class should stay on all interactive elements regardless of JS animations — it handles the hover state without JS.
