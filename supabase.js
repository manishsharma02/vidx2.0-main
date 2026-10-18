// supabase.js — load this BEFORE any inline script on every page
// (repaired: syntax errors removed, robust auth/profile, cached fast loading, column-safe writes)

const SUPABASE_URL = 'https://kmyieimynwedgrpmrgmu.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtteWllaW15bndlZGdycG1yZ211Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzNTg2NzYsImV4cCI6MjA5NDkzNDY3Nn0.CJ1JMRSYcJGhbrztlHHWP4wIf7MIOwmUEyu8fwhEVv0';

// ─── SDK LOAD + onDbReady (fires once, after BOTH sdk loaded and page scripts defined) ───
(function () {
  let sdkReady = false, domReady = false, fired = false;
  function tryFire() {
    if (fired || !sdkReady || !domReady) return;
    fired = true;
    if (typeof window.onDbReady === 'function') {
      try {
        const r = window.onDbReady();
        if (r && typeof r.catch === 'function') r.catch(e => console.error('onDbReady:', e));
      } catch (e) { console.error('onDbReady:', e); }
    }
  }
  function makeClient() {
    // autoRefreshToken:false is intentional: this is a classic multi-page site (every
    // click is a full page reload, not a SPA), so a persistent background refresh timer
    // is not needed and is actively harmful — Supabase refresh tokens are single-use, and
    // if the browser aborts a background refresh request mid-flight because the user
    // navigated to a new page, the old refresh token is left burned while the new one
    // never got saved, permanently killing the session ("logged out after 1-2 minutes").
    // getSession() below still auto-refreshes an expired session on every page load, so
    // sessions remain valid for their full lifetime — they just aren't refreshed mid-page.
    window.db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: false, detectSessionInUrl: true }
    });
    sdkReady = true;
    tryFire();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { domReady = true; tryFire(); });
  } else { domReady = true; }

  const s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
  s.onload = makeClient;
  s.onerror = () => {
    const s2 = document.createElement('script');
    s2.src = 'https://unpkg.com/@supabase/supabase-js@2';
    s2.onload = makeClient;
    document.head.appendChild(s2);
  };
  document.head.appendChild(s);
})();

// ─── GENERIC HELPERS ────────────────────────────────────────────────────────

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function isSchemaOrRlsError(err) {
  const msg = (err?.message || err?.code || '').toString().toLowerCase();
  return msg.includes('schema cache') || msg.includes('column') || msg.includes('row-level security') || msg.includes('pgrst') || msg.includes('does not exist');
}

function _missingColumn(err) {
  const m = (err && err.message) || '';
  let r = m.match(/Could not find the '([^']+)' column/i);
  if (r) return r[1];
  r = m.match(/column "?([a-z0-9_]+)"? of relation/i);
  if (r) return r[1];
  r = m.match(/column ([a-z0-9_.]+) does not exist/i);
  if (r) return r[1].split('.').pop();
  return null;
}

// Insert that drops columns the real table doesn't have (retries) instead of failing.
async function _safeInsert(table, row, opts = {}) {
  let payload = Array.isArray(row) ? row.map(r => ({ ...r })) : { ...row };
  for (let i = 0; i < 25; i++) {
    let q = window.db.from(table).insert(payload);
    if (opts.select) q = q.select();
    if (opts.single) q = q.single();
    const { data, error } = await q;
    if (!error) return { data, error: null };
    const col = _missingColumn(error);
    const has = Array.isArray(payload) ? payload.some(r => col in r) : (col in payload);
    if (col && has) {
      if (Array.isArray(payload)) payload.forEach(r => delete r[col]); else delete payload[col];
      continue;
    }
    return { data: null, error };
  }
  return { data: null, error: new Error('Too many missing columns for ' + table) };
}

async function _safeUpdate(table, values, matchFn) {
  let payload = { ...values };
  for (let i = 0; i < 25; i++) {
    if (!Object.keys(payload).length) return { error: null };
    const { error } = await matchFn(window.db.from(table).update(payload));
    if (!error) return { error: null };
    const col = _missingColumn(error);
    if (col && col in payload) { delete payload[col]; continue; }
    return { error };
  }
  return { error: new Error('Too many missing columns for ' + table) };
}

function normDiff(d) {
  const x = (d || '').toString().toLowerCase();
  if (x === 'easy' || x === 'beginner') return 'easy';
  if (x === 'medium' || x === 'intermediate') return 'medium';
  if (x === 'hard' || x === 'advanced') return 'hard';
  return x;
}
function diffTier(d) {
  const x = normDiff(d);
  return x === 'hard' ? 3 : x === 'medium' ? 2 : 1;
}
function levelTier(level) {
  const x = (level || 'newbie').toLowerCase();
  return x === 'advanced' ? 3 : x === 'intermediate' ? 2 : 1;
}

function todayStr() { return new Date().toISOString().split('T')[0]; }

// ─── AUTH ───────────────────────────────────────────────────────────────────

async function getCurrentUser() {
  try {
    const { data } = await window.db.auth.getSession();
    if (data?.session?.user) return data.session.user;
    const r = await window.db.auth.getUser();
    return r.data?.user || null;
  } catch (e) {
    console.error('getCurrentUser:', e);
    return null;
  }
}

function invalidateProfileCache(id) {
  try { sessionStorage.removeItem('vidx_profile_' + id); } catch (e) {}
}

// Make sure a public.users row exists for an authenticated user (uses signup metadata).
async function ensureProfile(user, extra = {}) {
  try {
    if (!user?.id) return null;
    const { data: existing } = await window.db.from('users').select('*').eq('id', user.id).maybeSingle();
    if (existing) return existing;
    const md = user.user_metadata || {};
    const row = {
      id: user.id,
      email: user.email,
      first_name: md.first_name || extra.first_name || '',
      last_name: md.last_name || extra.last_name || '',
      college: md.college || extra.college || '',
      branch: md.branch || extra.branch || '',
      year: md.year || extra.year || '',
      experience_level: md.experience_level || extra.experience_level || 'newbie',
      xp: 0, streak: 0, problems_solved: 0, rank_title: 'Newbie'
    };
    const { error } = await _safeInsert('users', row);
    if (error && !/duplicate|unique|23505/i.test(error.message || '')) {
      console.warn('ensureProfile insert failed:', error.message);
      return null;
    }
    const { data } = await window.db.from('users').select('*').eq('id', user.id).maybeSingle();
    return data || row;
  } catch (e) {
    console.error('ensureProfile:', e);
    return null;
  }
}

async function getUserProfile(id, bypassCache = false) {
  try {
    const cacheKey = 'vidx_profile_' + id;
    if (!bypassCache) {
      try {
        const cached = sessionStorage.getItem(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Date.now() - (parsed._cachedAt || 0) < 45000) return parsed;
        }
      } catch (err) {}
    }
    const { data, error } = await window.db.from('users').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    let prof = data;
    if (!prof) {
      const u = await getCurrentUser();
      if (u && u.id === id) prof = await ensureProfile(u);
    }
    if (prof) {
      prof._cachedAt = Date.now();
      try { sessionStorage.setItem(cacheKey, JSON.stringify(prof)); } catch (e) {}
    }
    return prof || null;
  } catch (e) {
    console.error('getUserProfile:', e);
    return null;
  }
}

// ─── REGISTER ───────────────────────────────────────────────────────────────

async function registerStudent(email, password, userData) {
  try {
    const base = location.href.replace(/[^/]*$/, '');
    const meta = {
      first_name: userData.first_name || '',
      last_name: userData.last_name || '',
      college: userData.college || '',
      branch: userData.branch || '',
      year: userData.year || '',
      experience_level: userData.experience_level || 'newbie'
    };
    const { data: authData, error: authError } = await window.db.auth.signUp({
      email, password,
      options: { data: meta, emailRedirectTo: base + 'login.html' }
    });
    if (authError) throw authError;

    const user = authData.user;
    if (!user?.id) throw new Error('Registration failed — no user ID returned.');

    // Supabase returns an obfuscated user with no identities when the email is already registered
    if (Array.isArray(user.identities) && user.identities.length === 0) {
      return { success: false, error: 'This email is already registered. Please log in instead.' };
    }

    // Email confirmation ON → no session yet; profile will be created on first login (ensureProfile)
    if (!authData.session) {
      return { success: true, needsConfirmation: true, user };
    }

    const profile = await ensureProfile(user, meta);
    if (!profile) console.warn('registerStudent: profile row not created (check RLS on users table)');
    return { success: true, user };
  } catch (e) {
    console.error('registerStudent:', e);
    return { success: false, error: e.message || 'Registration failed.' };
  }
}

// ─── LOGIN ──────────────────────────────────────────────────────────────────

async function loginStudent(email, password) {
  try {
    const { data, error } = await window.db.auth.signInWithPassword({ email, password });
    if (error) throw error;
    ensureProfile(data.user).then(p => { if (p) { p._cachedAt = Date.now(); try { sessionStorage.setItem('vidx_profile_' + data.user.id, JSON.stringify(p)); } catch (e) {} } });
    return { success: true, user: data.user };
  } catch (e) {
    console.error('loginStudent:', e);
    let msg = e.message || 'Login failed.';
    if (/email not confirmed/i.test(msg)) msg = 'Please confirm your email first (check your inbox), then log in.';
    return { success: false, error: msg };
  }
}

// ─── PROBLEMS ───────────────────────────────────────────────────────────────

async function getDailyProblem() {
  try {
    const today = todayStr();
    const { data: todayProblem } = await window.db
      .from('problems').select('*').eq('is_daily', true).eq('daily_date', today).maybeSingle();
    if (todayProblem) return todayProblem;

    const { data: anyDaily } = await window.db
      .from('problems').select('*').eq('is_daily', true)
      .order('daily_date', { ascending: false }).limit(1).maybeSingle();
    if (anyDaily) return anyDaily;

    const { data: latest } = await window.db
      .from('problems').select('*').order('created_at', { ascending: false }).limit(1).maybeSingle();
    return latest || null;
  } catch (e) {
    console.error('getDailyProblem:', e);
    return null;
  }
}

let _problemsCache = null;
async function getAllProblems(force = false) {
  try {
    if (!force && _problemsCache && Date.now() - _problemsCache.t < 30000) return _problemsCache.d;
    const { data, error } = await window.db.from('problems').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    _problemsCache = { t: Date.now(), d: data || [] };
    return _problemsCache.d;
  } catch (e) {
    console.error('getAllProblems:', e);
    return [];
  }
}

async function getProblemById(id) {
  try {
    const { data, error } = await window.db.from('problems').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data;
  } catch (e) {
    console.error('getProblemById:', e);
    return null;
  }
}

function buildProblemInsertPayload(data, tier) {
  const core = {
    title: data.title, description: data.description, difficulty: data.difficulty, topic: data.topic,
    xp_reward: data.xp_reward, companies: data.companies, sample_input: data.sample_input,
    sample_output: data.sample_output, is_daily: data.is_daily, daily_date: data.daily_date
  };
  if (tier >= 1) core.test_cases = data.test_cases;
  if (tier >= 2) {
    core.constraints = data.constraints; core.hint = data.hint;
    core.editorial = data.editorial; core.hidden_test_cases = data.hidden_test_cases;
  }
  return core;
}

async function insertProblem(problemData) {
  try {
    if (problemData.is_daily) {
      try { await window.db.from('problems').update({ is_daily: false }).eq('is_daily', true); }
      catch (e) { console.warn('[VidX] clear daily flag:', e); }
    }
    let lastError = null;
    for (let tier = 2; tier >= 0; tier--) {
      const payload = buildProblemInsertPayload(problemData, tier);
      const { data, error } = await _safeInsert('problems', payload, { select: true, single: true });
      if (!error) { _problemsCache = null; return data; }
      lastError = error;
      if (!isSchemaOrRlsError(error)) throw error;
    }
    throw lastError || new Error('Could not insert problem. Run vidx-setup.sql in Supabase SQL Editor.');
  } catch (e) {
    console.error('insertProblem:', e);
    throw e;
  }
}

async function updateProblem(id, problemData) {
  try {
    if (problemData.is_daily) {
      try { await window.db.from('problems').update({ is_daily: false }).eq('is_daily', true).neq('id', id); }
      catch (e) { console.warn('[VidX] clear daily flag:', e); }
    }
    let lastError = null;
    for (let tier = 2; tier >= 0; tier--) {
      const payload = buildProblemInsertPayload(problemData, tier);
      const { data, error } = await window.db.from('problems').update(payload).eq('id', id).select().maybeSingle();
      if (!error) { _problemsCache = null; return data; }
      lastError = error;
      if (!isSchemaOrRlsError(error)) throw error;
    }
    throw lastError || new Error('Could not update problem. Run vidx-setup.sql in Supabase SQL Editor.');
  } catch (e) {
    console.error('updateProblem:', e);
    throw e;
  }
}

// ─── LEADERBOARD ────────────────────────────────────────────────────────────

async function getLeaderboard(limit = 50) {
  try {
    const { data, error } = await window.db
      .from('users')
      .select('id, first_name, last_name, email, college, branch, year, xp, streak, problems_solved, rank_title, experience_level')
      .order('xp', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  } catch (e) {
    console.error('getLeaderboard:', e);
    return [];
  }
}

async function getUserRank(userId, knownXp = null) {
  try {
    let xp = knownXp;
    if (xp === null || xp === undefined) {
      const { data: user } = await window.db.from('users').select('xp').eq('id', userId).maybeSingle();
      if (!user) return null;
      xp = user.xp || 0;
    }
    const { count, error } = await window.db.from('users').select('*', { count: 'exact', head: true }).gt('xp', xp);
    if (!error && count !== null) return count + 1;
    const leaderboard = await getLeaderboard(200);
    const index = leaderboard.findIndex(u => u.id === userId);
    return index === -1 ? null : index + 1;
  } catch (e) {
    console.error('getUserRank:', e);
    return null;
  }
}

// ─── XP + STREAK ────────────────────────────────────────────────────────────

function getRankTitle(xp) {
  if (xp >= 5000) return 'Legend';
  if (xp >= 2000) return 'Code Samurai';
  if (xp >= 800) return 'Debug Warrior';
  return 'Newbie';
}
function getExperienceLevel(xp, currentLevel) {
  if (xp >= 2000) return 'advanced';
  if (xp >= 800) return 'intermediate';
  return currentLevel || 'newbie';
}

async function giveXP(userId, amount) {
  try {
    const profile = await getUserProfile(userId, true);
    if (!profile) throw new Error('User not found');
    const newXP = (profile.xp || 0) + amount;
    const rankTitle = getRankTitle(newXP);
    const newLevel = getExperienceLevel(newXP, profile.experience_level);
    const updates = { xp: newXP, rank_title: rankTitle };
    if (newLevel !== profile.experience_level) updates.experience_level = newLevel;
    const { error } = await _safeUpdate('users', updates, q => q.eq('id', userId));
    if (error) throw error;
    invalidateProfileCache(userId);
    return { newXP, rankTitle, newLevel };
  } catch (e) {
    console.error('giveXP:', e);
    return null;
  }
}

async function updateStreak(userId) {
  try {
    const profile = await getUserProfile(userId, true);
    if (!profile) throw new Error('User not found');

    const today = todayStr();
    const lastSolved = profile.last_solved_date || profile.last_solve_date || null;
    let newStreak = profile.streak || 0;
    let streakBonus = 0;

    if (lastSolved === today) return { streak: newStreak, streakBonus: 0 };

    const y = new Date(); y.setDate(y.getDate() - 1);
    const yesterdayStr = y.toISOString().split('T')[0];
    newStreak = lastSolved === yesterdayStr ? newStreak + 1 : 1;

    if (newStreak === 7) streakBonus = 25;
    if (newStreak === 30) streakBonus = 100;

    const { error } = await _safeUpdate('users',
      { streak: newStreak, last_solved_date: today, last_solve_date: today }, q => q.eq('id', userId));
    if (error) throw error;
    invalidateProfileCache(userId);

    if (streakBonus > 0) await giveXP(userId, streakBonus);
    return { streak: newStreak, streakBonus };
  } catch (e) {
    console.error('updateStreak:', e);
    return { streak: null, streakBonus: 0 };
  }
}

// ─── SUBMIT ─────────────────────────────────────────────────────────────────
// XP decay: 1st solver full xp_reward, then -5 per position, floor = 20% of reward.
// Wrong = 3 XP, Answer-only = 1 XP. Re-submitting an already-solved problem gives no extra XP.

const XP_WRONG = 3;
const XP_ANSWER_ONLY = 1;
const XP_DECAY_PER_POSITION = 5;
const XP_FLOOR_PERCENT = 0.20;

function calculateSubmissionXP(verdict, position, submissionMode, xpReward) {
  if (verdict === 'Answer Only') return XP_ANSWER_ONLY;
  if (verdict !== 'Accepted') return XP_WRONG;
  if (submissionMode !== 'code') return Math.round(xpReward * XP_FLOOR_PERCENT) || 10;
  const decay = (position - 1) * XP_DECAY_PER_POSITION;
  const floor = Math.max(1, Math.round(xpReward * XP_FLOOR_PERCENT));
  return Math.max(floor, xpReward - decay);
}

async function hasUserSolvedProblem(userId, problemId) {
  try {
    const { data } = await window.db.from('submissions').select('id')
      .eq('user_id', userId).eq('problem_id', problemId)
      .in('status', ['correct', 'Accepted']).limit(1);
    return (data || []).length > 0;
  } catch (e) { return false; }
}
async function hasUserAttemptedWrong(userId, problemId) {
  try {
    const { data } = await window.db.from('submissions').select('id')
      .eq('user_id', userId).eq('problem_id', problemId)
      .eq('status', 'wrong').limit(1);
    return (data || []).length > 0;
  } catch (e) { return false; }
}
function diffTier(d) {
  const x = normDiff(d);
  return x === 'hard' ? 3 : x === 'medium' ? 2 : 1;
}
function levelTier(level) {
  const x = (level || 'newbie').toLowerCase();
  return x === 'advanced' ? 3 : x === 'intermediate' ? 2 : 1;
}

async function submitSolution(userId, problemId, options = {}) {
  try {
    const {
      verdict = 'Wrong Answer', language = '', timeTaken = 0, code = '',
      passedCases = 0, totalCases = 0, runtimeMs = 0, submissionMode = 'code'
    } = typeof options === 'string'
      ? { verdict: options === 'correct' ? 'Accepted' : 'Wrong Answer', language: arguments[3], timeTaken: arguments[4] }
      : options;

    const isAccepted = verdict === 'Accepted';
    let xpGained = 0, position = null, streakBonus = 0;

    const [alreadySolved, alreadyWrong, problem] = await Promise.all([
      hasUserSolvedProblem(userId, problemId),
      hasUserAttemptedWrong(userId, problemId),
      getProblemById(problemId)
    ]);
    const xpReward = problem?.xp_reward || 100;

    if (isAccepted) {
      position = (problem?.solve_count || 0) + 1;
      if (!alreadySolved) {
        xpGained = calculateSubmissionXP(verdict, position, submissionMode, xpReward);
        await giveXP(userId, xpGained);
      }
      const streakResult = await updateStreak(userId);
      streakBonus = streakResult?.streakBonus || 0;
      xpGained += streakBonus;

      if (!alreadySolved) {
        const profile = await getUserProfile(userId, true);
        await _safeUpdate('users', { problems_solved: (profile?.problems_solved || 0) + 1 }, q => q.eq('id', userId));
        invalidateProfileCache(userId);
        await _safeUpdate('problems', {
          solve_count: (problem?.solve_count || 0) + 1,
          correct_submission_count: (problem?.correct_submission_count || 0) + 1
        }, q => q.eq('id', problemId));
        _problemsCache = null;
      }
    } else if (verdict === 'Answer Only') {
      if (!alreadySolved) { xpGained = XP_ANSWER_ONLY; await giveXP(userId, xpGained); }
    } else {
      if (!alreadyWrong && !alreadySolved) { xpGained = XP_WRONG; await giveXP(userId, xpGained); }
    }

    const row = {
      user_id: userId, problem_id: problemId,
      status: isAccepted ? 'correct' : (verdict === 'Answer Only' ? 'answer' : 'wrong'),
      language, xp_gained: xpGained,
      time_taken_mins: timeTaken || 0, time_taken: timeTaken || 0,
      verdict, code: code || null,
      passed_cases: passedCases, total_cases: totalCases, runtime_ms: runtimeMs,
      submission_mode: submissionMode, position: position
    };
    const { error } = await _safeInsert('submissions', row);
    if (error) throw error;

    return { xpGained, position, streakBonus, isWrong: !isAccepted, verdict, passedCases, totalCases, runtimeMs, alreadySolved };
  } catch (e) {
    console.error('submitSolution:', e);
    return { xpGained: 0, position: null, isWrong: true, error: e.message };
  }
}

// ─── NOTIFICATIONS ──────────────────────────────────────────────────────────

function getNotificationTitle(n) {
  if (n.title) return n.title;
  const types = { admin: '📢 Admin Notice', system: '⚙️ System', vote: '🗳️ Vote Update', xp: '⭐ XP Update' };
  return types[n.type] || '📬 Notification';
}

async function getNotifications(userId, limit = 50) {
  try {
    const { data, error } = await window.db.from('notifications').select('*')
      .eq('user_id', userId).order('created_at', { ascending: false }).limit(limit);
    if (error) throw error;
    return data || [];
  } catch (e) { console.error('getNotifications:', e); return []; }
}

async function getUnreadNotificationCount(userId) {
  try {
    const { count, error } = await window.db.from('notifications')
      .select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('is_read', false);
    if (error) throw error;
    return count || 0;
  } catch (e) { console.error('getUnreadNotificationCount:', e); return 0; }
}

async function markNotificationRead(id) {
  try {
    const { error } = await window.db.from('notifications').update({ is_read: true }).eq('id', id);
    if (error) throw error;
    return true;
  } catch (e) { console.error('markNotificationRead:', e); return false; }
}

async function markAllNotificationsRead(userId) {
  try {
    const { error } = await window.db.from('notifications').update({ is_read: true }).eq('user_id', userId).eq('is_read', false);
    if (error) throw error;
    return true;
  } catch (e) { console.error('markAllNotificationsRead:', e); return false; }
}

async function sendNotificationToAll(message, title = 'Admin Notice') {
  try {
    const students = await adminGetAllStudents();
    if (!students.length) return { success: false, error: 'No students found.' };
    const rows = students.map(s => ({ user_id: s.id, title, message, type: 'admin', is_read: false }));
    const { error } = await _safeInsert('notifications', rows);
    if (error) {
      const hint = isSchemaOrRlsError(error) ? ' Run vidx-setup.sql in Supabase SQL Editor to fix RLS policies.' : '';
      return { success: false, error: (error.message || 'Insert failed.') + hint };
    }
    return { success: true, count: rows.length };
  } catch (e) {
    console.error('sendNotificationToAll:', e);
    return { success: false, error: e.message || 'Insert failed.' };
  }
}

// ─── VOTING (supports both `problem_votes` and `votes` table names) ────────

let _voteTable = null;
async function _voteTbl() {
  if (_voteTable) return _voteTable;
  for (const t of ['problem_votes', 'votes']) {
    const { error } = await window.db.from(t).select('vote_for', { head: true, count: 'exact' }).limit(1);
    if (!error) { _voteTable = t; return t; }
  }
  _voteTable = 'problem_votes';
  return _voteTable;
}

async function getTodayVote(userId) {
  try {
    const t = await _voteTbl();
    const { data } = await window.db.from(t).select('*').eq('user_id', userId).eq('vote_date', todayStr()).maybeSingle();
    return data;
  } catch (e) { console.error('getTodayVote:', e); return null; }
}

async function submitVote(userId, voteFor, studentName, studentEmail) {
  try {
    const existing = await getTodayVote(userId);
    if (existing) return { success: false, error: 'You already voted today.' };
    const t = await _voteTbl();
    const row = { user_id: userId, vote_for: voteFor, vote_date: todayStr() };
    if (t === 'votes') { row.student_name = studentName; row.student_email = studentEmail; row.topic = voteFor; row.is_read = false; }
    const { error: voteError } = await _safeInsert(t, row);
    if (voteError) throw voteError;
    if (t !== 'votes') {
      await _safeInsert('vote_notifications', {
        student_id: userId, student_name: studentName, student_email: studentEmail, topic: voteFor, is_read: false
      });
    }
    return { success: true };
  } catch (e) {
    console.error('submitVote:', e);
    return { success: false, error: e.message };
  }
}

async function getVoteCounts(dateFilter = null) {
  try {
    const t = await _voteTbl();
    let query = window.db.from(t).select('vote_for, vote_date');
    if (dateFilter) query = query.eq('vote_date', dateFilter);
    const { data, error } = await query;
    if (error) throw error;
    const counts = {};
    (data || []).forEach(v => { counts[v.vote_for] = (counts[v.vote_for] || 0) + 1; });
    return counts;
  } catch (e) { console.error('getVoteCounts:', e); return {}; }
}

async function getAllVotes(filters = {}) {
  try {
    const t = await _voteTbl();
    let query = window.db.from(t).select('*').order('vote_date', { ascending: false });
    if (filters.date) query = query.eq('vote_date', filters.date);
    if (filters.topic) query = query.eq('vote_for', filters.topic);
    const { data, error } = await query;
    if (error) throw error;
    const students = await adminGetAllStudents();
    const sm = {};
    students.forEach(s => { sm[s.id] = s; });
    return (data || []).map(v => {
      const s = sm[v.user_id];
      return { ...v,
        student_name: s ? `${s.first_name || ''} ${s.last_name || ''}`.trim() : (v.student_name || 'Unknown'),
        student_email: s?.email || v.student_email || '' };
    });
  } catch (e) { console.error('getAllVotes:', e); return []; }
}

async function getVoteAnalytics() {
  try {
    const t = await _voteTbl();
    const { data, error } = await window.db.from(t).select('vote_for, vote_date');
    if (error) throw error;
    const votes = data || [];
    const topicCounts = {}, dailyCounts = {};
    votes.forEach(v => {
      topicCounts[v.vote_for] = (topicCounts[v.vote_for] || 0) + 1;
      dailyCounts[v.vote_date] = (dailyCounts[v.vote_date] || 0) + 1;
    });
    const sorted = Object.entries(topicCounts).sort((a, b) => b[1] - a[1]);
    return { topicCounts, dailyCounts, totalVotes: votes.length, mostVoted: sorted[0] || null,
      leastVoted: sorted.length ? sorted[sorted.length - 1] : null, leaderboard: sorted };
  } catch (e) {
    console.error('getVoteAnalytics:', e);
    return { topicCounts: {}, dailyCounts: {}, totalVotes: 0, mostVoted: null, leastVoted: null, leaderboard: [] };
  }
}

async function getVoteNotifications() {
  try {
    const { data, error } = await window.db.from('vote_notifications').select('*').order('voted_at', { ascending: false }).limit(50);
    if (!error) return data || [];
    // fallback: derive from votes table
    const votes = await getAllVotes();
    return votes.slice(0, 50).map(v => ({ ...v, topic: v.topic || v.vote_for, voted_at: v.voted_at || v.created_at || v.vote_date }));
  } catch (e) { console.error('getVoteNotifications:', e); return []; }
}

async function markVoteNotificationsRead() {
  try {
    const { error } = await window.db.from('vote_notifications').update({ is_read: true }).eq('is_read', false);
    if (error) {
      const t = await _voteTbl();
      await window.db.from(t).update({ is_read: true }).eq('is_read', false);
    }
    return true;
  } catch (e) { console.error('markVoteNotificationsRead:', e); return false; }
}

// ─── ADMIN ──────────────────────────────────────────────────────────────────

async function adminGetAllStudents() {
  try {
    const { data, error } = await window.db.from('users').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  } catch (e) { console.error('adminGetAllStudents:', e); return []; }
}

async function adminUpdateXP(userId, newXP) {
  try {
    const rankTitle = getRankTitle(newXP);
    const { error } = await _safeUpdate('users', { xp: newXP, rank_title: rankTitle }, q => q.eq('id', userId));
    if (error) throw error;
    invalidateProfileCache(userId);
    return { success: true, rankTitle };
  } catch (e) { console.error('adminUpdateXP:', e); return { success: false, error: e.message }; }
}

async function adminResetStreak(userId) {
  try {
    const { error } = await _safeUpdate('users', { streak: 0, last_solved_date: null, last_solve_date: null }, q => q.eq('id', userId));
    if (error) throw error;
    invalidateProfileCache(userId);
    return { success: true };
  } catch (e) { console.error('adminResetStreak:', e); return { success: false, error: e.message }; }
}
async function adminDeleteStudent(userId) {
  try {
    const { data, error } = await window.db.from('users').delete().eq('id', userId).select();
    if (error) throw error;
    if (!data || data.length === 0) {
      return { success: false, error: 'Nothing was deleted — this is a database permission (RLS) issue, not a code issue. Re-run the DELETE policy SQL for the "users" table in Supabase.' };
    }
    invalidateProfileCache(userId);
    return { success: true };
  } catch (e) { console.error('adminDeleteStudent:', e); return { success: false, error: e.message }; }
}

// ─── AUTH GUARDS (location.replace so Back button never traps the user) ─────

async function requireAuth() {
  try {
    const { data: sessionData, error } = await window.db.auth.getSession();
    if (sessionData?.session?.user) return sessionData.session.user;
    // Session is gone/unrecoverable (e.g. a stale refresh token from a previous tab/device).
    // Clear it locally so the next login starts clean instead of repeatedly failing silently.
    if (error) { try { await window.db.auth.signOut({ scope: 'local' }); } catch (e2) {} }
  } catch (e) { console.error('requireAuth:', e); }
    const _here = window.location.pathname.split('/').pop() + window.location.search;
  saveNext(_here);
  window.location.replace('login.html?next=' + encodeURIComponent(_here));
  return null;
}

function requireAdmin() {
  if (!sessionStorage.getItem('vidx_admin')) {
    window.location.replace('login.html');
    return false;
  }
  return true;
}

async function logout() {
  try {
    const { data } = await window.db.auth.getSession();
    const uid = data?.session?.user?.id;
    if (uid) invalidateProfileCache(uid);
    await window.db.auth.signOut();
  } catch (e) { console.error('logout:', e); }
  sessionStorage.removeItem('vidx_admin');
  window.location.replace('login.html');
}

// ─── UTILITIES ──────────────────────────────────────────────────────────────

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function getInitials(firstName, lastName) {
  const f = (firstName || '')[0] || '';
  const l = (lastName || '')[0] || '';
  return (f + l).toUpperCase() || '?';
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function getMidnightCountdown() {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const diff = midnight - now;
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return { h, m, s, formatted: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` };
}

// Back button helper: real "go back" if there is history, otherwise follow the link.
document.addEventListener('click', function (e) {
  const a = e.target.closest && e.target.closest('a.back-btn, a.back-link');
  if (!a || e.defaultPrevented) return;
  if (window.history.length > 1 && document.referrer && new URL(document.referrer).origin === location.origin) {
    e.preventDefault();
    window.history.back();
  }
});
// Restore page correctly when coming back via bfcache
window.addEventListener('pageshow', function (e) {
  if (e.persisted) { document.body.style.opacity = ''; document.body.style.transition = ''; }
});

// ─── PROBLEM LIBRARY ────────────────────────────────────────────────────────

async function getUserSolvedProblemIds(userId) {
  try {
    const { data } = await window.db.from('submissions').select('problem_id')
      .eq('user_id', userId).in('status', ['correct', 'Accepted']);
    return [...new Set((data || []).map(s => s.problem_id))];
  } catch (e) { console.error('getUserSolvedProblemIds:', e); return []; }
}

async function getProblemStats(problemId) {
  try {
    const { data: subs } = await window.db.from('submissions').select('status, verdict').eq('problem_id', problemId);
    const total = (subs || []).length;
    const accepted = (subs || []).filter(s => s.status === 'correct' || s.verdict === 'Accepted').length;
    return { totalAttempts: total, totalAccepted: accepted, successRate: total ? Math.round((accepted / total) * 100) : 0 };
  } catch (e) { return { totalAttempts: 0, totalAccepted: 0, successRate: 0 }; }
}

async function getRelatedProblems(problem, limit = 4) {
  try {
    const all = await getAllProblems();
    return all
      .filter(p => p.id !== problem.id && (p.topic === problem.topic || (p.companies || []).some(c => (problem.companies || []).includes(c))))
      .slice(0, limit);
  } catch (e) { return []; }
}

// Real per-day activity (submissions per day) for heatmaps / weekly charts
async function getUserActivity(userId, days = 112) {
  try {
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const { data, error } = await window.db.from('submissions')
      .select('submitted_at, status, verdict, problem_id').eq('user_id', userId).gte('submitted_at', since);
    if (error) throw error;
    return data || [];
  } catch (e) { console.error('getUserActivity:', e); return []; }
}

function filterProblems(problems, filters = {}) {
  let result = [...problems];
  const { search, difficulty, topic, company, status, solvedIds, bookmarkedIds, sort } = filters;

  if (search) {
    const q = search.toLowerCase();
    result = result.filter(p =>
      (p.title || '').toLowerCase().includes(q) ||
      (p.topic || '').toLowerCase().includes(q) ||
      (p.companies || []).some(c => (c || '').toLowerCase().includes(q)));
  }
  if (difficulty && difficulty !== 'all') result = result.filter(p => normDiff(p.difficulty) === normDiff(difficulty));
  if (topic && topic !== 'all') result = result.filter(p => (p.topic || '') === topic);
  if (company && company !== 'all') result = result.filter(p => (p.companies || []).includes(company));
  if (status === 'solved' && solvedIds) result = result.filter(p => solvedIds.includes(p.id));
  if (status === 'unsolved' && solvedIds) result = result.filter(p => !solvedIds.includes(p.id));
  if (status === 'bookmarked' && bookmarkedIds) result = result.filter(p => bookmarkedIds.includes(p.id));

  if (sort === 'newest') result.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  else if (sort === 'solved') result.sort((a, b) => (b.solve_count || 0) - (a.solve_count || 0));
  else if (sort === 'xp') result.sort((a, b) => (b.xp_reward || 0) - (a.xp_reward || 0));
  else if (sort === 'difficulty') {
    const order = { easy: 1, medium: 2, hard: 3 };
    result.sort((a, b) => (order[normDiff(a.difficulty)] || 0) - (order[normDiff(b.difficulty)] || 0));
  }
  return result;
}

// ─── BOOKMARKS & LIKES ──────────────────────────────────────────────────────

function _bookmarkKey(userId) { return `vidx_bookmarks_${userId}`; }
function _likesKey(userId) { return `vidx_likes_${userId}`; }
function _lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch (e) { return []; } }

async function getBookmarkedProblems(userId) {
  try {
    const { data, error } = await window.db.from('problem_bookmarks').select('problem_id').eq('user_id', userId);
    if (!error && data) return data.map(b => b.problem_id);
  } catch (e) { /* fallback */ }
  return _lsGet(_bookmarkKey(userId));
}

async function toggleBookmark(userId, problemId) {
  const local = _lsGet(_bookmarkKey(userId));
  const idx = local.indexOf(problemId);
  const isBookmarked = idx === -1;
  if (isBookmarked) local.push(problemId); else local.splice(idx, 1);
  try { localStorage.setItem(_bookmarkKey(userId), JSON.stringify(local)); } catch (e) {}
  try {
    if (isBookmarked) await window.db.from('problem_bookmarks').insert({ user_id: userId, problem_id: problemId });
    else await window.db.from('problem_bookmarks').delete().eq('user_id', userId).eq('problem_id', problemId);
  } catch (e) { /* localStorage is fallback */ }
  return isBookmarked;
}

async function getLikedProblems(userId) {
  try {
    const { data, error } = await window.db.from('problem_likes').select('problem_id').eq('user_id', userId);
    if (!error && data) return data.map(b => b.problem_id);
  } catch (e) {}
  return _lsGet(_likesKey(userId));
}

async function toggleLike(userId, problemId) {
  const local = _lsGet(_likesKey(userId));
  const idx = local.indexOf(problemId);
  const isLiked = idx === -1;
  if (isLiked) local.push(problemId); else local.splice(idx, 1);
  try { localStorage.setItem(_likesKey(userId), JSON.stringify(local)); } catch (e) {}
  try {
    if (isLiked) await window.db.from('problem_likes').insert({ user_id: userId, problem_id: problemId });
    else await window.db.from('problem_likes').delete().eq('user_id', userId).eq('problem_id', problemId);
  } catch (e) {}
  return isLiked;
}

// ─── CODE EXECUTION ─────────────────────────────────────────────────────────
// Judge0 CE → Judge0 Extra → Glot. Judge0 tries wait=true first, then async token polling.

const JDOODLE_CLIENT_ID = 'a83e0e423cd60aa903b1b95991ef26c9';
const JDOODLE_CLIENT_SECRET = '7bd72030fe22e22720f7dfd8be13da6af396566930ce2ff983f545e7417bcb2e'; // ← isko khud apne secret se replace karo

const JDOODLE_LANG = {
  python:     { language: 'python3', versionIndex: '4' },
  java:       { language: 'java',    versionIndex: '4' },
  cpp:        { language: 'cpp17',   versionIndex: '1' },
  javascript: { language: 'nodejs',  versionIndex: '4' },
  c:          { language: 'c',       versionIndex: '5' },
  csharp:     { language: 'csharp',  versionIndex: '3' },
  kotlin:     { language: 'kotlin',  versionIndex: '3' },
  go:         { language: 'go',      versionIndex: '4' },
  php:        { language: 'php',     versionIndex: '4' }
};

async function executeViaJDoodle(langKey, code, stdin) {
  const cfg = JDOODLE_LANG[langKey];
  if (!cfg) throw new Error('Unsupported language for JDoodle');
  if (!JDOODLE_CLIENT_SECRET || JDOODLE_CLIENT_SECRET.includes('YAHAN_')) throw new Error('JDoodle not configured');
  const res = await fetch('https://api.jdoodle.com/v1/execute', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: JDOODLE_CLIENT_ID, clientSecret: JDOODLE_CLIENT_SECRET,
      script: code, language: cfg.language, versionIndex: cfg.versionIndex, stdin: stdin || ''
    })
  });
  if (!res.ok) throw new Error(`JDoodle HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return {
    stdout: data.output || '', stderr: '',
    code: 0, runtimeMs: Math.round((parseFloat(data.cpuTime) || 0) * 1000), memoryKb: data.memory || 0
  };
}
const JUDGE0_BASES = ['https://ce.judge0.com', 'https://extra.judge0.com'];
const GLOT_URL = 'https://glot.io/api/run';

const LANG_CONFIG = {
  python:     { language_id: 71, label: 'Python 3',   glot: { language: 'python',     version: 'latest', filename: 'main.py' } },
  java:       { language_id: 62, label: 'Java',       glot: { language: 'java',       version: 'latest', filename: 'Main.java' } },
  cpp:        { language_id: 54, label: 'C++',        glot: { language: 'cpp',        version: 'latest', filename: 'main.cpp' } },
  javascript: { language_id: 63, label: 'JavaScript', glot: { language: 'javascript', version: 'latest', filename: 'main.js' } },
  c:          { language_id: 50, label: 'C',          glot: { language: 'c',          version: 'latest', filename: 'main.c' } },
  csharp:     { language_id: 51, label: 'C#',         glot: { language: 'csharp',     version: 'latest', filename: 'main.cs' } },
  kotlin:     { language_id: 78, label: 'Kotlin',     glot: { language: 'kotlin',     version: 'latest', filename: 'main.kt' } },
  go:         { language_id: 60, label: 'Go',         glot: { language: 'go',         version: 'latest', filename: 'main.go' } },
  php:        { language_id: 68, label: 'PHP',        glot: { language: 'php',        version: 'latest', filename: 'main.php' } }
};

async function executeViaGlot(langKey, code, stdin) {
  const cfg = LANG_CONFIG[langKey];
  if (!cfg?.glot) throw new Error('Unsupported language for Glot');
  const res = await fetch(`${GLOT_URL}/${cfg.glot.language}/${cfg.glot.version}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files: [{ name: cfg.glot.filename, content: code }], stdin: stdin || '' })
  });
  if (!res.ok) throw new Error(`Glot HTTP ${res.status}`);
  const data = await res.json();
  const stdout = data.run?.stdout || data.stdout || '';
  const stderr = data.run?.stderr || data.run?.error || data.stderr || data.error || '';
  return { stdout, stderr, code: stderr && !stdout ? 1 : 0, runtimeMs: 0, memoryKb: 0 };
}

function _judge0Result(data) {
  const statusId = data.status?.id;
  const stdout = data.stdout ?? '';
  const stderr = data.stderr ?? data.compile_output ?? data.message ?? '';
  const runtimeMs = Math.round(parseFloat(data.time || 0) * 1000);
  const memoryKb = data.memory || 0;
  if (statusId === 5) return { stdout, stderr, error: 'Time Limit Exceeded', tle: true, code: 1, runtimeMs, memoryKb };
  if (statusId === 6) return { stdout, stderr: stderr || 'Compilation Error', code: 1, runtimeMs, memoryKb };
  if (statusId >= 7 && statusId <= 14) return { stdout, stderr: stderr || 'Runtime Error', code: 1, runtimeMs, memoryKb };
  return { stdout, stderr, code: 0, runtimeMs, memoryKb };
}

async function executeViaJudge0(base, langKey, code, stdin, timeoutMs) {
  const cfg = LANG_CONFIG[langKey];
  if (!cfg) throw new Error('Unsupported language');
  const payload = { source_code: code, language_id: cfg.language_id, stdin: stdin || '',
    cpu_time_limit: Math.max(2, Math.ceil(timeoutMs / 1000)), memory_limit: 128000 };
  const headers = { 'Content-Type': 'application/json' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs + 12000);
  try {
    // 1) wait=true
    let res = await fetch(`${base}/submissions?base64_encoded=false&wait=true`, { method: 'POST', headers, signal: controller.signal, body: JSON.stringify(payload) });
    let data = await res.json().catch(() => null);
    if (res.ok && data && data.status && data.status.id > 2) return _judge0Result(data);

    // 2) async: create token, then poll
    let token = data && data.token;
    if (!token) {
      res = await fetch(`${base}/submissions?base64_encoded=false`, { method: 'POST', headers, signal: controller.signal, body: JSON.stringify(payload) });
      data = await res.json().catch(() => null);
      if (!res.ok || !data?.token) throw new Error((data && (data.error || data.message)) || `HTTP ${res.status}`);
      token = data.token;
    }
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 700 + i * 150));
      const pr = await fetch(`${base}/submissions/${token}?base64_encoded=false`, { signal: controller.signal });
      const pd = await pr.json().catch(() => null);
      if (pr.ok && pd && pd.status && pd.status.id > 2) return _judge0Result(pd);
    }
    return { error: 'Time Limit Exceeded', tle: true, stdout: '', stderr: '', code: 1 };
  } catch (e) {
    if (e.name === 'AbortError') return { error: 'Time Limit Exceeded', tle: true, stdout: '', stderr: '', code: 1 };
    throw e;
  } finally { clearTimeout(timer); }
}

async function executeCode(langKey, code, stdin = '', timeoutMs = 10000) {
  for (const base of JUDGE0_BASES) {
    try { return await executeViaJudge0(base, langKey, code, stdin, timeoutMs); }
    catch (e) { console.warn('[VidX Execute]', base, 'failed:', e.message); }
  }
  try { return await executeViaJDoodle(langKey, code, stdin); }
  catch (e) { console.warn('[VidX Execute] JDoodle failed:', e.message); }
  try { return await executeViaGlot(langKey, code, stdin); }
  catch (e) { console.warn('[VidX Execute] Glot failed:', e.message); }
  throw new Error('All code execution services are currently unavailable. Please try again in a moment.');
}

/** @deprecated kept for backward compatibility */
async function executePistonCode(langKey, code, stdin = '', timeoutMs = 10000) { return executeCode(langKey, code, stdin, timeoutMs); }
async function executeViaPiston(langKey, code, stdin) { return executeViaGlot(langKey, code, stdin); }

function normalizeOutput(s) {
  return (s || '').replace(/\r\n/g, '\n').trim()
    .replace(/[\[\]]/g, '').replace(/,\s*/g, ' ').replace(/\s+/g, ' ').trim();
}

function formatExecutionOutput(result) {
  const stdout = (result.stdout || '').replace(/\r\n/g, '\n').trimEnd();
  const stderr = (result.stderr || '').replace(/\r\n/g, '\n').trimEnd();
  if (stdout) return stdout;
  if (stderr) return stderr;
  return '(no output)';
}

async function judgeSubmission(langKey, code, testCases, timeoutMs = 8000, onProgress) {
  let cases = testCases;
  if (typeof cases === 'string') { try { cases = JSON.parse(cases); } catch (e) { cases = []; } }
  cases = Array.isArray(cases) ? cases : [];
  if (!cases.length) {
    return { verdict: 'Wrong Answer', passed: 0, total: 0,
      failedCase: { error: 'No test cases configured for this problem. Ask admin to add test cases.' }, runtimeMs: 0 };
  }
  let passed = 0, totalRuntime = 0;
  for (let i = 0; i < cases.length; i++) {
    const tc = cases[i];
    if (typeof onProgress === 'function') onProgress(i + 1, cases.length);
    try {
      const result = await executeCode(langKey, code, tc.input || '', timeoutMs);
      if (result.tle || result.error === 'Time Limit Exceeded')
        return { verdict: 'Time Limit Exceeded', passed, total: cases.length, failedCase: { index: i + 1, reason: 'TLE' }, runtimeMs: totalRuntime };
      if (result.code !== 0 && result.code !== undefined)
        return { verdict: 'Runtime Error', passed, total: cases.length, failedCase: { index: i + 1, stderr: result.stderr, stdout: result.stdout }, runtimeMs: totalRuntime };
      totalRuntime += result.runtimeMs || 0;
      const actual = normalizeOutput(result.stdout);
      const expected = normalizeOutput(tc.expected ?? tc.output ?? '');
      if (actual !== expected)
        return { verdict: 'Wrong Answer', passed, total: cases.length, failedCase: { index: i + 1, input: tc.input, expected, actual }, runtimeMs: totalRuntime };
      passed++;
    } catch (e) {
      const msg = e.message || 'Runtime Error';
      let verdict = 'Runtime Error';
      if (msg.includes('Time Limit')) verdict = 'Time Limit Exceeded';
      else if (msg.includes('unavailable')) verdict = 'Judge Unavailable';
      return { verdict, passed, total: cases.length,
        failedCase: { index: i + 1, error: msg }, runtimeMs: totalRuntime };
    }
  }
  return { verdict: 'Accepted', passed, total: cases.length, failedCase: null, runtimeMs: totalRuntime };
}

// ─── UPDATE USER PROFILE ────────────────────────────────────────────────────

async function updateUserProfile(userId, updates) {
  try {
    const { error } = await _safeUpdate('users', updates, q => q.eq('id', userId));
    if (error) throw error;
    invalidateProfileCache(userId);
    return { success: true };
  } catch (e) {
    console.error('updateUserProfile:', e);
    return { success: false, error: e.message };
  }
}

// ─── BATTLES helper: status from clock so cards never show a stale status ───
function effectiveBattleStatus(b) {
  if (!b) return 'upcoming';
  if (b.status === 'draft' || b.status === 'cancelled') return b.status;
  const now = Date.now();
  const st = b.start_time ? new Date(b.start_time).getTime() : 0;
  const en = b.end_time ? new Date(b.end_time).getTime() : Infinity;
  if (b.status === 'completed' || now >= en) return 'completed';
  if (now >= st) return 'live';
  return 'upcoming';
}

// ─── SHARED HELPERS used by page scripts ────────────────────────────────────

const insertResilient = (table, row, opts) => _safeInsert(table, row, opts);
const updateResilient = (table, values, matchFn) => _safeUpdate(table, values, matchFn);

// Synchronous read of the cached profile (for instant first paint, no network wait)
function getCachedProfile(id) {
  try {
    const c = sessionStorage.getItem('vidx_profile_' + id);
    return c ? JSON.parse(c) : null;
  } catch (e) { return null; }
}

function setText(target, text) {
  const el = typeof target === 'string' ? document.getElementById(target) : target;
  if (el) el.textContent = text;
  return el;
}
function setHTML(target, html) {
  const el = typeof target === 'string' ? document.getElementById(target) : target;
  if (el) el.innerHTML = html;
  return el;
}

// Canonical display label for difficulty: Easy / Medium / Hard
function normDifficulty(d) {
  const n = normDiff(d);
  return n === 'easy' ? 'Easy' : n === 'medium' ? 'Medium' : n === 'hard' ? 'Hard' : (d || 'Easy');
}
function difficultyTagClass(d) {
  const n = normDiff(d);
  return n === 'hard' ? 'tag-hard' : n === 'medium' ? 'tag-med' : 'tag-easy';
}

// Local-date key (YYYY-MM-DD) used by heatmaps / weekly charts
function dateStr(d) {
  d = d instanceof Date ? d : new Date(d);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

const getUserSubmissionActivity = (userId, days = 112) => getUserActivity(userId, days);


// ═══════════════════════════════════════════════════════════════════════════
// SHARE LINK + QR  and  "next page after login" helpers
// ═══════════════════════════════════════════════════════════════════════════

// ---------- "go to this page after login/signup" ----------
const NEXT_KEY = 'vidx_next';
const NEXT_MAX_AGE_MS = 24 * 3600 * 1000;

// Only our own student pages are allowed (never external URLs, login/register or admin pages)
function isSafeNext(p) {
  if (typeof p !== 'string' || p.length > 300) return false;
  if (!/^[a-z0-9_-]+\.html(\?[^#\s]*)?$/i.test(p)) return false;
  return !/^(login|register|reset-password|index|admin[a-z0-9_-]*)\.html/i.test(p);
}
function saveNext(p) {
  if (!isSafeNext(p)) return false;
  try { localStorage.setItem(NEXT_KEY, JSON.stringify({ p: p, t: Date.now() })); } catch (e) {}
  return true;
}
function readNext() {
  try {
    const o = JSON.parse(localStorage.getItem(NEXT_KEY) || 'null');
    if (o && isSafeNext(o.p) && Date.now() - o.t < NEXT_MAX_AGE_MS) return o.p;
  } catch (e) {}
  return null;
}
function clearNext() { try { localStorage.removeItem(NEXT_KEY); } catch (e) {} }

function getPostAuthTarget(defaultPage) {
  let t = readNext();
  if (!t) {
    try { const n = new URLSearchParams(location.search).get('next'); if (isSafeNext(n)) t = n; } catch (e) {}
  }
  clearNext();
  return t || defaultPage;
}
function goAfterAuth(defaultPage) {
  window.location.replace(getPostAuthTarget(defaultPage || 'dashboard.html'));
}

// Remember ?next=... as soon as any page is opened with it (login/register pick it up later)
(function () {
  try {
    const n = new URLSearchParams(location.search).get('next');
    if (n) saveNext(n);
  } catch (e) {}
})();

// ---------- share links ----------
function siteBaseUrl() {
  return window.location.href.replace(/[?#].*$/, '').replace(/[^\/]*$/, '');
}
function buildShareUrl(page, params) {
  const q = new URLSearchParams(params || {}).toString();
  return siteBaseUrl() + page + (q ? '?' + q : '');
}
function isLocalShareUrl(url) {
  return /^(file:|https?:\/\/(localhost|127\.|0\.0\.0\.0|192\.168\.|10\.|\[::1\]))/i.test(url);
}

// ---------- QR library loader (cdnjs first, jsdelivr as backup) ----------
let _qrLibPromise = null;
function loadQrLib() {
  if (window.QRCode) return Promise.resolve();
  if (_qrLibPromise) return _qrLibPromise;
  const urls = [
    'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
    'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js'
  ];
  _qrLibPromise = new Promise(function (resolve, reject) {
    let i = 0;
    (function next() {
      if (i >= urls.length) { _qrLibPromise = null; reject(new Error('QR library failed to load')); return; }
      const s = document.createElement('script');
      s.src = urls[i++];
      s.onload = function () { window.QRCode ? resolve() : next(); };
      s.onerror = next;
      document.head.appendChild(s);
    })();
  });
  return _qrLibPromise;
}

// ---------- Share popup (QR + copy link + WhatsApp + download) ----------
function _vxShareStyles() {
  if (document.getElementById('vxShareStyle')) return;
  const st = document.createElement('style');
  st.id = 'vxShareStyle';
  st.textContent =
    '#vxShareOv{position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:99999;display:flex;align-items:center;justify-content:center;padding:1rem}' +
    '#vxShareCard{background:#fff;color:#0f172a;border-radius:18px;width:100%;max-width:360px;padding:1.25rem;box-shadow:0 24px 60px rgba(0,0,0,.35);font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;position:relative;max-height:92vh;overflow:auto}' +
    '#vxShareCard h3{margin:0 0 .15rem;font-size:1.05rem;padding-right:1.8rem;word-break:break-word}' +
    '#vxShareCard .vxSub{color:#64748b;font-size:.8rem;margin-bottom:.8rem}' +
    '#vxShareX{position:absolute;top:.6rem;right:.75rem;border:0;background:none;font-size:1.4rem;cursor:pointer;color:#64748b}' +
    '#vxShareWarn{display:none;background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;border-radius:10px;padding:.5rem .65rem;font-size:.75rem;margin-bottom:.75rem}' +
    '#vxShareQr{display:flex;justify-content:center;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:12px;min-height:120px;align-items:center;margin-bottom:.75rem}' +
    '#vxShareQr img{width:220px;height:220px;display:block}' +
    '#vxShareUrl{width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:10px;padding:.5rem .6rem;font-size:.75rem;color:#334155;margin-bottom:.75rem}' +
    '#vxShareBtns{display:flex;flex-wrap:wrap;gap:.5rem}' +
    '#vxShareBtns button{flex:1 1 45%;border:1px solid #cbd5e1;background:#f8fafc;color:#0f172a;border-radius:10px;padding:.55rem .5rem;font-size:.8rem;font-weight:600;cursor:pointer}' +
    '#vxShareBtns button.vxWa{background:#16a34a;border-color:#16a34a;color:#fff}' +
    '#vxShareBtns button.vxPri{background:#2563eb;border-color:#2563eb;color:#fff}';
  document.head.appendChild(st);
}

function _vxQrCanvas(box) {
  const c = box.querySelector('canvas');
  if (c && c.width) return c;
  const img = box.querySelector('img');
  if (img && img.src && (img.naturalWidth || img.width)) {
    const cv = document.createElement('canvas');
    cv.width = img.naturalWidth || img.width; cv.height = img.naturalHeight || img.height;
    cv.getContext('2d').drawImage(img, 0, 0);
    return cv;
  }
  return null;
}

// QR image with white border and the title written under it (good for WhatsApp / printing)
function _vxQrBlob(box, title) {
  return new Promise(function (resolve) {
    const src = _vxQrCanvas(box);
    if (!src) { resolve(null); return; }
    const pad = 32, extra = title ? 64 : 0;
    const cv = document.createElement('canvas');
    cv.width = src.width + pad * 2; cv.height = src.height + pad * 2 + extra;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.drawImage(src, pad, pad);
    if (title) {
      ctx.fillStyle = '#0f172a'; ctx.textAlign = 'center';
      let size = 28, t = title;
      ctx.font = 'bold ' + size + 'px sans-serif';
      while (ctx.measureText(t).width > cv.width - 40 && t.length > 4) t = t.slice(0, -2);
      if (t !== title) t = t.trim() + '…';
      ctx.fillText(t, cv.width / 2, src.height + pad * 2 + 30);
    }
    cv.toBlob(function (b) { resolve(b); }, 'image/png');
  });
}

async function openShareModal(opts) {
  const title = opts.title || 'Share';
  const url = opts.url;
  const message = opts.message || title;
  _vxShareStyles();
  const old = document.getElementById('vxShareOv'); if (old) old.remove();

  const ov = document.createElement('div');
  ov.id = 'vxShareOv';
  ov.innerHTML =
    '<div id="vxShareCard" role="dialog" aria-modal="true">' +
      '<button id="vxShareX" aria-label="Close">×</button>' +
      '<h3></h3><div class="vxSub"></div>' +
      '<div id="vxShareWarn">⚠️ This link points to your own computer (localhost), so students cannot open it. Deploy the site online first, then share from the deployed admin panel.</div>' +
      '<div id="vxShareQr">Generating QR…</div>' +
      '<input id="vxShareUrl" readonly>' +
      '<div id="vxShareBtns">' +
        '<button id="vxCopy" class="vxPri">📋 Copy link</button>' +
        '<button id="vxWa" class="vxWa">💬 WhatsApp</button>' +
        '<button id="vxDl">⬇️ Download QR</button>' +
        '<button id="vxNative" style="display:none">📤 Share image</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(ov);
  ov.querySelector('h3').textContent = title;
  ov.querySelector('.vxSub').textContent = opts.subtitle || '';
  const urlEl = ov.querySelector('#vxShareUrl'); urlEl.value = url;
  if (isLocalShareUrl(url)) ov.querySelector('#vxShareWarn').style.display = 'block';

  const close = function () { ov.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = function (e) { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  ov.querySelector('#vxShareX').onclick = close;
  ov.addEventListener('click', function (e) { if (e.target === ov) close(); });

  ov.querySelector('#vxCopy').onclick = async function () {
    const btn = this;
    try { await navigator.clipboard.writeText(url); }
    catch (e) { urlEl.select(); try { document.execCommand('copy'); } catch (e2) {} }
    btn.textContent = '✓ Copied!';
    setTimeout(function () { btn.textContent = '📋 Copy link'; }, 1500);
  };
  ov.querySelector('#vxWa').onclick = function () {
    window.open('https://wa.me/?text=' + encodeURIComponent(message + '\n' + url), '_blank', 'noopener');
  };

  const qrBox = ov.querySelector('#vxShareQr');
  try {
    await loadQrLib();
    qrBox.innerHTML = '';
    new window.QRCode(qrBox, { text: url, width: 480, height: 480, colorDark: '#000000', colorLight: '#ffffff', correctLevel: window.QRCode.CorrectLevel.M });
  } catch (e) {
    qrBox.textContent = 'QR could not be generated (no internet?). You can still copy the link.';
    ov.querySelector('#vxDl').disabled = true;
  }

  const fileName = (title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'qr') + '-qr.png';
  ov.querySelector('#vxDl').onclick = async function () {
    const blob = await _vxQrBlob(qrBox, title);
    if (!blob) { alert('QR is not ready yet. Wait a second and try again.'); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = fileName;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  };

  // On phones: send the QR image straight to WhatsApp / any app
  try {
    if (navigator.canShare && navigator.share && window.File) {
      const test = new File([new Blob(['x'], { type: 'image/png' })], 'x.png', { type: 'image/png' });
      if (navigator.canShare({ files: [test] })) {
        const nb = ov.querySelector('#vxNative'); nb.style.display = '';
        nb.onclick = async function () {
          const blob = await _vxQrBlob(qrBox, title);
          if (!blob) return;
          try { await navigator.share({ files: [new File([blob], fileName, { type: 'image/png' })], text: message + '\n' + url }); } catch (e) {}
        };
      }
    }
  } catch (e) {}
}
// ─── PLACEMENT CELL ──────────────────────────────────────────────────────────
function _randomHex(bytes) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

async function _sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
}

async function _hashPlacementPassword(password, salt) {
  return _sha256Hex(salt + ':' + password);
}

async function getPlacementLockStatus() {
  try {
    const { data, error } = await window.db.from('placement_settings').select('id,password_hash').eq('id', 1).maybeSingle();
    if (error) throw error;
    return { isSet: !!(data && data.password_hash) };
  } catch (e) { console.error('getPlacementLockStatus:', e); return { isSet: false }; }
}

async function setupPlacementPassword(newPassword) {
  try {
    if (!newPassword || newPassword.length < 4) return { success: false, error: 'Password must be at least 4 characters.' };
    const status = await getPlacementLockStatus();
    if (status.isSet) return { success: false, error: 'A password is already set. Use change password instead.' };
    const salt = _randomHex(16);
    const hash = await _hashPlacementPassword(newPassword, salt);
    const { error } = await window.db.from('placement_settings').upsert({ id: 1, password_hash: hash, password_salt: salt, updated_at: new Date().toISOString() });
    if (error) throw error;
    return { success: true };
  } catch (e) { console.error('setupPlacementPassword:', e); return { success: false, error: e.message }; }
}

async function verifyPlacementPassword(password) {
  try {
    const { data, error } = await window.db.from('placement_settings').select('password_hash,password_salt').eq('id', 1).maybeSingle();
    if (error) throw error;
    if (!data || !data.password_hash) return { success: false, error: 'No password set yet.' };
    const hash = await _hashPlacementPassword(password || '', data.password_salt);
    if (hash !== data.password_hash) return { success: false, error: 'Incorrect password.' };
    sessionStorage.setItem('vidx_placement_unlocked', 'true');
    return { success: true };
  } catch (e) { console.error('verifyPlacementPassword:', e); return { success: false, error: e.message }; }
}

async function changePlacementPassword(currentPassword, newPassword) {
  try {
    if (!newPassword || newPassword.length < 4) return { success: false, error: 'New password must be at least 4 characters.' };
    const check = await verifyPlacementPassword(currentPassword);
    if (!check.success) return { success: false, error: 'Current password is incorrect.' };
    const salt = _randomHex(16);
    const hash = await _hashPlacementPassword(newPassword, salt);
    const { error } = await window.db.from('placement_settings').update({ password_hash: hash, password_salt: salt, updated_at: new Date().toISOString() }).eq('id', 1);
    if (error) throw error;
    return { success: true };
  } catch (e) { console.error('changePlacementPassword:', e); return { success: false, error: e.message }; }
}

function isPlacementUnlocked() { return sessionStorage.getItem('vidx_placement_unlocked') === 'true'; }
function lockPlacement() { sessionStorage.removeItem('vidx_placement_unlocked'); }

async function adminGetPlacementTests() {
  try {
    const { data, error } = await window.db.from('placement_tests').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  } catch (e) { console.error('adminGetPlacementTests:', e); return []; }
}

async function adminCreatePlacementTest(title, description) {
  try {
    if (!title || !title.trim()) return { success: false, error: 'Title is required.' };
    const { error } = await window.db.from('placement_tests').insert({ title: title.trim(), description: (description || '').trim(), status: 'draft' });
    if (error) throw error;
    return { success: true };
  } catch (e) { console.error('adminCreatePlacementTest:', e); return { success: false, error: e.message }; }
}

async function adminDeletePlacementTest(id) {
  try {
    const { error } = await window.db.from('placement_tests').delete().eq('id', id);
    if (error) throw error;
    return { success: true };
  } catch (e) { console.error('adminDeletePlacementTest:', e); return { success: false, error: e.message }; }
}

async function adminGetPlacementTest(id) {
  try {
    const { data, error } = await window.db.from('placement_tests').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data;
  } catch (e) { console.error('adminGetPlacementTest:', e); return null; }
}

async function adminUploadPlacementPdf(testId, base64Data, fileName) {
  try {
    if (!base64Data) return { success: false, error: 'No file data received.' };
    const sizeBytes = Math.ceil((base64Data.length * 3) / 4);
    if (sizeBytes > 4 * 1024 * 1024) return { success: false, error: 'PDF is larger than 4MB — please use a smaller/compressed file.' };
    const { error } = await window.db.from('placement_tests').update({ pdf_name: fileName, pdf_data: base64Data, pdf_uploaded_at: new Date().toISOString() }).eq('id', testId);
    if (error) throw error;
    return { success: true };
  } catch (e) { console.error('adminUploadPlacementPdf:', e); return { success: false, error: e.message }; }
}

async function adminRemovePlacementPdf(testId) {
  try {
    const { error } = await window.db.from('placement_tests').update({ pdf_name: null, pdf_data: null, pdf_uploaded_at: null }).eq('id', testId);
    if (error) throw error;
    return { success: true };
  } catch (e) { console.error('adminRemovePlacementPdf:', e); return { success: false, error: e.message }; }
}

async function adminGetPlacementQuestions(testId) {
  try {
    const { data, error } = await window.db.from('placement_questions').select('*').eq('test_id', testId).order('question_order', { ascending: true });
    if (error) throw error;
    return data || [];
  } catch (e) { console.error('adminGetPlacementQuestions:', e); return []; }
}

async function adminAddPlacementQuestion(testId, q) {
  try {
    if (!q || !q.question_text || !q.question_text.trim()) return { success: false, error: 'Question text is required.' };
    const existing = await adminGetPlacementQuestions(testId);
    const nextOrder = existing.length ? Math.max(...existing.map(x => x.question_order || 0)) + 1 : 1;
    const row = {
      test_id: testId,
      question_type: q.question_type === 'code' ? 'code' : 'mcq',
      question_text: q.question_text.trim(),
      options: q.question_type === 'code' ? null : (q.options || []),
      correct_answer: (q.correct_answer || '').trim(),
      code_starter: q.question_type === 'code' ? (q.code_starter || '') : null,
      code_language: q.question_type === 'code' ? (q.code_language || 'javascript') : null,
      points: q.points && !isNaN(q.points) ? parseInt(q.points) : 10,
      question_order: nextOrder
    };
    const { error } = await window.db.from('placement_questions').insert(row);
    if (error) throw error;
    return { success: true };
  } catch (e) { console.error('adminAddPlacementQuestion:', e); return { success: false, error: e.message }; }
}

async function adminDeletePlacementQuestion(id) {
  try {
    const { error } = await window.db.from('placement_questions').delete().eq('id', id);
    if (error) throw error;
    return { success: true };
  } catch (e) { console.error('adminDeletePlacementQuestion:', e); return { success: false, error: e.message }; }
}
async function adminGetEligibleStudentIds(testId) {
  try {
    const { data, error } = await window.db.from('placement_eligibility').select('student_id').eq('test_id', testId);
    if (error) throw error;
    return (data || []).map(r => r.student_id);
  } catch (e) { console.error('adminGetEligibleStudentIds:', e); return []; }
}

async function adminSetEligibleStudents(testId, studentIds) {
  try {
    await window.db.from('placement_eligibility').delete().eq('test_id', testId);
    if (studentIds.length) {
      const rows = studentIds.map(id => ({ test_id: testId, student_id: id }));
      const { error } = await window.db.from('placement_eligibility').insert(rows);
      if (error) throw error;
    }
    return { success: true };
  } catch (e) { console.error('adminSetEligibleStudents:', e); return { success: false, error: e.message }; }
}

async function adminTogglePublishTest(testId, publish) {
  try {
    const { error } = await window.db.from('placement_tests').update({ status: publish ? 'published' : 'draft' }).eq('id', testId);
    if (error) throw error;
    return { success: true };
  } catch (e) { console.error('adminTogglePublishTest:', e); return { success: false, error: e.message }; }
}

async function getMyPlacementTests(userId) {
  try {
    const { data: elig, error: e1 } = await window.db.from('placement_eligibility').select('test_id').eq('student_id', userId);
    if (e1) throw e1;
    const testIds = (elig || []).map(r => r.test_id);
    if (!testIds.length) return [];
    const { data, error } = await window.db.from('placement_tests').select('*').in('id', testIds).eq('status', 'published').order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  } catch (e) { console.error('getMyPlacementTests:', e); return []; }
}
async function isEligibleForPlacementTest(testId, userId) {
  try {
    const { data } = await window.db.from('placement_eligibility').select('id').eq('test_id', testId).eq('student_id', userId).limit(1);
    return (data || []).length > 0;
  } catch (e) { return false; }
}

async function hasAttemptedPlacementTest(testId, userId) {
  try {
    const { data } = await window.db.from('placement_attempts').select('id,submitted_at').eq('test_id', testId).eq('student_id', userId).maybeSingle();
    return data || null;
  } catch (e) { return null; }
}

async function getPlacementTestForStudent(testId, userId) {
  try {
    const eligible = await isEligibleForPlacementTest(testId, userId);
    if (!eligible) return { error: 'You are not eligible for this test.' };
    const { data: test, error: e1 } = await window.db.from('placement_tests').select('*').eq('id', testId).eq('status', 'published').maybeSingle();
    if (e1 || !test) return { error: 'Test not found or not published.' };
    const { data: questions, error: e2 } = await window.db.from('placement_questions').select('*').eq('test_id', testId).order('question_order', { ascending: true });
    if (e2) throw e2;
    return { test, questions: questions || [] };
  } catch (e) { console.error('getPlacementTestForStudent:', e); return { error: e.message }; }
}

async function submitPlacementAttempt(testId, userId, answers, violations) {
  try {
    const { data: questions } = await window.db.from('placement_questions').select('*').eq('test_id', testId);
    let score = 0, maxScore = 0;
    (questions || []).forEach(q => {
      maxScore += q.points || 0;
      if (q.question_type === 'mcq' && answers[q.id] && answers[q.id] === q.correct_answer) {
        score += q.points || 0;
      }
      // code-type questions are not auto-graded — teacher reviews manually
    });
    const { error } = await window.db.from('placement_attempts').upsert({
      test_id: testId, student_id: userId, answers, score, max_score: maxScore,
      violations: violations || 0, submitted_at: new Date().toISOString()
    }, { onConflict: 'test_id,student_id' });
    if (error) throw error;
    return { success: true, score, maxScore };
  } catch (e) { console.error('submitPlacementAttempt:', e); return { success: false, error: e.message }; }
}