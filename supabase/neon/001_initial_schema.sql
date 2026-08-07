-- ============================================================
-- Neon-target consolidated schema (Phase 0 of the Supabase migration)
--
-- This is a consolidated CURRENT-STATE port of everything live in Supabase
-- today (supabase/schema.sql + roster-schema.sql + roster-multi-rotation-
-- migration.sql + requests-schema.sql + team-leaders-schema.sql +
-- add-management-role.sql + migrations/*.sql), not a replay of migration
-- history. Superseded policies (e.g. the pre-team-leader versions of the
-- requests/leave_requests/overtime_requests/overtime_entries policies) are
-- omitted entirely rather than created-then-dropped.
--
-- Two deliberate differences from the Supabase original, both required
-- because this runs on plain Postgres (no Supabase platform underneath):
--
-- 1. `auth.uid()` -> `current_uid()`. Supabase's `auth.uid()` reads a JWT
--    claim that PostgREST injects into the session per-request. On plain
--    Postgres there is no PostgREST, so `current_uid()` (defined below)
--    reads a session-local setting instead. The app's data-access layer
--    must call `SET LOCAL app.current_user_id = '<uuid>'` at the start of
--    every transaction (see the planned `withUserContext()` wrapper) for
--    every one of these ~64 policies to keep working exactly as before.
--
-- 2. The Supabase-only `authenticated` Postgres role does not exist here.
--    It's created below and granted table-level access; RLS policies keep
--    using `TO authenticated` unchanged. The app's Postgres connection
--    role must be a member of `authenticated` (see grants at the bottom).
--
-- Intentionally NOT ported: `handle_new_user()` / the `on_auth_user_created`
-- trigger on `auth.users`. That trigger fires on Supabase's own internal
-- auth table, which does not exist here — profile creation becomes explicit
-- application code in the Phase 1 auth cutover instead (both the admin
-- user-provisioning path and first-time Microsoft/Entra ID SSO login must
-- insert into `profiles` themselves).
--
-- Known gap surfaced while writing this port: `roster-schema.sql` and
-- `requests-schema.sql` both reference a `set_updated_at()` trigger
-- function that is never defined in any committed SQL file in this repo.
-- It must have been created directly in the Supabase SQL Editor at some
-- point and never saved. Reconstructed below with the same, obvious body
-- as the sibling `update_updated_at()` function (there is no ambiguity in
-- what this function does) -- flagged here so it's not mistaken for
-- something exotic.
-- ============================================================

-- ─── Extensions ────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid(); no-op if already core on this PG version

-- ─── Neon-specific: identity plumbing that Supabase normally provides ─────

CREATE OR REPLACE FUNCTION current_uid() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END
$$;

-- Mirrors Supabase's service_role: bypasses RLS entirely. Used only via
-- lib/db/withUserContext.ts's withServiceRole() escape hatch (SET LOCAL ROLE
-- service_role inside a transaction), never for ordinary request handling —
-- same one-legitimate-use-site convention this repo already follows for the
-- Supabase service-role client.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END
$$;

-- ─── Tables ────────────────────────────────────────────────────────────────

CREATE TABLE profiles (
  id UUID PRIMARY KEY, -- was: REFERENCES auth.users(id) ON DELETE CASCADE — no auth.users here; app creates this row explicitly
  email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'agent' CHECK (role IN ('agent', 'admin', 'management')),
  department TEXT,
  avatar_url TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  force_password_change BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE customers (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  account_number TEXT,
  notes TEXT,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE callbacks (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE NOT NULL,
  agent_id UUID REFERENCES profiles(id) NOT NULL,
  created_by UUID REFERENCES profiles(id),
  scheduled_at TIMESTAMPTZ NOT NULL,
  query_description TEXT NOT NULL,
  possible_solution TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled', 'rescheduled')),
  notes TEXT,
  completed_at TIMESTAMPTZ,
  reminder_sent BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE followups (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE NOT NULL,
  agent_id UUID REFERENCES profiles(id) NOT NULL,
  created_by UUID REFERENCES profiles(id) NOT NULL,
  type TEXT DEFAULT 'followup' CHECK (type IN ('followup', 'escalation')),
  query_description TEXT NOT NULL,
  possible_solution TEXT,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  due_date TIMESTAMPTZ,
  resolution_notes TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE notifications (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  recipient_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  sender_id UUID REFERENCES profiles(id),
  followup_id UUID REFERENCES followups(id) ON DELETE CASCADE,
  callback_id UUID REFERENCES callbacks(id) ON DELETE CASCADE,
  request_id UUID, -- FK added below, after `requests` exists
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT DEFAULT 'info' CHECK (type IN ('info', 'followup', 'escalation', 'reminder', 'request', 'callback')),
  read BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE password_reset_requests (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by UUID REFERENCES profiles(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE teams (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  color       text NOT NULL,       -- 'green' | 'blue' | 'red' | 'yellow'
  description text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_teams_name ON teams (name);

CREATE TABLE team_members (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id    uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  joined_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id)
);
CREATE INDEX idx_team_members_team_id    ON team_members (team_id);
CREATE INDEX idx_team_members_profile_id ON team_members (profile_id);

CREATE TABLE shift_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  start_time  time NOT NULL,
  end_time    time NOT NULL,
  work_days   int[] NOT NULL,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE team_rotations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id           uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  shift_template_id uuid NOT NULL REFERENCES shift_templates(id) ON DELETE RESTRICT,
  week_start_date   date NOT NULL,
  created_by        uuid NOT NULL REFERENCES profiles(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  -- Final constraint shape (post roster-multi-rotation-migration.sql):
  -- a team can have different shift templates in the same week, but not the same one twice.
  UNIQUE (team_id, week_start_date, shift_template_id)
);
CREATE INDEX idx_team_rotations_team_id          ON team_rotations (team_id);
CREATE INDEX idx_team_rotations_week_start_date  ON team_rotations (week_start_date);

CREATE TYPE attendance_status AS ENUM ('on_shift', 'late', 'absent', 'sick', 'leave', 'off');

CREATE TABLE attendance_records (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  date       date NOT NULL,
  status     attendance_status NOT NULL DEFAULT 'on_shift',
  notes      text,
  marked_by  uuid NOT NULL REFERENCES profiles(id),
  marked_at  timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, date)
);
CREATE INDEX idx_attendance_profile_id ON attendance_records (profile_id);
CREATE INDEX idx_attendance_date       ON attendance_records (date);

CREATE TABLE roster_overrides (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id        uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  date              date NOT NULL,
  override_type     text NOT NULL CHECK (override_type IN ('off', 'swap_in', 'extra_shift')),
  shift_template_id uuid REFERENCES shift_templates(id) ON DELETE SET NULL,
  notes             text,
  created_by        uuid NOT NULL REFERENCES profiles(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, date)
);
CREATE INDEX idx_roster_overrides_profile_id ON roster_overrides (profile_id);
CREATE INDEX idx_roster_overrides_date       ON roster_overrides (date);

CREATE TABLE requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  team_id       uuid REFERENCES teams(id) ON DELETE SET NULL,
  type          text NOT NULL CHECK (type IN ('leave', 'overtime')),
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'changes_requested')),
  admin_comment text,
  reviewed_by   uuid REFERENCES profiles(id) ON DELETE SET NULL,
  reviewed_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_requests_profile_id ON requests (profile_id);
CREATE INDEX idx_requests_status     ON requests (status);
CREATE INDEX idx_requests_type       ON requests (type);
CREATE INDEX idx_requests_team_id    ON requests (team_id);

ALTER TABLE notifications
  ADD CONSTRAINT notifications_request_id_fkey FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE;
CREATE INDEX idx_notifications_request_id ON notifications (request_id);

CREATE TABLE leave_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  uuid NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  leave_type  text NOT NULL CHECK (leave_type IN ('annual', 'sick', 'family_responsibility', 'unpaid', 'other')),
  dates       date[] NOT NULL,
  notes       text
);
CREATE INDEX idx_leave_requests_request_id ON leave_requests (request_id);

CREATE TABLE overtime_requests (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  month      int  NOT NULL CHECK (month BETWEEN 1 AND 12),
  year       int  NOT NULL CHECK (year >= 2020),
  notes      text
);
CREATE INDEX idx_overtime_requests_request_id ON overtime_requests (request_id);

CREATE TABLE overtime_entries (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  overtime_request_id  uuid NOT NULL REFERENCES overtime_requests(id) ON DELETE CASCADE,
  date                 date NOT NULL,
  shift                text NOT NULL CHECK (shift IN ('day', 'night', 'evening')),
  ot_1_5               numeric(4,2) NOT NULL DEFAULT 0,
  ot_2_0               numeric(4,2) NOT NULL DEFAULT 0,
  night_hours          numeric(4,2) NOT NULL DEFAULT 0,
  sort_order           int NOT NULL DEFAULT 0
);
CREATE INDEX idx_overtime_entries_overtime_request_id ON overtime_entries (overtime_request_id);

CREATE TABLE team_leaders (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     uuid        NOT NULL REFERENCES teams(id)    ON DELETE CASCADE,
  profile_id  uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  assigned_by uuid        NOT NULL REFERENCES profiles(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id)
);
CREATE INDEX idx_team_leaders_team_id    ON team_leaders (team_id);
CREATE INDEX idx_team_leaders_profile_id ON team_leaders (profile_id);

CREATE TABLE request_approval_history (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id   uuid        NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  changed_by   uuid        NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  from_status  text        NOT NULL,
  to_status    text        NOT NULL,
  comment      text,
  changed_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_approval_history_request_id ON request_approval_history (request_id);
CREATE INDEX idx_approval_history_changed_by ON request_approval_history (changed_by);
CREATE INDEX idx_approval_history_changed_at ON request_approval_history (changed_at);

-- ─── Trigger functions ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- Reconstructed — see the "Known gap" note at the top of this file.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION enforce_team_leader_is_admin()
RETURNS TRIGGER AS $$
DECLARE
  v_role text;
BEGIN
  SELECT role INTO v_role FROM profiles WHERE id = NEW.profile_id;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'enforce_team_leader_is_admin: profile % does not exist', NEW.profile_id;
  END IF;

  IF v_role <> 'admin' THEN
    RAISE EXCEPTION 'enforce_team_leader_is_admin: profile % has role %, must be admin', NEW.profile_id, v_role;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION notify_team_leader_on_request()
RETURNS TRIGGER AS $$
DECLARE
  v_leader_id      uuid;
  v_requester_name text;
  v_type_label     text;
BEGIN
  IF NEW.status <> 'pending' THEN
    RETURN NEW;
  END IF;

  IF NEW.team_id IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT tl.profile_id
      INTO v_leader_id
      FROM team_leaders tl
     WHERE tl.team_id = NEW.team_id
     LIMIT 1;

    IF v_leader_id IS NULL THEN
      RETURN NEW;
    END IF;

    IF v_leader_id = NEW.profile_id THEN
      RETURN NEW;
    END IF;

    SELECT full_name INTO v_requester_name
      FROM profiles WHERE id = NEW.profile_id;

    v_type_label := CASE NEW.type
      WHEN 'leave'    THEN 'leave'
      WHEN 'overtime' THEN 'overtime'
      ELSE NEW.type
    END;

    INSERT INTO notifications (
      recipient_id, sender_id, request_id, title, message, type
    ) VALUES (
      v_leader_id,
      NEW.profile_id,
      NEW.id,
      'New ' || v_type_label || ' request',
      COALESCE(v_requester_name, 'An agent') || ' has submitted a ' || v_type_label || ' request requiring your review.',
      'request'
    );

  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION is_team_leader_for(p_team_id uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM team_leaders
    WHERE team_id = p_team_id
      AND profile_id = current_uid()
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

CREATE OR REPLACE FUNCTION reset_callback_reminder()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.scheduled_at <> OLD.scheduled_at THEN
    NEW.reminder_sent := FALSE;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Called by an app-level scheduler (Vercel Cron / external cron -> an internal
-- API route), not pg_cron — see the plan's "Scheduled reminders" decision.
-- This job has never been enabled in production; porting it as dormant, ready
-- code, same as it is today.
CREATE OR REPLACE FUNCTION send_callback_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  WITH due AS (
    UPDATE callbacks
    SET reminder_sent = TRUE
    WHERE status = 'pending'
      AND reminder_sent = FALSE
      AND scheduled_at > NOW()
      AND scheduled_at <= (NOW() + INTERVAL '5 minutes')
    RETURNING id, agent_id, customer_id
  )
  INSERT INTO notifications (recipient_id, callback_id, title, message, type)
  SELECT
    d.agent_id,
    d.id,
    'Upcoming Callback: ' || c.name,
    'You have a callback with ' || c.name || ' scheduled in 5 minutes.',
    'reminder'
  FROM due d
  JOIN customers c ON c.id = d.customer_id;
END;
$$;

-- ─── Triggers ──────────────────────────────────────────────────────────────

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER customers_updated_at BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER callbacks_updated_at BEFORE UPDATE ON callbacks FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER followups_updated_at BEFORE UPDATE ON followups FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_teams_updated_at
  BEFORE UPDATE ON teams FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_shift_templates_updated_at
  BEFORE UPDATE ON shift_templates FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_attendance_records_updated_at
  BEFORE UPDATE ON attendance_records FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_requests_updated_at
  BEFORE UPDATE ON requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_enforce_team_leader_is_admin
  BEFORE INSERT OR UPDATE ON team_leaders
  FOR EACH ROW EXECUTE FUNCTION enforce_team_leader_is_admin();

CREATE TRIGGER trg_notify_team_leader_on_request
  AFTER INSERT ON requests
  FOR EACH ROW EXECUTE FUNCTION notify_team_leader_on_request();

CREATE TRIGGER callbacks_reset_reminder
  BEFORE UPDATE ON callbacks
  FOR EACH ROW EXECUTE FUNCTION reset_callback_reminder();

-- Intentionally NOT created: on_auth_user_created AFTER INSERT ON auth.users.
-- See the note at the top of this file.

-- ─── Row Level Security ────────────────────────────────────────────────────

ALTER TABLE profiles                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers                ENABLE ROW LEVEL SECURITY;
ALTER TABLE callbacks                ENABLE ROW LEVEL SECURITY;
ALTER TABLE followups                ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications            ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_reset_requests  ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members             ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_templates          ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_rotations           ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records       ENABLE ROW LEVEL SECURITY;
ALTER TABLE roster_overrides         ENABLE ROW LEVEL SECURITY;
ALTER TABLE requests                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests           ENABLE ROW LEVEL SECURITY;
ALTER TABLE overtime_requests        ENABLE ROW LEVEL SECURITY;
ALTER TABLE overtime_entries         ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_leaders             ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_approval_history ENABLE ROW LEVEL SECURITY;

-- profiles
CREATE POLICY "Profiles viewable by authenticated users" ON profiles FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE TO authenticated USING (current_uid() = id);
CREATE POLICY "Admins can update any profile" ON profiles FOR UPDATE TO authenticated USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin')
);
CREATE POLICY "Admins can insert profiles" ON profiles FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin')
);

-- customers
CREATE POLICY "All users see all customers" ON customers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Agents can insert customers" ON customers FOR INSERT TO authenticated WITH CHECK (current_uid() = created_by);
CREATE POLICY "Agents can update their customers" ON customers FOR UPDATE TO authenticated USING (
  created_by = current_uid() OR
  EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin')
);

-- callbacks
CREATE POLICY "Agents see their own callbacks" ON callbacks FOR SELECT TO authenticated USING (
  agent_id = current_uid() OR
  EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin')
);
CREATE POLICY "Users can insert callbacks" ON callbacks FOR INSERT TO authenticated WITH CHECK (
  agent_id = current_uid() OR
  EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin')
);
CREATE POLICY "Agents can update their callbacks" ON callbacks FOR UPDATE TO authenticated USING (
  agent_id = current_uid() OR
  EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin')
);

-- followups
CREATE POLICY "Agents see assigned followups" ON followups FOR SELECT TO authenticated USING (
  agent_id = current_uid() OR created_by = current_uid() OR
  EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin')
);
CREATE POLICY "Authenticated users can insert followups" ON followups FOR INSERT TO authenticated WITH CHECK (current_uid() = created_by);
CREATE POLICY "Agents update assigned followups" ON followups FOR UPDATE TO authenticated USING (
  agent_id = current_uid() OR
  EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin')
);

-- password_reset_requests
CREATE POLICY "Admins see all reset requests" ON password_reset_requests FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin')
);
CREATE POLICY "Users see own reset requests" ON password_reset_requests FOR SELECT TO authenticated USING (
  profile_id = current_uid()
);

-- notifications
CREATE POLICY "Users see own notifications" ON notifications FOR SELECT TO authenticated USING (recipient_id = current_uid());
CREATE POLICY "Authenticated users can insert notifications" ON notifications FOR INSERT TO authenticated WITH CHECK (TRUE);
CREATE POLICY "Users can update own notifications" ON notifications FOR UPDATE TO authenticated USING (recipient_id = current_uid());

-- teams
CREATE POLICY "teams_select" ON teams FOR SELECT TO authenticated USING (true);
CREATE POLICY "teams_insert" ON teams FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin'));
CREATE POLICY "teams_update" ON teams FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin'));
CREATE POLICY "teams_delete" ON teams FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin'));

-- team_members
CREATE POLICY "team_members_select" ON team_members FOR SELECT TO authenticated USING (true);
CREATE POLICY "team_members_insert" ON team_members FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin'));
CREATE POLICY "team_members_update" ON team_members FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin'));
CREATE POLICY "team_members_delete" ON team_members FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin'));

-- shift_templates
CREATE POLICY "shift_templates_select" ON shift_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY "shift_templates_insert" ON shift_templates FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin'));
CREATE POLICY "shift_templates_update" ON shift_templates FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin'));
CREATE POLICY "shift_templates_delete" ON shift_templates FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin'));

-- team_rotations
CREATE POLICY "team_rotations_select" ON team_rotations FOR SELECT TO authenticated USING (true);
CREATE POLICY "team_rotations_insert" ON team_rotations FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin'));
CREATE POLICY "team_rotations_update" ON team_rotations FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin'));
CREATE POLICY "team_rotations_delete" ON team_rotations FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin'));

-- attendance_records
CREATE POLICY "attendance_select" ON attendance_records FOR SELECT TO authenticated
  USING (profile_id = current_uid() OR EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin'));
CREATE POLICY "attendance_insert" ON attendance_records FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin'));
CREATE POLICY "attendance_update" ON attendance_records FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin'));
CREATE POLICY "attendance_delete" ON attendance_records FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin'));

-- roster_overrides
CREATE POLICY "roster_overrides_select" ON roster_overrides FOR SELECT TO authenticated
  USING (profile_id = current_uid() OR EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin'));
CREATE POLICY "roster_overrides_insert" ON roster_overrides FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin'));
CREATE POLICY "roster_overrides_update" ON roster_overrides FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin'));
CREATE POLICY "roster_overrides_delete" ON roster_overrides FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin'));

-- requests (final, post-team-leaders-schema shape)
CREATE POLICY "requests_select" ON requests FOR SELECT TO authenticated
  USING (
    profile_id = current_uid()
    OR is_team_leader_for(team_id)
    OR EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin')
  );
CREATE POLICY "requests_insert" ON requests FOR INSERT TO authenticated
  WITH CHECK (profile_id = current_uid());
CREATE POLICY "requests_update" ON requests FOR UPDATE TO authenticated
  USING (
    profile_id = current_uid()
    OR is_team_leader_for(team_id)
    OR EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin')
  );
CREATE POLICY "requests_delete" ON requests FOR DELETE TO authenticated
  USING (
    profile_id = current_uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin')
  );

-- leave_requests (final, post-team-leaders-schema shape)
CREATE POLICY "leave_requests_select" ON leave_requests FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM requests r
      WHERE r.id = leave_requests.request_id
        AND (
          r.profile_id = current_uid()
          OR is_team_leader_for(r.team_id)
          OR EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin')
        )
    )
  );
CREATE POLICY "leave_requests_insert" ON leave_requests FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM requests r
      WHERE r.id = leave_requests.request_id
        AND r.profile_id = current_uid()
    )
  );
CREATE POLICY "leave_requests_update" ON leave_requests FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM requests r
      WHERE r.id = leave_requests.request_id
        AND (
          r.profile_id = current_uid()
          OR is_team_leader_for(r.team_id)
          OR EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin')
        )
    )
  );
CREATE POLICY "leave_requests_delete" ON leave_requests FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM requests r
      WHERE r.id = leave_requests.request_id
        AND (r.profile_id = current_uid() OR EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin'))
    )
  );

-- overtime_requests (final, post-team-leaders-schema shape)
CREATE POLICY "overtime_requests_select" ON overtime_requests FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM requests r
      WHERE r.id = overtime_requests.request_id
        AND (
          r.profile_id = current_uid()
          OR is_team_leader_for(r.team_id)
          OR EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin')
        )
    )
  );
CREATE POLICY "overtime_requests_insert" ON overtime_requests FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM requests r
      WHERE r.id = overtime_requests.request_id
        AND r.profile_id = current_uid()
    )
  );
CREATE POLICY "overtime_requests_update" ON overtime_requests FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM requests r
      WHERE r.id = overtime_requests.request_id
        AND (
          r.profile_id = current_uid()
          OR is_team_leader_for(r.team_id)
          OR EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin')
        )
    )
  );
CREATE POLICY "overtime_requests_delete" ON overtime_requests FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM requests r
      WHERE r.id = overtime_requests.request_id
        AND (r.profile_id = current_uid() OR EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin'))
    )
  );

-- overtime_entries (final, post-team-leaders-schema shape)
CREATE POLICY "overtime_entries_select" ON overtime_entries FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM overtime_requests ot
      JOIN requests r ON r.id = ot.request_id
      WHERE ot.id = overtime_entries.overtime_request_id
        AND (
          r.profile_id = current_uid()
          OR is_team_leader_for(r.team_id)
          OR EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin')
        )
    )
  );
CREATE POLICY "overtime_entries_insert" ON overtime_entries FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM overtime_requests ot
      JOIN requests r ON r.id = ot.request_id
      WHERE ot.id = overtime_entries.overtime_request_id
        AND r.profile_id = current_uid()
    )
  );
CREATE POLICY "overtime_entries_update" ON overtime_entries FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM overtime_requests ot
      JOIN requests r ON r.id = ot.request_id
      WHERE ot.id = overtime_entries.overtime_request_id
        AND (
          r.profile_id = current_uid()
          OR is_team_leader_for(r.team_id)
          OR EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin')
        )
    )
  );
CREATE POLICY "overtime_entries_delete" ON overtime_entries FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM overtime_requests ot
      JOIN requests r ON r.id = ot.request_id
      WHERE ot.id = overtime_entries.overtime_request_id
        AND (r.profile_id = current_uid() OR EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin'))
    )
  );

-- team_leaders
CREATE POLICY "team_leaders_select" ON team_leaders FOR SELECT TO authenticated USING (true);
CREATE POLICY "team_leaders_insert" ON team_leaders FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin'));
CREATE POLICY "team_leaders_update" ON team_leaders FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin'));
CREATE POLICY "team_leaders_delete" ON team_leaders FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin'));

-- request_approval_history (append-only: SELECT + INSERT policies only, no UPDATE/DELETE)
CREATE POLICY "approval_history_select" ON request_approval_history FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM requests r WHERE r.id = request_approval_history.request_id AND r.profile_id = current_uid())
    OR EXISTS (SELECT 1 FROM requests r WHERE r.id = request_approval_history.request_id AND is_team_leader_for(r.team_id))
    OR EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin')
  );
CREATE POLICY "approval_history_insert" ON request_approval_history FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin'));

-- ─── Grants ────────────────────────────────────────────────────────────────
-- RLS restricts which ROWS are visible/writable; Postgres still requires a
-- base GRANT for the operation category itself. Supabase provisions this
-- automatically for its `authenticated`/`anon` roles; here it's explicit.

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- The app's actual Neon connection role must be granted membership in both
-- roles once known, e.g.: GRANT authenticated, service_role TO neondb_owner;
-- (substitute the real role name Neon assigns). Left as a manual step since
-- that role name doesn't exist until the Neon project is created.

-- Belt-and-suspenders on top of RLS (per the plan's "RLS decision"): make the
-- append-only guarantee on request_approval_history hold even if a future
-- policy change is wrong, independent of RLS entirely.
REVOKE UPDATE, DELETE ON request_approval_history FROM authenticated;

-- ─── Seed data ─────────────────────────────────────────────────────────────

INSERT INTO teams (name, color) VALUES
  ('Green',  'green'),
  ('Blue',   'blue'),
  ('Red',    'red'),
  ('Yellow', 'yellow');

INSERT INTO shift_templates (name, start_time, end_time, work_days) VALUES
  ('Morning',    '06:00', '14:00', '{1,2,3,4,5}'),
  ('Afternoon',  '14:00', '22:00', '{1,2,3,4,5}'),
  ('Night',      '22:00', '06:00', '{1,2,3,4,5}'),
  ('Weekend AM', '07:00', '15:00', '{6,7}');
