-- ============================================================
-- Widen followups RLS so 'management' can view/update the
-- follow-ups they create and assign (they don't own an agent_id
-- queue, but they are created_by on rows they assign). Also adds
-- followup_status_history, an immutable audit log of every status
-- transition on followups, mirroring request_approval_history's
-- exact shape (see supabase/team-leaders-schema.sql section 3).
-- Run this in the Supabase SQL Editor.
-- Safe to run on a live database — no data changes; RLS policies
-- are dropped/recreated, the new table is additive.
-- ============================================================

-- ─── 1. Widen followups RLS to include management ────────────────────────────

DROP POLICY IF EXISTS "Agents see assigned followups" ON followups;
CREATE POLICY "Agents see assigned followups" ON followups FOR SELECT TO authenticated USING (
  agent_id = auth.uid() OR created_by = auth.uid() OR
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'management'))
);

DROP POLICY IF EXISTS "Agents update assigned followups" ON followups;
CREATE POLICY "Agents update assigned followups" ON followups FOR UPDATE TO authenticated USING (
  agent_id = auth.uid() OR
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'management'))
);

-- INSERT policy ("Authenticated users can insert followups") only checks
-- created_by = auth.uid() with no role branch — management already
-- satisfies this unmodified; no change needed there.

-- ─── 2. followup_status_history table ─────────────────────────────────────────
-- Immutable audit log, universal (every followup, any creator). No UPDATE
-- or DELETE policies are granted.

CREATE TABLE IF NOT EXISTS followup_status_history (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  followup_id  uuid        NOT NULL REFERENCES followups(id) ON DELETE CASCADE,
  changed_by   uuid        NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  from_status  text        NOT NULL,
  to_status    text        NOT NULL,
  comment      text,
  changed_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_followup_status_history_followup_id ON followup_status_history (followup_id);
CREATE INDEX IF NOT EXISTS idx_followup_status_history_changed_by ON followup_status_history (changed_by);
CREATE INDEX IF NOT EXISTS idx_followup_status_history_changed_at ON followup_status_history (changed_at);

ALTER TABLE followup_status_history ENABLE ROW LEVEL SECURITY;

-- SELECT: anyone who can already see the parent followup can see its history.
DROP POLICY IF EXISTS "followup_status_history_select" ON followup_status_history;
CREATE POLICY "followup_status_history_select" ON followup_status_history
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM followups f
      WHERE f.id = followup_status_history.followup_id
        AND (
          f.agent_id = auth.uid()
          OR f.created_by = auth.uid()
          OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'management'))
        )
    )
  );

-- INSERT: unlike request_approval_history (admin-only reviewers write it),
-- followup status transitions are performed by the assigned agent
-- themselves too, not just admin/management — mirrors "Agents update
-- assigned followups" above, plus requires changed_by to match the caller
-- (no writing history on someone else's behalf).
DROP POLICY IF EXISTS "followup_status_history_insert" ON followup_status_history;
CREATE POLICY "followup_status_history_insert" ON followup_status_history
  FOR INSERT TO authenticated
  WITH CHECK (
    changed_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM followups f
      WHERE f.id = followup_status_history.followup_id
        AND (
          f.agent_id = auth.uid()
          OR f.created_by = auth.uid()
          OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'management'))
        )
    )
  );
