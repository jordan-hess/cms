-- ============================================================
-- Warnings: team leaders issue verbal/written/final warnings to
-- their own team's agents; plain (non-leading) admins issue them
-- to any agent org-wide; management issues them to team leaders.
-- Reuses is_submitter_team_leader(profile_id), already live from
-- the management-requests-approval migration, to answer "is this
-- profile a team leader" for both the issuer and target side.
-- Run this in the Supabase SQL Editor.
-- Safe to run on a live database — additive only.
-- ============================================================

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

-- Reuse the set_updated_at() function already created by schema.sql
CREATE TRIGGER trg_warnings_updated_at
  BEFORE UPDATE ON warnings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE warnings ENABLE ROW LEVEL SECURITY;

-- INSERT: issuer must actually be entitled to warn this specific target.
CREATE POLICY "warnings_insert" ON warnings FOR INSERT TO authenticated WITH CHECK (
  issued_by = auth.uid()
  AND (
    -- Management warning a team leader
    (
      EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'management')
      AND is_submitter_team_leader(issued_to)
    )
    OR
    -- Team leader warning one of their own team's agents
    (
      EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
      AND is_submitter_team_leader(auth.uid())
      AND EXISTS (
        SELECT 1 FROM team_members tm
        JOIN team_leaders tl ON tl.team_id = tm.team_id
        WHERE tl.profile_id = auth.uid() AND tm.profile_id = issued_to
      )
    )
    OR
    -- Plain (non-leading) admin warning any agent, unscoped
    (
      EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
      AND NOT is_submitter_team_leader(auth.uid())
      AND EXISTS (SELECT 1 FROM profiles WHERE id = issued_to AND role = 'agent')
    )
  )
);

-- SELECT: same three-way scoping as INSERT, keyed off the row's issued_to;
-- management gets blanket visibility across both audiences.
CREATE POLICY "warnings_select" ON warnings FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'management')
  OR (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    AND is_submitter_team_leader(auth.uid())
    AND EXISTS (
      SELECT 1 FROM team_members tm
      JOIN team_leaders tl ON tl.team_id = tm.team_id
      WHERE tl.profile_id = auth.uid() AND tm.profile_id = warnings.issued_to
    )
  )
  OR (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    AND NOT is_submitter_team_leader(auth.uid())
    AND EXISTS (SELECT 1 FROM profiles WHERE id = warnings.issued_to AND role = 'agent')
  )
);

-- UPDATE/DELETE: issuer only, regardless of role or view scope.
CREATE POLICY "warnings_update" ON warnings FOR UPDATE TO authenticated USING (issued_by = auth.uid());
CREATE POLICY "warnings_delete" ON warnings FOR DELETE TO authenticated USING (issued_by = auth.uid());
