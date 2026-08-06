---
name: project-schema-overview
description: Approved schema layers and key conventions for care-cms Supabase backend
metadata:
  type: project
---

Schema is applied in this order:
1. supabase/schema.sql — core tables: profiles, customers, callbacks, followups, notifications
2. supabase/fix-auth-trigger.sql — repairs the on_auth_user_created trigger
3. supabase/roster-schema.sql — teams, team_members, shift_templates, team_rotations, attendance_records, roster_overrides; seeds 4 teams (Green, Blue, Red, Yellow) and 4 shift templates
4. supabase/roster-multi-rotation-migration.sql — drops the one-shift-per-team-per-week UNIQUE constraint, replaces with (team_id, week_start_date, shift_template_id) unique
5. supabase/requests-schema.sql — requests, leave_requests, overtime_requests, overtime_entries

**Key conventions:**
- PK: `id UUID PRIMARY KEY DEFAULT gen_random_uuid()` (roster uses gen_random_uuid(), core uses uuid_generate_v4())
- Timestamps: `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz NOT NULL DEFAULT now()`
- Two update trigger functions exist: `update_updated_at()` (schema.sql) and `set_updated_at()` (roster-schema.sql). New migrations should use `set_updated_at()`.
- RLS is always enabled. Admin check pattern: `EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')`
- roles: 'agent' | 'admin' — no team_leader role in profiles; team leader is a positional assignment per team
- team_members enforces UNIQUE(profile_id) — one team per agent
- requests.team_id denormalizes the requester's team at submission time (snapshot)
- notifications table is generic; no request_id FK column — links via followup_id only

**Why:** Keeping the schema order correct is critical because roster-schema.sql references profiles (from schema.sql) and requests-schema.sql references both profiles and teams.
