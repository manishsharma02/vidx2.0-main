-- ============================================================
-- VidX — COMPLETE SCHEMA MIGRATION
-- Run this entire file in Supabase SQL Editor (once).
-- Safe to re-run: every statement uses IF NOT EXISTS or
-- ADD COLUMN IF NOT EXISTS so existing data is never touched.
-- ============================================================

-- ============================================================
-- 0.  UTILITY: helper to add a column only when missing
-- ============================================================
-- Supabase supports ALTER TABLE ... ADD COLUMN IF NOT EXISTS
-- directly in PostgreSQL 9.6+, which Supabase uses. ✓

-- ============================================================
-- 1.  TABLE: submissions
-- ============================================================

-- Create the table from scratch if it has never been created
CREATE TABLE IF NOT EXISTS submissions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  problem_id      uuid        NOT NULL,
  submitted_at    timestamptz NOT NULL DEFAULT now()
);

-- Core judging columns
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS verdict          text        DEFAULT 'Pending';
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS status          text        DEFAULT 'incorrect';
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS language        text        DEFAULT 'python';
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS code            text;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS xp_gained       integer     DEFAULT 0;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS passed_cases    integer     DEFAULT 0;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS total_cases     integer     DEFAULT 0;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS runtime_ms      integer     DEFAULT 0;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS time_taken      integer     DEFAULT 0;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS submission_mode text        DEFAULT 'code';
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS streak_bonus    integer     DEFAULT 0;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS position        integer;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS is_first_solve  boolean     DEFAULT false;

-- Index for fast per-user lookups (profile page, XP calc)
CREATE INDEX IF NOT EXISTS idx_submissions_user_id
  ON submissions (user_id);

-- Index for fast per-problem lookups (solve count, stats)
CREATE INDEX IF NOT EXISTS idx_submissions_problem_id
  ON submissions (problem_id);

-- Index for activity feed (admin dashboard)
CREATE INDEX IF NOT EXISTS idx_submissions_submitted_at
  ON submissions (submitted_at DESC);

-- ============================================================
-- 2.  TABLE: users  (public profile table, mirrors auth.users)
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id          uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       text        UNIQUE NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Registration fields
ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name       text        DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name        text        DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS college          text        DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS branch           text        DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS year             text        DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS experience_level text        DEFAULT 'newbie';

-- XP / rank / streak
ALTER TABLE users ADD COLUMN IF NOT EXISTS xp               integer     DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS rank_title       text        DEFAULT 'Newbie';
ALTER TABLE users ADD COLUMN IF NOT EXISTS problems_solved  integer     DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS streak           integer     DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_solve_date  date;

-- Bookmarks and likes stored as UUID arrays
ALTER TABLE users ADD COLUMN IF NOT EXISTS bookmarks        uuid[]      DEFAULT '{}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS liked_problems   uuid[]      DEFAULT '{}';

-- Admin flag
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin         boolean     DEFAULT false;

-- ============================================================
-- 3.  TABLE: problems
-- ============================================================

CREATE TABLE IF NOT EXISTS problems (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Core fields
ALTER TABLE problems ADD COLUMN IF NOT EXISTS title                 text        NOT NULL DEFAULT 'Untitled';
ALTER TABLE problems ADD COLUMN IF NOT EXISTS description           text        DEFAULT '';
ALTER TABLE problems ADD COLUMN IF NOT EXISTS difficulty            text        DEFAULT 'Easy';
ALTER TABLE problems ADD COLUMN IF NOT EXISTS topic                 text        DEFAULT 'General';
ALTER TABLE problems ADD COLUMN IF NOT EXISTS xp_reward             integer     DEFAULT 50;

-- IO / test data
ALTER TABLE problems ADD COLUMN IF NOT EXISTS sample_input          text;
ALTER TABLE problems ADD COLUMN IF NOT EXISTS sample_output         text;
ALTER TABLE problems ADD COLUMN IF NOT EXISTS test_cases            jsonb       DEFAULT '[]';
ALTER TABLE problems ADD COLUMN IF NOT EXISTS hidden_test_cases     jsonb       DEFAULT '[]';

-- Extra content
ALTER TABLE problems ADD COLUMN IF NOT EXISTS constraints           text;
ALTER TABLE problems ADD COLUMN IF NOT EXISTS hint                  text;
ALTER TABLE problems ADD COLUMN IF NOT EXISTS editorial             text;
ALTER TABLE problems ADD COLUMN IF NOT EXISTS companies             text[]      DEFAULT '{}';

-- Daily problem fields
ALTER TABLE problems ADD COLUMN IF NOT EXISTS is_daily              boolean     DEFAULT false;
ALTER TABLE problems ADD COLUMN IF NOT EXISTS daily_date            date;

-- Solve counters
ALTER TABLE problems ADD COLUMN IF NOT EXISTS solve_count               integer DEFAULT 0;
ALTER TABLE problems ADD COLUMN IF NOT EXISTS correct_submission_count  integer DEFAULT 0;
ALTER TABLE problems ADD COLUMN IF NOT EXISTS attempt_count             integer DEFAULT 0;

-- Fix / re-create the difficulty check constraint to use Easy/Medium/Hard
-- (drop old one if it exists with wrong values, then recreate)
DO $$
BEGIN
  -- drop any existing difficulty constraint by name
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'problems_difficulty_check'
      AND table_name = 'problems'
  ) THEN
    ALTER TABLE problems DROP CONSTRAINT problems_difficulty_check;
  END IF;
  -- add the correct constraint
  ALTER TABLE problems ADD CONSTRAINT problems_difficulty_check
    CHECK (difficulty IN ('Easy', 'Medium', 'Hard'));
EXCEPTION WHEN others THEN
  RAISE NOTICE 'Could not recreate difficulty constraint: %', SQLERRM;
END;
$$;

-- ============================================================
-- 4.  TABLE: notifications
-- ============================================================

CREATE TABLE IF NOT EXISTS notifications (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS user_id   uuid        REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS title     text        DEFAULT 'Notice';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS message   text        DEFAULT '';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS type      text        DEFAULT 'info';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS is_read   boolean     DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_notifications_user_id
  ON notifications (user_id);

CREATE INDEX IF NOT EXISTS idx_notifications_created_at
  ON notifications (created_at DESC);

-- ============================================================
-- 5.  TABLE: votes
-- ============================================================

CREATE TABLE IF NOT EXISTS votes (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE votes ADD COLUMN IF NOT EXISTS user_id        uuid        REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE votes ADD COLUMN IF NOT EXISTS vote_for       text        NOT NULL DEFAULT '';
ALTER TABLE votes ADD COLUMN IF NOT EXISTS vote_date      date        NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE votes ADD COLUMN IF NOT EXISTS student_name   text        DEFAULT '';
ALTER TABLE votes ADD COLUMN IF NOT EXISTS student_email  text        DEFAULT '';
ALTER TABLE votes ADD COLUMN IF NOT EXISTS is_read        boolean     DEFAULT false;
ALTER TABLE votes ADD COLUMN IF NOT EXISTS voted_at       timestamptz DEFAULT now();
ALTER TABLE votes ADD COLUMN IF NOT EXISTS topic          text;

-- One vote per user per day
CREATE UNIQUE INDEX IF NOT EXISTS idx_votes_user_date
  ON votes (user_id, vote_date);

-- ============================================================
-- 6.  ROW LEVEL SECURITY — enable and set sensible policies
-- ============================================================

-- submissions
ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own submissions"  ON submissions;
DROP POLICY IF EXISTS "Users can insert own submissions" ON submissions;
DROP POLICY IF EXISTS "Admins read all submissions"     ON submissions;

CREATE POLICY "Users can read own submissions"
  ON submissions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own submissions"
  ON submissions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Allow the service role (used by supabase.js server calls) to bypass RLS
-- This is handled automatically by the service_role key; no extra policy needed.

-- users (public profiles — everyone logged in can read, only owner can write)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone logged in can read users"  ON users;
DROP POLICY IF EXISTS "Owner can update own profile"     ON users;
DROP POLICY IF EXISTS "Owner can insert own profile"     ON users;

CREATE POLICY "Anyone logged in can read users"
  ON users FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Owner can update own profile"
  ON users FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Owner can insert own profile"
  ON users FOR INSERT
  WITH CHECK (auth.uid() = id);

-- problems (everyone logged in can read; only service_role can insert/update)
ALTER TABLE problems ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read problems" ON problems;

CREATE POLICY "Anyone can read problems"
  ON problems FOR SELECT
  USING (true);

-- notifications
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own notifications"  ON notifications;
DROP POLICY IF EXISTS "Users can update own notifications" ON notifications;

CREATE POLICY "Users can read own notifications"
  ON notifications FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own notifications"
  ON notifications FOR UPDATE
  USING (auth.uid() = user_id);

-- votes
ALTER TABLE votes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone logged in can read votes"  ON votes;
DROP POLICY IF EXISTS "Users can insert own votes"       ON votes;

CREATE POLICY "Anyone logged in can read votes"
  ON votes FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Users can insert own votes"
  ON votes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 7.  RELOAD PostgREST schema cache
--     (makes all new columns immediately visible to the API)
-- ============================================================
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- DONE.
-- After running, verify in Table Editor that:
--   submissions  has: verdict, xp_gained, passed_cases,
--                     total_cases, runtime_ms, status,
--                     language, code, time_taken,
--                     submission_mode, streak_bonus, position
--   users        has: bookmarks, liked_problems, last_solve_date,
--                     problems_solved, rank_title, experience_level
--   problems     has: test_cases (jsonb), hidden_test_cases (jsonb),
--                     companies (text[]), difficulty constraint Easy/Medium/Hard
--   notifications has: title, type, is_read
--   votes        has: student_name, student_email, is_read, voted_at
-- ============================================================