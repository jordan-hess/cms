---
name: feedback-review-first
description: User wants full architectural assessment and plan before any code is written
metadata:
  type: feedback
---

Always produce a thorough architectural assessment and implementation plan before writing any code. Jordan explicitly structures requests as "review and plan" tasks before committing to implementation.

**Why:** Prevents wasted effort and catches integration risks (auth layers, RLS, existing component contracts) before they become merge conflicts or production bugs.

**How to apply:** On any non-trivial feature request, read every affected file, write the impact assessment and file plan first, then wait for or proceed with implementation only after the plan is established. Never write a single line of implementation code in a planning response.
