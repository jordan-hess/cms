---
name: project-team-leader-review
description: Approved schema design for Team Leader Management System — team_leaders table, approval history, trigger-based notifications, and RLS
metadata:
  type: project
---

Reviewed and approved on 2026-06-06. Full migration script produced (see assessment in conversation).

**Design decisions:**
- `team_leaders` is a separate table (not a column on teams), allowing one admin to lead multiple teams and enabling audit history of who was leader when
- Admin-role enforcement uses a BEFORE INSERT/UPDATE trigger on team_leaders (not a CHECK constraint), because CHECK constraints cannot query other tables in standard Postgres
- `request_approval_history` table captures every status transition for audit purposes; requests table itself retains only the current state
- Notification auto-routing uses a BEFORE INSERT trigger on requests that finds the team leader via team_leaders → profiles join and inserts into notifications; falls back gracefully if no team leader is assigned
- notifications table gets a nullable `request_id UUID REFERENCES requests(id) ON DELETE CASCADE` column added (additive, non-breaking)
- notifications.type CHECK constraint is extended to include 'request' value (requires DROP + re-ADD of the constraint)
- RLS on team_leaders: admins full CRUD; authenticated users SELECT (needed so agents can see who their TL is)
- RLS on request_approval_history: SELECT for own requests or team leader of that team or admin; INSERT admin-only; no UPDATE/DELETE
- RLS on requests is updated: team leaders can SELECT and UPDATE (approve/reject) requests for their assigned teams
- RLS on leave_requests/overtime_requests/overtime_entries: updated to allow team leaders of the relevant team to read and update

**Why:** Separate table gives historical assignment tracking. Trigger-based admin enforcement is the only safe cross-table constraint option in Postgres without a materialized view or application-layer enforcement. Additive notification column avoids breaking existing notification queries.

**How to apply:** When building UI for team leader assignment or request approval routing, always join through team_leaders → profiles. Never assume profile.role = 'admin' means the user is a team leader for a given team.
