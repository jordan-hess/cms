-- ============================================================
-- Azure Database for PostgreSQL (SIT) target: consolidated schema (Phase 0 of the Supabase migration)
--
-- This is a consolidated CURRENT-STATE port of everything live in Supabase
-- today, regenerated from a live `pg_dump --schema-only` against the actual
-- Supabase project (2026-08-11) rather than replayed from migration files —
-- migration files can lag or never get applied (e.g. callback_id/
-- callbacks.created_by/reminder_sent below exist in migration files but were
-- never actually run against production; ported here anyway as the
-- dormant, ready-but-never-enabled feature they already were).
--
-- Three deliberate differences from the Supabase original, all required
-- because this runs on plain Postgres with a single connecting role that
-- cannot create new Postgres roles (a hard constraint of the target
-- environment — see below):
--
-- 1. `auth.uid()` -> `current_uid()`. Supabase's `auth.uid()` reads a JWT
--    claim that PostgREST injects into the session per-request. On plain
--    Postgres there is no PostgREST, so `current_uid()` (defined below)
--    reads a session-local setting instead. The app's data-access layer
--    must call `SET LOCAL app.current_user_id = '<uuid>'` at the start of
--    every transaction (see lib/db/withUserContext.ts's withUserContext())
--    for every one of these policies to keep working exactly as before.
--
-- 2. No `authenticated`/`service_role` Postgres roles. The originally
--    planned design mirrored Supabase's role-based RLS (a Postgres role per
--    audience, BYPASSRLS for the service role) — but the target environment's
--    connecting role (the app's single DB user) is not permitted to
--    CREATE ROLE, by company policy, and no admin path exists to pre-create
--    these roles either. Every policy below therefore applies to PUBLIC (no
--    `TO` clause) and is gated purely by `current_uid()` / role checks
--    against `profiles`, never by Postgres role membership.
--
-- 3. FORCE ROW LEVEL SECURITY + a session bypass flag instead of a
--    BYPASSRLS role. Postgres exempts a table's OWNING role from that
--    table's own RLS by default — and since the app's single connecting
--    role owns every table here, RLS would silently do nothing at all
--    unless every table opts out of that exemption via
--    `ALTER TABLE ... FORCE ROW LEVEL SECURITY` (below). With FORCE enabled,
--    the old `service_role` escape hatch (`SET LOCAL ROLE service_role`,
--    which needed a role to switch into) becomes a session GUC instead:
--    `SET LOCAL app.bypass_rls = 'true'` (see withServiceRole() in
--    lib/db/withUserContext.ts). Every policy below ORs in
--    `current_setting('app.bypass_rls', true) = 'true'` as its first
--    condition, reproducing the same "trusted service code can see/write
--    everything" guarantee without needing BYPASSRLS or a second role.
--    request_approval_history has no UPDATE/DELETE policy at all (append-
--    only, matching the original design's intent) — with FORCE enabled and
--    no such policy, even the bypass flag cannot make those operations
--    succeed, which is a strictly stronger guarantee than the original
--    plan's role-GRANT-based REVOKE.
--
-- Intentionally NOT ported: `handle_new_user()` / the `on_auth_user_created`
-- trigger on `auth.users`. That trigger fires on Supabase's own internal
-- auth table, which does not exist here — profile creation becomes explicit
-- application code in the Phase 1 auth cutover instead (both the admin
-- user-provisioning path and first-time Microsoft/Entra ID SSO login must
-- insert into `profiles` themselves).
-- ============================================================

-- Runs as one atomic transaction — required so the SET LOCAL app.bypass_rls
-- below (see "Seed data") has a transaction to be local to. Without an
-- explicit BEGIN, most SQL clients (including plain `psql -f`) autocommit
-- every top-level statement separately, which both breaks SET LOCAL and
-- means a failure partway through leaves a half-applied schema behind.
BEGIN;

-- ─── Extensions ────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid(); no-op if already core on this PG version

-- ─── Plain-Postgres identity plumbing that Supabase normally provides ─────

CREATE OR REPLACE FUNCTION current_uid() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid $$;

-- No CREATE ROLE here — see point 2 in the header comment. Every policy
-- below applies to PUBLIC and checks current_uid()/profiles.role directly.

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
  password_hash TEXT, -- Auth.js credential verification (Phase 1 cutover); NULL for SSO-only accounts
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
  created_by UUID REFERENCES profiles(id), -- dormant: see callback reminder note near send_callback_reminders() below
  scheduled_at TIMESTAMPTZ NOT NULL,
  query_description TEXT NOT NULL,
  possible_solution TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled', 'rescheduled')),
  notes TEXT,
  completed_at TIMESTAMPTZ,
  reminder_sent BOOLEAN DEFAULT FALSE, -- dormant: see callback reminder note near send_callback_reminders() below
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

CREATE TABLE followup_status_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  followup_id UUID NOT NULL REFERENCES followups(id) ON DELETE CASCADE,
  changed_by UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  comment TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_followup_status_history_followup_id ON followup_status_history (followup_id);
CREATE INDEX idx_followup_status_history_changed_by  ON followup_status_history (changed_by);
CREATE INDEX idx_followup_status_history_changed_at  ON followup_status_history (changed_at);

CREATE TABLE notifications (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  recipient_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  sender_id UUID REFERENCES profiles(id),
  followup_id UUID REFERENCES followups(id) ON DELETE CASCADE,
  callback_id UUID REFERENCES callbacks(id) ON DELETE CASCADE, -- dormant: see callback reminder note near send_callback_reminders() below
  request_id UUID, -- FK added below, after `requests` exists
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT DEFAULT 'info' CHECK (type IN ('info', 'followup', 'escalation', 'reminder', 'request', 'callback', 'warning')),
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

-- Has this AGENT's 1-on-1 with their team leader been done, for a given
-- month? Attribution to "which leader's card" is resolved at query time
-- via team_members -> team_leaders, not stored here.
CREATE TABLE coaching_agent_checkins (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id    uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  period_month  date        NOT NULL CHECK (period_month = date_trunc('month', period_month)::date),
  done          boolean     NOT NULL DEFAULT false,
  completed_at  timestamptz,
  marked_by     uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, period_month)
);
CREATE INDEX idx_coaching_agent_checkins_period  ON coaching_agent_checkins (period_month);
CREATE INDEX idx_coaching_agent_checkins_profile ON coaching_agent_checkins (profile_id);

-- Has MANAGEMENT personally done their check-in with this TEAM LEADER,
-- for a given month? One row per leader per period regardless of how
-- many teams that leader leads.
CREATE TABLE coaching_leader_checkins (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id    uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  period_month  date        NOT NULL CHECK (period_month = date_trunc('month', period_month)::date),
  done          boolean     NOT NULL DEFAULT false,
  completed_at  timestamptz,
  marked_by     uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, period_month)
);
CREATE INDEX idx_coaching_leader_checkins_period  ON coaching_leader_checkins (period_month);
CREATE INDEX idx_coaching_leader_checkins_profile ON coaching_leader_checkins (profile_id);

-- Team leaders issue verbal/written/final warnings to their own team's
-- agents; plain (non-leading) admins issue them to any agent org-wide;
-- management issues them to team leaders.
CREATE TABLE warnings (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  issued_to   uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  issued_by   uuid        NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  type        text        NOT NULL CHECK (type IN ('verbal', 'written', 'final')),
  reason      text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_warnings_issued_to  ON warnings (issued_to);
CREATE INDEX idx_warnings_issued_by  ON warnings (issued_by);
CREATE INDEX idx_warnings_type       ON warnings (type);
CREATE INDEX idx_warnings_created_at ON warnings (created_at);

-- ─── Trigger functions ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

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

-- Distinct from is_team_leader_for(team_id), which checks whether the
-- CURRENT user leads a given team. This checks whether an arbitrary
-- profile (e.g. a request's submitter) leads ANY team.
CREATE OR REPLACE FUNCTION is_submitter_team_leader(p_profile_id uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM team_leaders WHERE profile_id = p_profile_id
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

-- Mirrors notify_team_leader_on_request, but the recipient pool has no
-- natural 1-per-team uniqueness the way team_leaders does, so this loops
-- over every management-role profile instead of picking a single LIMIT 1.
-- Runs alongside notify_team_leader_on_request (not instead of) — that
-- trigger already skips notifying a leader about their own submission, so
-- the two triggers never double-notify the same recipient for one request.
CREATE OR REPLACE FUNCTION notify_management_on_team_leader_request()
RETURNS TRIGGER AS $$
DECLARE
  v_requester_name text;
  v_type_label     text;
  v_mgmt           record;
BEGIN
  IF NEW.status <> 'pending' THEN
    RETURN NEW;
  END IF;

  BEGIN
    IF NOT is_submitter_team_leader(NEW.profile_id) THEN
      RETURN NEW;
    END IF;

    SELECT full_name INTO v_requester_name FROM profiles WHERE id = NEW.profile_id;

    v_type_label := CASE NEW.type
      WHEN 'leave'    THEN 'leave'
      WHEN 'overtime' THEN 'overtime'
      ELSE NEW.type
    END;

    FOR v_mgmt IN SELECT id FROM profiles WHERE role = 'management' LOOP
      INSERT INTO notifications (
        recipient_id, sender_id, request_id, title, message, type
      ) VALUES (
        v_mgmt.id,
        NEW.profile_id,
        NEW.id,
        'New ' || v_type_label || ' request',
        COALESCE(v_requester_name, 'A team leader') || ' has submitted a ' || v_type_label || ' request requiring your review.',
        'request'
      );
    END LOOP;

  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

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
-- API route), not pg_cron. This job (and callbacks.created_by/reminder_sent,
-- notifications.callback_id above) has never been enabled in production —
-- ported as dormant, ready code, same as it is today.
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

CREATE OR REPLACE FUNCTION prevent_warning_retarget()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.issued_to IS DISTINCT FROM OLD.issued_to THEN
    RAISE EXCEPTION 'warnings.issued_to cannot be changed after creation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

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
CREATE TRIGGER trg_coaching_agent_checkins_updated_at
  BEFORE UPDATE ON coaching_agent_checkins FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_coaching_leader_checkins_updated_at
  BEFORE UPDATE ON coaching_leader_checkins FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_warnings_updated_at
  BEFORE UPDATE ON warnings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_enforce_team_leader_is_admin
  BEFORE INSERT OR UPDATE ON team_leaders
  FOR EACH ROW EXECUTE FUNCTION enforce_team_leader_is_admin();

CREATE TRIGGER trg_notify_team_leader_on_request
  AFTER INSERT ON requests
  FOR EACH ROW EXECUTE FUNCTION notify_team_leader_on_request();

CREATE TRIGGER trg_notify_management_on_team_leader_request
  AFTER INSERT ON requests
  FOR EACH ROW EXECUTE FUNCTION notify_management_on_team_leader_request();

CREATE TRIGGER callbacks_reset_reminder
  BEFORE UPDATE ON callbacks
  FOR EACH ROW EXECUTE FUNCTION reset_callback_reminder();

CREATE TRIGGER trg_warnings_prevent_retarget
  BEFORE UPDATE ON warnings FOR EACH ROW EXECUTE FUNCTION prevent_warning_retarget();

-- Intentionally NOT created: on_auth_user_created AFTER INSERT ON auth.users.
-- See the note at the top of this file.

-- ─── Row Level Security ────────────────────────────────────────────────────
-- ENABLE alone is not enough here: the app's single connecting role OWNS
-- every one of these tables, and Postgres exempts owners from their own
-- RLS by default. FORCE closes that exemption — see point 3 in the header
-- comment.

ALTER TABLE profiles                 ENABLE ROW LEVEL SECURITY; ALTER TABLE profiles                 FORCE ROW LEVEL SECURITY;
ALTER TABLE customers                ENABLE ROW LEVEL SECURITY; ALTER TABLE customers                FORCE ROW LEVEL SECURITY;
ALTER TABLE callbacks                ENABLE ROW LEVEL SECURITY; ALTER TABLE callbacks                FORCE ROW LEVEL SECURITY;
ALTER TABLE followups                ENABLE ROW LEVEL SECURITY; ALTER TABLE followups                FORCE ROW LEVEL SECURITY;
ALTER TABLE followup_status_history  ENABLE ROW LEVEL SECURITY; ALTER TABLE followup_status_history  FORCE ROW LEVEL SECURITY;
ALTER TABLE notifications            ENABLE ROW LEVEL SECURITY; ALTER TABLE notifications            FORCE ROW LEVEL SECURITY;
ALTER TABLE password_reset_requests  ENABLE ROW LEVEL SECURITY; ALTER TABLE password_reset_requests  FORCE ROW LEVEL SECURITY;
ALTER TABLE teams                    ENABLE ROW LEVEL SECURITY; ALTER TABLE teams                    FORCE ROW LEVEL SECURITY;
ALTER TABLE team_members             ENABLE ROW LEVEL SECURITY; ALTER TABLE team_members             FORCE ROW LEVEL SECURITY;
ALTER TABLE shift_templates          ENABLE ROW LEVEL SECURITY; ALTER TABLE shift_templates          FORCE ROW LEVEL SECURITY;
ALTER TABLE team_rotations           ENABLE ROW LEVEL SECURITY; ALTER TABLE team_rotations           FORCE ROW LEVEL SECURITY;
ALTER TABLE attendance_records       ENABLE ROW LEVEL SECURITY; ALTER TABLE attendance_records       FORCE ROW LEVEL SECURITY;
ALTER TABLE roster_overrides         ENABLE ROW LEVEL SECURITY; ALTER TABLE roster_overrides         FORCE ROW LEVEL SECURITY;
ALTER TABLE requests                 ENABLE ROW LEVEL SECURITY; ALTER TABLE requests                 FORCE ROW LEVEL SECURITY;
ALTER TABLE leave_requests           ENABLE ROW LEVEL SECURITY; ALTER TABLE leave_requests           FORCE ROW LEVEL SECURITY;
ALTER TABLE overtime_requests        ENABLE ROW LEVEL SECURITY; ALTER TABLE overtime_requests        FORCE ROW LEVEL SECURITY;
ALTER TABLE overtime_entries         ENABLE ROW LEVEL SECURITY; ALTER TABLE overtime_entries         FORCE ROW LEVEL SECURITY;
ALTER TABLE team_leaders             ENABLE ROW LEVEL SECURITY; ALTER TABLE team_leaders             FORCE ROW LEVEL SECURITY;
ALTER TABLE request_approval_history ENABLE ROW LEVEL SECURITY; ALTER TABLE request_approval_history FORCE ROW LEVEL SECURITY;
ALTER TABLE coaching_agent_checkins  ENABLE ROW LEVEL SECURITY; ALTER TABLE coaching_agent_checkins  FORCE ROW LEVEL SECURITY;
ALTER TABLE coaching_leader_checkins ENABLE ROW LEVEL SECURITY; ALTER TABLE coaching_leader_checkins FORCE ROW LEVEL SECURITY;
ALTER TABLE warnings                 ENABLE ROW LEVEL SECURITY; ALTER TABLE warnings                 FORCE ROW LEVEL SECURITY;

-- profiles
CREATE POLICY "Profiles viewable by authenticated users" ON profiles FOR SELECT USING (TRUE);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (
  current_setting('app.bypass_rls', true) = 'true' OR current_uid() = id
) WITH CHECK (
  current_setting('app.bypass_rls', true) = 'true' OR
  (current_uid() = id AND role = (SELECT p.role FROM profiles p WHERE p.id = current_uid()))
);
CREATE POLICY "Admins can update any profile" ON profiles FOR UPDATE USING (
  current_setting('app.bypass_rls', true) = 'true' OR
  EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role IN ('admin', 'management'))
) WITH CHECK (
  current_setting('app.bypass_rls', true) = 'true' OR
  (
    EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role IN ('admin', 'management'))
    AND (current_uid() <> id OR role = (SELECT p.role FROM profiles p WHERE p.id = current_uid()))
  )
);
CREATE POLICY "Admins can insert profiles" ON profiles FOR INSERT WITH CHECK (
  current_setting('app.bypass_rls', true) = 'true' OR
  EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role IN ('admin', 'management'))
);

-- customers
CREATE POLICY "All users see all customers" ON customers FOR SELECT USING (true);
CREATE POLICY "Agents can insert customers" ON customers FOR INSERT WITH CHECK (
  current_setting('app.bypass_rls', true) = 'true' OR current_uid() = created_by
);
CREATE POLICY "Agents can update their customers" ON customers FOR UPDATE USING (
  current_setting('app.bypass_rls', true) = 'true' OR
  created_by = current_uid() OR
  EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin')
);

-- callbacks
CREATE POLICY "Agents see their own callbacks" ON callbacks FOR SELECT USING (
  current_setting('app.bypass_rls', true) = 'true' OR
  agent_id = current_uid() OR
  EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role IN ('admin', 'management'))
);
CREATE POLICY "Agents can insert callbacks" ON callbacks FOR INSERT WITH CHECK (
  current_setting('app.bypass_rls', true) = 'true' OR agent_id = current_uid()
);
CREATE POLICY "Agents can update their callbacks" ON callbacks FOR UPDATE USING (
  current_setting('app.bypass_rls', true) = 'true' OR
  agent_id = current_uid() OR
  EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin')
);

-- followups
CREATE POLICY "Agents see assigned followups" ON followups FOR SELECT USING (
  current_setting('app.bypass_rls', true) = 'true' OR
  agent_id = current_uid() OR created_by = current_uid() OR
  EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role IN ('admin', 'management'))
);
CREATE POLICY "Authenticated users can insert followups" ON followups FOR INSERT WITH CHECK (
  current_setting('app.bypass_rls', true) = 'true' OR current_uid() = created_by
);
CREATE POLICY "Agents update assigned followups" ON followups FOR UPDATE USING (
  current_setting('app.bypass_rls', true) = 'true' OR
  agent_id = current_uid() OR
  EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role IN ('admin', 'management'))
);

-- followup_status_history (append-only: SELECT + INSERT policies only)
CREATE POLICY "followup_status_history_select" ON followup_status_history FOR SELECT USING (
  current_setting('app.bypass_rls', true) = 'true' OR
  EXISTS (
    SELECT 1 FROM followups f
    WHERE f.id = followup_status_history.followup_id
      AND (
        f.agent_id = current_uid() OR f.created_by = current_uid() OR
        EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role IN ('admin', 'management'))
      )
  )
);
CREATE POLICY "followup_status_history_insert" ON followup_status_history FOR INSERT WITH CHECK (
  current_setting('app.bypass_rls', true) = 'true' OR
  (
    changed_by = current_uid()
    AND EXISTS (
      SELECT 1 FROM followups f
      WHERE f.id = followup_status_history.followup_id
        AND (
          f.agent_id = current_uid() OR f.created_by = current_uid() OR
          EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role IN ('admin', 'management'))
        )
    )
  )
);

-- password_reset_requests (INSERT has no ordinary-user path — Supabase's
-- original had no INSERT policy either, since inserts went through the
-- service-role API key, which bypassed RLS entirely at the connection
-- level. That mechanism doesn't exist here, so this needs an explicit
-- bypass-only policy or the equivalent app/api/auth/request-password-reset
-- route can never insert a row at all.)
CREATE POLICY "password_reset_requests_insert" ON password_reset_requests FOR INSERT WITH CHECK (
  current_setting('app.bypass_rls', true) = 'true'
);
CREATE POLICY "Admins see all reset requests" ON password_reset_requests FOR SELECT USING (
  current_setting('app.bypass_rls', true) = 'true' OR
  EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin')
);
CREATE POLICY "Users see own reset requests" ON password_reset_requests FOR SELECT USING (
  current_setting('app.bypass_rls', true) = 'true' OR profile_id = current_uid()
);

-- notifications
CREATE POLICY "Users see own notifications" ON notifications FOR SELECT USING (
  current_setting('app.bypass_rls', true) = 'true' OR
  recipient_id = current_uid() OR
  EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'management')
);
CREATE POLICY "Authenticated users can insert notifications" ON notifications FOR INSERT WITH CHECK (TRUE);
CREATE POLICY "Users can update own notifications" ON notifications FOR UPDATE USING (
  current_setting('app.bypass_rls', true) = 'true' OR recipient_id = current_uid()
);

-- teams
CREATE POLICY "teams_select" ON teams FOR SELECT USING (true);
CREATE POLICY "teams_insert" ON teams FOR INSERT WITH CHECK (
  current_setting('app.bypass_rls', true) = 'true' OR
  EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role IN ('admin', 'management'))
);
CREATE POLICY "teams_update" ON teams FOR UPDATE USING (
  current_setting('app.bypass_rls', true) = 'true' OR
  EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role IN ('admin', 'management'))
);
CREATE POLICY "teams_delete" ON teams FOR DELETE USING (
  current_setting('app.bypass_rls', true) = 'true' OR
  EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role IN ('admin', 'management'))
);

-- team_members
CREATE POLICY "team_members_select" ON team_members FOR SELECT USING (true);
CREATE POLICY "team_members_insert" ON team_members FOR INSERT WITH CHECK (
  current_setting('app.bypass_rls', true) = 'true' OR
  EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role IN ('admin', 'management'))
);
CREATE POLICY "team_members_update" ON team_members FOR UPDATE USING (
  current_setting('app.bypass_rls', true) = 'true' OR
  EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role IN ('admin', 'management'))
);
CREATE POLICY "team_members_delete" ON team_members FOR DELETE USING (
  current_setting('app.bypass_rls', true) = 'true' OR
  EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role IN ('admin', 'management'))
);

-- shift_templates (write access NOT widened to management — matches live)
CREATE POLICY "shift_templates_select" ON shift_templates FOR SELECT USING (true);
CREATE POLICY "shift_templates_insert" ON shift_templates FOR INSERT WITH CHECK (
  current_setting('app.bypass_rls', true) = 'true' OR
  EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin')
);
CREATE POLICY "shift_templates_update" ON shift_templates FOR UPDATE USING (
  current_setting('app.bypass_rls', true) = 'true' OR
  EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin')
);
CREATE POLICY "shift_templates_delete" ON shift_templates FOR DELETE USING (
  current_setting('app.bypass_rls', true) = 'true' OR
  EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin')
);

-- team_rotations (write access NOT widened to management — matches live)
CREATE POLICY "team_rotations_select" ON team_rotations FOR SELECT USING (true);
CREATE POLICY "team_rotations_insert" ON team_rotations FOR INSERT WITH CHECK (
  current_setting('app.bypass_rls', true) = 'true' OR
  EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin')
);
CREATE POLICY "team_rotations_update" ON team_rotations FOR UPDATE USING (
  current_setting('app.bypass_rls', true) = 'true' OR
  EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin')
);
CREATE POLICY "team_rotations_delete" ON team_rotations FOR DELETE USING (
  current_setting('app.bypass_rls', true) = 'true' OR
  EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin')
);

-- attendance_records (SELECT widened to management; writes stay admin-only — matches live)
CREATE POLICY "attendance_select" ON attendance_records FOR SELECT USING (
  current_setting('app.bypass_rls', true) = 'true' OR
  profile_id = current_uid() OR
  EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role IN ('admin', 'management'))
);
CREATE POLICY "attendance_insert" ON attendance_records FOR INSERT WITH CHECK (
  current_setting('app.bypass_rls', true) = 'true' OR
  EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin')
);
CREATE POLICY "attendance_update" ON attendance_records FOR UPDATE USING (
  current_setting('app.bypass_rls', true) = 'true' OR
  EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin')
);
CREATE POLICY "attendance_delete" ON attendance_records FOR DELETE USING (
  current_setting('app.bypass_rls', true) = 'true' OR
  EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin')
);

-- roster_overrides (SELECT widened to management; writes stay admin-only — matches live)
CREATE POLICY "roster_overrides_select" ON roster_overrides FOR SELECT USING (
  current_setting('app.bypass_rls', true) = 'true' OR
  profile_id = current_uid() OR
  EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role IN ('admin', 'management'))
);
CREATE POLICY "roster_overrides_insert" ON roster_overrides FOR INSERT WITH CHECK (
  current_setting('app.bypass_rls', true) = 'true' OR
  EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin')
);
CREATE POLICY "roster_overrides_update" ON roster_overrides FOR UPDATE USING (
  current_setting('app.bypass_rls', true) = 'true' OR
  EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin')
);
CREATE POLICY "roster_overrides_delete" ON roster_overrides FOR DELETE USING (
  current_setting('app.bypass_rls', true) = 'true' OR
  EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin')
);

-- requests (final shape incl. management-requests-access widening)
CREATE POLICY "requests_select" ON requests FOR SELECT USING (
  current_setting('app.bypass_rls', true) = 'true' OR
  profile_id = current_uid()
  OR is_team_leader_for(team_id)
  OR EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin')
  OR (
    EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'management')
    AND is_submitter_team_leader(profile_id)
  )
);
CREATE POLICY "requests_insert" ON requests FOR INSERT WITH CHECK (
  current_setting('app.bypass_rls', true) = 'true' OR profile_id = current_uid()
);
CREATE POLICY "requests_update" ON requests FOR UPDATE USING (
  current_setting('app.bypass_rls', true) = 'true' OR
  profile_id = current_uid()
  OR is_team_leader_for(team_id)
  OR EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin')
  OR (
    EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'management')
    AND is_submitter_team_leader(profile_id)
  )
);
CREATE POLICY "requests_delete" ON requests FOR DELETE USING (
  current_setting('app.bypass_rls', true) = 'true' OR
  profile_id = current_uid()
  OR EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin')
);

-- leave_requests (final shape incl. management-requests-access widening)
CREATE POLICY "leave_requests_select" ON leave_requests FOR SELECT USING (
  current_setting('app.bypass_rls', true) = 'true' OR
  EXISTS (
    SELECT 1 FROM requests r
    WHERE r.id = leave_requests.request_id
      AND (
        r.profile_id = current_uid()
        OR is_team_leader_for(r.team_id)
        OR EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin')
        OR (
          EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'management')
          AND is_submitter_team_leader(r.profile_id)
        )
      )
  )
);
CREATE POLICY "leave_requests_insert" ON leave_requests FOR INSERT WITH CHECK (
  current_setting('app.bypass_rls', true) = 'true' OR
  EXISTS (
    SELECT 1 FROM requests r
    WHERE r.id = leave_requests.request_id
      AND r.profile_id = current_uid()
  )
);
CREATE POLICY "leave_requests_update" ON leave_requests FOR UPDATE USING (
  current_setting('app.bypass_rls', true) = 'true' OR
  EXISTS (
    SELECT 1 FROM requests r
    WHERE r.id = leave_requests.request_id
      AND (
        r.profile_id = current_uid()
        OR is_team_leader_for(r.team_id)
        OR EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin')
        OR (
          EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'management')
          AND is_submitter_team_leader(r.profile_id)
        )
      )
  )
);
CREATE POLICY "leave_requests_delete" ON leave_requests FOR DELETE USING (
  current_setting('app.bypass_rls', true) = 'true' OR
  EXISTS (
    SELECT 1 FROM requests r
    WHERE r.id = leave_requests.request_id
      AND (r.profile_id = current_uid() OR EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin'))
  )
);

-- overtime_requests (final shape incl. management-requests-access widening)
CREATE POLICY "overtime_requests_select" ON overtime_requests FOR SELECT USING (
  current_setting('app.bypass_rls', true) = 'true' OR
  EXISTS (
    SELECT 1 FROM requests r
    WHERE r.id = overtime_requests.request_id
      AND (
        r.profile_id = current_uid()
        OR is_team_leader_for(r.team_id)
        OR EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin')
        OR (
          EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'management')
          AND is_submitter_team_leader(r.profile_id)
        )
      )
  )
);
CREATE POLICY "overtime_requests_insert" ON overtime_requests FOR INSERT WITH CHECK (
  current_setting('app.bypass_rls', true) = 'true' OR
  EXISTS (
    SELECT 1 FROM requests r
    WHERE r.id = overtime_requests.request_id
      AND r.profile_id = current_uid()
  )
);
CREATE POLICY "overtime_requests_update" ON overtime_requests FOR UPDATE USING (
  current_setting('app.bypass_rls', true) = 'true' OR
  EXISTS (
    SELECT 1 FROM requests r
    WHERE r.id = overtime_requests.request_id
      AND (
        r.profile_id = current_uid()
        OR is_team_leader_for(r.team_id)
        OR EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin')
        OR (
          EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'management')
          AND is_submitter_team_leader(r.profile_id)
        )
      )
  )
);
CREATE POLICY "overtime_requests_delete" ON overtime_requests FOR DELETE USING (
  current_setting('app.bypass_rls', true) = 'true' OR
  EXISTS (
    SELECT 1 FROM requests r
    WHERE r.id = overtime_requests.request_id
      AND (r.profile_id = current_uid() OR EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin'))
  )
);

-- overtime_entries (final shape incl. management-requests-access widening)
CREATE POLICY "overtime_entries_select" ON overtime_entries FOR SELECT USING (
  current_setting('app.bypass_rls', true) = 'true' OR
  EXISTS (
    SELECT 1 FROM overtime_requests ot
    JOIN requests r ON r.id = ot.request_id
    WHERE ot.id = overtime_entries.overtime_request_id
      AND (
        r.profile_id = current_uid()
        OR is_team_leader_for(r.team_id)
        OR EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin')
        OR (
          EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'management')
          AND is_submitter_team_leader(r.profile_id)
        )
      )
  )
);
CREATE POLICY "overtime_entries_insert" ON overtime_entries FOR INSERT WITH CHECK (
  current_setting('app.bypass_rls', true) = 'true' OR
  EXISTS (
    SELECT 1 FROM overtime_requests ot
    JOIN requests r ON r.id = ot.request_id
    WHERE ot.id = overtime_entries.overtime_request_id
      AND r.profile_id = current_uid()
  )
);
CREATE POLICY "overtime_entries_update" ON overtime_entries FOR UPDATE USING (
  current_setting('app.bypass_rls', true) = 'true' OR
  EXISTS (
    SELECT 1 FROM overtime_requests ot
    JOIN requests r ON r.id = ot.request_id
    WHERE ot.id = overtime_entries.overtime_request_id
      AND (
        r.profile_id = current_uid()
        OR is_team_leader_for(r.team_id)
        OR EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin')
        OR (
          EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'management')
          AND is_submitter_team_leader(r.profile_id)
        )
      )
  )
);
CREATE POLICY "overtime_entries_delete" ON overtime_entries FOR DELETE USING (
  current_setting('app.bypass_rls', true) = 'true' OR
  EXISTS (
    SELECT 1 FROM overtime_requests ot
    JOIN requests r ON r.id = ot.request_id
    WHERE ot.id = overtime_entries.overtime_request_id
      AND (r.profile_id = current_uid() OR EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin'))
  )
);

-- team_leaders
CREATE POLICY "team_leaders_select" ON team_leaders FOR SELECT USING (true);
CREATE POLICY "team_leaders_insert" ON team_leaders FOR INSERT WITH CHECK (
  current_setting('app.bypass_rls', true) = 'true' OR
  EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role IN ('admin', 'management'))
);
CREATE POLICY "team_leaders_update" ON team_leaders FOR UPDATE USING (
  current_setting('app.bypass_rls', true) = 'true' OR
  EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role IN ('admin', 'management'))
);
CREATE POLICY "team_leaders_delete" ON team_leaders FOR DELETE USING (
  current_setting('app.bypass_rls', true) = 'true' OR
  EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role IN ('admin', 'management'))
);

-- request_approval_history (append-only: SELECT + INSERT policies only.
-- No UPDATE/DELETE policy exists for this table at all — combined with
-- FORCE ROW LEVEL SECURITY above, that makes those operations impossible
-- for every role, including the bypass-flag path. See point 3 in the
-- header comment.)
CREATE POLICY "approval_history_select" ON request_approval_history FOR SELECT USING (
  current_setting('app.bypass_rls', true) = 'true' OR
  EXISTS (SELECT 1 FROM requests r WHERE r.id = request_approval_history.request_id AND r.profile_id = current_uid())
  OR EXISTS (SELECT 1 FROM requests r WHERE r.id = request_approval_history.request_id AND is_team_leader_for(r.team_id))
  OR EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin')
  OR (
    EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'management')
    AND EXISTS (
      SELECT 1 FROM requests r
      WHERE r.id = request_approval_history.request_id
        AND is_submitter_team_leader(r.profile_id)
    )
  )
);
CREATE POLICY "approval_history_insert" ON request_approval_history FOR INSERT WITH CHECK (
  current_setting('app.bypass_rls', true) = 'true' OR
  EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin')
  OR (
    EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'management')
    AND EXISTS (
      SELECT 1 FROM requests r
      WHERE r.id = request_approval_history.request_id
        AND is_submitter_team_leader(r.profile_id)
    )
  )
);

-- coaching_agent_checkins / coaching_leader_checkins (no DELETE policy —
-- rows are toggled via upsert, never removed)
CREATE POLICY "coaching_agent_checkins_select" ON coaching_agent_checkins FOR SELECT USING (
  current_setting('app.bypass_rls', true) = 'true' OR
  EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role IN ('management', 'admin'))
);
CREATE POLICY "coaching_agent_checkins_insert" ON coaching_agent_checkins FOR INSERT WITH CHECK (
  current_setting('app.bypass_rls', true) = 'true' OR
  EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role IN ('management', 'admin'))
);
CREATE POLICY "coaching_agent_checkins_update" ON coaching_agent_checkins FOR UPDATE USING (
  current_setting('app.bypass_rls', true) = 'true' OR
  EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role IN ('management', 'admin'))
) WITH CHECK (
  current_setting('app.bypass_rls', true) = 'true' OR
  EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role IN ('management', 'admin'))
);

CREATE POLICY "coaching_leader_checkins_select" ON coaching_leader_checkins FOR SELECT USING (
  current_setting('app.bypass_rls', true) = 'true' OR
  EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role IN ('management', 'admin'))
);
CREATE POLICY "coaching_leader_checkins_insert" ON coaching_leader_checkins FOR INSERT WITH CHECK (
  current_setting('app.bypass_rls', true) = 'true' OR
  EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role IN ('management', 'admin'))
);
CREATE POLICY "coaching_leader_checkins_update" ON coaching_leader_checkins FOR UPDATE USING (
  current_setting('app.bypass_rls', true) = 'true' OR
  EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role IN ('management', 'admin'))
) WITH CHECK (
  current_setting('app.bypass_rls', true) = 'true' OR
  EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role IN ('management', 'admin'))
);

-- warnings
CREATE POLICY "warnings_insert" ON warnings FOR INSERT WITH CHECK (
  current_setting('app.bypass_rls', true) = 'true' OR
  (
    issued_by = current_uid()
    AND (
      -- Management warning a team leader
      (
        EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'management')
        AND is_submitter_team_leader(issued_to)
      )
      OR
      -- Team leader warning one of their own team's agents
      (
        EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin')
        AND is_submitter_team_leader(current_uid())
        AND issued_to <> current_uid()
        AND EXISTS (SELECT 1 FROM profiles WHERE id = issued_to AND role = 'agent')
        AND EXISTS (
          SELECT 1 FROM team_members tm
          JOIN team_leaders tl ON tl.team_id = tm.team_id
          WHERE tl.profile_id = current_uid() AND tm.profile_id = issued_to
        )
      )
      OR
      -- Plain (non-leading) admin warning any agent, unscoped
      (
        EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin')
        AND NOT is_submitter_team_leader(current_uid())
        AND EXISTS (SELECT 1 FROM profiles WHERE id = issued_to AND role = 'agent')
      )
    )
  )
);
CREATE POLICY "warnings_select" ON warnings FOR SELECT USING (
  current_setting('app.bypass_rls', true) = 'true' OR
  EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'management')
  OR (
    EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin')
    AND is_submitter_team_leader(current_uid())
    AND warnings.issued_to <> current_uid()
    AND EXISTS (SELECT 1 FROM profiles WHERE id = warnings.issued_to AND role = 'agent')
    AND EXISTS (
      SELECT 1 FROM team_members tm
      JOIN team_leaders tl ON tl.team_id = tm.team_id
      WHERE tl.profile_id = current_uid() AND tm.profile_id = warnings.issued_to
    )
  )
  OR (
    EXISTS (SELECT 1 FROM profiles WHERE id = current_uid() AND role = 'admin')
    AND NOT is_submitter_team_leader(current_uid())
    AND EXISTS (SELECT 1 FROM profiles WHERE id = warnings.issued_to AND role = 'agent')
  )
);
CREATE POLICY "warnings_update" ON warnings FOR UPDATE USING (
  current_setting('app.bypass_rls', true) = 'true' OR issued_by = current_uid()
);
CREATE POLICY "warnings_delete" ON warnings FOR DELETE USING (
  current_setting('app.bypass_rls', true) = 'true' OR issued_by = current_uid()
);

-- ─── Seed data ─────────────────────────────────────────────────────────────
-- This script itself runs as the plain connecting role with no user context
-- and no bypass flag set — with FORCE ROW LEVEL SECURITY now active on every
-- table (see above), it would otherwise be denied by teams_insert /
-- shift_templates_insert the same as any other unauthenticated caller.

SET LOCAL app.bypass_rls = 'true';

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

COMMIT;
