-- ============================================================
-- Requests Schema (Leave & Overtime)
-- Run this in the Supabase SQL Editor after roster-schema.sql
-- ============================================================

-- ─── Tables ──────────────────────────────────────────────────────────────────

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
  ot_1_5              numeric(4,2) NOT NULL DEFAULT 0,
  ot_2_0              numeric(4,2) NOT NULL DEFAULT 0,
  night_hours          numeric(4,2) NOT NULL DEFAULT 0,
  sort_order           int NOT NULL DEFAULT 0
);
CREATE INDEX idx_overtime_entries_overtime_request_id ON overtime_entries (overtime_request_id);

-- ─── Triggers ────────────────────────────────────────────────────────────────

-- Reuse the set_updated_at() function already created by schema.sql
CREATE TRIGGER trg_requests_updated_at
  BEFORE UPDATE ON requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE requests         ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests   ENABLE ROW LEVEL SECURITY;
ALTER TABLE overtime_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE overtime_entries  ENABLE ROW LEVEL SECURITY;

-- requests: agents see their own rows; admins see all
CREATE POLICY "requests_select" ON requests FOR SELECT TO authenticated
  USING (
    profile_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "requests_insert" ON requests FOR INSERT TO authenticated
  WITH CHECK (profile_id = auth.uid());

CREATE POLICY "requests_update" ON requests FOR UPDATE TO authenticated
  USING (
    profile_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "requests_delete" ON requests FOR DELETE TO authenticated
  USING (
    profile_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- leave_requests: via parent requests join
CREATE POLICY "leave_requests_select" ON leave_requests FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM requests r
      WHERE r.id = leave_requests.request_id
        AND (r.profile_id = auth.uid() OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
    )
  );

CREATE POLICY "leave_requests_insert" ON leave_requests FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM requests r
      WHERE r.id = leave_requests.request_id
        AND r.profile_id = auth.uid()
    )
  );

CREATE POLICY "leave_requests_update" ON leave_requests FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM requests r
      WHERE r.id = leave_requests.request_id
        AND (r.profile_id = auth.uid() OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
    )
  );

CREATE POLICY "leave_requests_delete" ON leave_requests FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM requests r
      WHERE r.id = leave_requests.request_id
        AND (r.profile_id = auth.uid() OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
    )
  );

-- overtime_requests: via parent requests join
CREATE POLICY "overtime_requests_select" ON overtime_requests FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM requests r
      WHERE r.id = overtime_requests.request_id
        AND (r.profile_id = auth.uid() OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
    )
  );

CREATE POLICY "overtime_requests_insert" ON overtime_requests FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM requests r
      WHERE r.id = overtime_requests.request_id
        AND r.profile_id = auth.uid()
    )
  );

CREATE POLICY "overtime_requests_update" ON overtime_requests FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM requests r
      WHERE r.id = overtime_requests.request_id
        AND (r.profile_id = auth.uid() OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
    )
  );

CREATE POLICY "overtime_requests_delete" ON overtime_requests FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM requests r
      WHERE r.id = overtime_requests.request_id
        AND (r.profile_id = auth.uid() OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
    )
  );

-- overtime_entries: via overtime_requests → requests join
CREATE POLICY "overtime_entries_select" ON overtime_entries FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM overtime_requests ot
      JOIN requests r ON r.id = ot.request_id
      WHERE ot.id = overtime_entries.overtime_request_id
        AND (r.profile_id = auth.uid() OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
    )
  );

CREATE POLICY "overtime_entries_insert" ON overtime_entries FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM overtime_requests ot
      JOIN requests r ON r.id = ot.request_id
      WHERE ot.id = overtime_entries.overtime_request_id
        AND r.profile_id = auth.uid()
    )
  );

CREATE POLICY "overtime_entries_update" ON overtime_entries FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM overtime_requests ot
      JOIN requests r ON r.id = ot.request_id
      WHERE ot.id = overtime_entries.overtime_request_id
        AND (r.profile_id = auth.uid() OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
    )
  );

CREATE POLICY "overtime_entries_delete" ON overtime_entries FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM overtime_requests ot
      JOIN requests r ON r.id = ot.request_id
      WHERE ot.id = overtime_entries.overtime_request_id
        AND (r.profile_id = auth.uid() OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
    )
  );
