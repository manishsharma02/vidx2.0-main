-- ============================================================
-- VidX — COMPLETE SETUP (run ONCE in Supabase → SQL Editor → New query)
-- Safe to re-run: everything is IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
-- It creates every table/column the website code uses, the unique keys the
-- code relies on, a signup trigger (so "Create account" works even when
-- email-confirmation is ON), and Row Level Security policies.
--
-- ⚠ SECURITY NOTE (read this):
-- The admin panel logs in with a hardcoded password inside login.html and then
-- talks to Supabase with the public "anon" key. For the admin pages (add
-- problems, edit XP, battles, notifications) to work, the policies below allow
-- the anon key full access to the app tables. That means anyone who opens the
-- site's JS can also read/write these tables. Fine for a college/demo project;
-- before going public, move admin to a real Supabase Auth admin user and
-- tighten the policies (section 9).
-- ============================================================

-- ---------- 1. USERS ----------
CREATE TABLE IF NOT EXISTS public.users (
  id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS first_name        text DEFAULT '';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS last_name         text DEFAULT '';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS college           text DEFAULT '';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS branch            text DEFAULT '';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS year              text DEFAULT '';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS experience_level  text DEFAULT 'newbie';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS xp                integer DEFAULT 0;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS rank_title        text DEFAULT 'Newbie';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS problems_solved   integer DEFAULT 0;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS streak            integer DEFAULT 0;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS last_solved_date  date;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS last_solve_date   date;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS avatar_url        text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_admin          boolean DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_users_xp ON public.users (xp DESC);

-- Auto-create the profile row when someone signs up (uses the signup metadata)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.users (id, email, first_name, last_name, college, branch, year, experience_level, xp, streak, problems_solved, rank_title)
  VALUES (
    NEW.id, NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'first_name',''),
    COALESCE(NEW.raw_user_meta_data->>'last_name',''),
    COALESCE(NEW.raw_user_meta_data->>'college',''),
    COALESCE(NEW.raw_user_meta_data->>'branch',''),
    COALESCE(NEW.raw_user_meta_data->>'year',''),
    COALESCE(NEW.raw_user_meta_data->>'experience_level','newbie'),
    0, 0, 0, 'Newbie')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN others THEN
  RETURN NEW;  -- never block signup because of a profile problem
END $$;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Back-fill profiles for accounts that were created but have no profile row
INSERT INTO public.users (id, email)
SELECT u.id, u.email FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.users p WHERE p.id = u.id)
ON CONFLICT (id) DO NOTHING;

-- ---------- 2. PROBLEMS ----------
CREATE TABLE IF NOT EXISTS public.problems (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.problems ADD COLUMN IF NOT EXISTS title        text NOT NULL DEFAULT 'Untitled';
ALTER TABLE public.problems ADD COLUMN IF NOT EXISTS description  text DEFAULT '';
ALTER TABLE public.problems ADD COLUMN IF NOT EXISTS difficulty   text DEFAULT 'Easy';
ALTER TABLE public.problems ADD COLUMN IF NOT EXISTS topic        text DEFAULT 'General';
ALTER TABLE public.problems ADD COLUMN IF NOT EXISTS xp_reward    integer DEFAULT 50;
ALTER TABLE public.problems ADD COLUMN IF NOT EXISTS sample_input text;
ALTER TABLE public.problems ADD COLUMN IF NOT EXISTS sample_output text;
ALTER TABLE public.problems ADD COLUMN IF NOT EXISTS test_cases   jsonb DEFAULT '[]';
ALTER TABLE public.problems ADD COLUMN IF NOT EXISTS hidden_test_cases jsonb DEFAULT '[]';
ALTER TABLE public.problems ADD COLUMN IF NOT EXISTS constraints  text;
ALTER TABLE public.problems ADD COLUMN IF NOT EXISTS hint         text;
ALTER TABLE public.problems ADD COLUMN IF NOT EXISTS editorial    text;
ALTER TABLE public.problems ADD COLUMN IF NOT EXISTS companies    text[] DEFAULT '{}';
ALTER TABLE public.problems ADD COLUMN IF NOT EXISTS is_daily     boolean DEFAULT false;
ALTER TABLE public.problems ADD COLUMN IF NOT EXISTS daily_date   date;
ALTER TABLE public.problems ADD COLUMN IF NOT EXISTS solve_count  integer DEFAULT 0;
ALTER TABLE public.problems ADD COLUMN IF NOT EXISTS correct_submission_count integer DEFAULT 0;
ALTER TABLE public.problems ADD COLUMN IF NOT EXISTS attempt_count integer DEFAULT 0;
-- The site uses Easy/Medium/Hard (older pages used Beginner/Intermediate/Advanced): allow all
ALTER TABLE public.problems DROP CONSTRAINT IF EXISTS problems_difficulty_check;
ALTER TABLE public.problems ADD CONSTRAINT problems_difficulty_check
  CHECK (difficulty IN ('Easy','Medium','Hard','Beginner','Intermediate','Advanced'));

-- ---------- 3. SUBMISSIONS ----------
CREATE TABLE IF NOT EXISTS public.submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  problem_id uuid NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS status          text DEFAULT 'wrong';
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS verdict         text;
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS language        text;
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS code            text;
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS xp_gained       integer DEFAULT 0;
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS passed_cases    integer DEFAULT 0;
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS total_cases     integer DEFAULT 0;
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS runtime_ms      integer DEFAULT 0;
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS time_taken      integer DEFAULT 0;
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS time_taken_mins integer DEFAULT 0;
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS submission_mode text DEFAULT 'code';
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS position        integer;
ALTER TABLE public.submissions DROP CONSTRAINT IF EXISTS submissions_status_check;
CREATE INDEX IF NOT EXISTS idx_submissions_user    ON public.submissions (user_id);
CREATE INDEX IF NOT EXISTS idx_submissions_problem ON public.submissions (problem_id);
CREATE INDEX IF NOT EXISTS idx_submissions_time    ON public.submissions (submitted_at DESC);

-- ---------- 4. NOTIFICATIONS / VOTES ----------
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS title   text DEFAULT 'Notice';
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS message text DEFAULT '';
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS type    text DEFAULT 'info';
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS is_read boolean DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications (user_id);

CREATE TABLE IF NOT EXISTS public.problem_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  vote_for text NOT NULL,
  vote_date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_problem_votes_user_date ON public.problem_votes (user_id, vote_date);

CREATE TABLE IF NOT EXISTS public.vote_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid,
  student_name text,
  student_email text,
  topic text,
  is_read boolean DEFAULT false,
  voted_at timestamptz NOT NULL DEFAULT now()
);

-- older schema file created "votes"; keep it compatible if it exists
CREATE TABLE IF NOT EXISTS public.votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid, vote_for text DEFAULT '', vote_date date DEFAULT CURRENT_DATE,
  student_name text DEFAULT '', student_email text DEFAULT '', is_read boolean DEFAULT false,
  voted_at timestamptz DEFAULT now(), topic text
);

-- ---------- 5. BOOKMARKS / LIKES ----------
CREATE TABLE IF NOT EXISTS public.problem_bookmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL, problem_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookmarks_uniq ON public.problem_bookmarks (user_id, problem_id);
CREATE TABLE IF NOT EXISTS public.problem_likes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL, problem_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_likes_uniq ON public.problem_likes (user_id, problem_id);

-- ---------- 6. DISCUSSIONS ----------
CREATE TABLE IF NOT EXISTS public.discussions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid, title text NOT NULL DEFAULT '', content text NOT NULL DEFAULT '',
  type text DEFAULT 'question', upvotes integer DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.discussion_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discussion_id uuid NOT NULL, user_id uuid, content text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_replies_discussion ON public.discussion_replies (discussion_id);

-- ---------- 7. BATTLES ----------
CREATE TABLE IF NOT EXISTS public.battles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.battles ADD COLUMN IF NOT EXISTS title text NOT NULL DEFAULT 'Battle';
ALTER TABLE public.battles ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.battles ADD COLUMN IF NOT EXISTS difficulty text DEFAULT 'Intermediate';
ALTER TABLE public.battles ADD COLUMN IF NOT EXISTS battle_type text DEFAULT 'open';
ALTER TABLE public.battles ADD COLUMN IF NOT EXISTS xp_reward integer DEFAULT 200;
ALTER TABLE public.battles ADD COLUMN IF NOT EXISTS start_time timestamptz;
ALTER TABLE public.battles ADD COLUMN IF NOT EXISTS end_time timestamptz;
ALTER TABLE public.battles ADD COLUMN IF NOT EXISTS registration_deadline timestamptz;
ALTER TABLE public.battles ADD COLUMN IF NOT EXISTS max_participants integer DEFAULT 100;
ALTER TABLE public.battles ADD COLUMN IF NOT EXISTS participant_count integer DEFAULT 0;
ALTER TABLE public.battles ADD COLUMN IF NOT EXISTS status text DEFAULT 'draft';
ALTER TABLE public.battles ADD COLUMN IF NOT EXISTS allowed_branches text[];
ALTER TABLE public.battles ADD COLUMN IF NOT EXISTS allowed_years text[];
ALTER TABLE public.battles ADD COLUMN IF NOT EXISTS winner_id uuid;
ALTER TABLE public.battles ADD COLUMN IF NOT EXISTS results_published boolean DEFAULT false;
ALTER TABLE public.battles ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE public.battles DROP CONSTRAINT IF EXISTS battles_status_check;

CREATE TABLE IF NOT EXISTS public.battle_problems (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  battle_id uuid NOT NULL, problem_id uuid NOT NULL,
  problem_order integer DEFAULT 1, points integer DEFAULT 100
);
CREATE TABLE IF NOT EXISTS public.battle_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  battle_id uuid NOT NULL, user_id uuid NOT NULL,
  score integer DEFAULT 0, problems_solved integer DEFAULT 0, penalty integer DEFAULT 0, xp_earned integer DEFAULT 0,
  last_submission_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bparticipants_uniq ON public.battle_participants (battle_id, user_id);
CREATE TABLE IF NOT EXISTS public.battle_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  battle_id uuid NOT NULL, user_id uuid NOT NULL, problem_id uuid NOT NULL,
  code text, language text, verdict text, score integer DEFAULT 0,
  passed_cases integer DEFAULT 0, total_cases integer DEFAULT 0, runtime_ms integer DEFAULT 0,
  submitted_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.battle_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  battle_id uuid NOT NULL, user_id uuid NOT NULL,
  final_rank integer, final_score integer DEFAULT 0, problems_solved integer DEFAULT 0,
  xp_awarded integer DEFAULT 0, badge text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bresults_uniq ON public.battle_results (battle_id, user_id);
CREATE TABLE IF NOT EXISTS public.battle_badges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL, battle_id uuid NOT NULL, badge_type text, created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- 8. ROW LEVEL SECURITY ----------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','problems','submissions','notifications','problem_votes','vote_notifications','votes',
    'problem_bookmarks','problem_likes','discussions','discussion_replies','battles','battle_problems',
    'battle_participants','battle_submissions','battle_results','battle_badges']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    -- remove older restrictive policies from schema-upgrade.sql so they can't conflict
    EXECUTE format('DROP POLICY IF EXISTS "vidx_open_access" ON public.%I', t);
    EXECUTE format('CREATE POLICY "vidx_open_access" ON public.%I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)', t);
    EXECUTE format('GRANT ALL ON public.%I TO anon, authenticated', t);
  END LOOP;
END $$;

-- ---------- 9. (LATER) TIGHTEN ----------
-- When admin uses real Supabase Auth: replace "vidx_open_access" on users/problems/battles*/notifications with
--   SELECT for authenticated; INSERT/UPDATE/DELETE only WHERE (auth.uid() = id) or is_admin.

-- ---------- 10. Refresh API schema cache ----------
NOTIFY pgrst, 'reload schema';
