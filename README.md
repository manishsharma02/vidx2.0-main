# VidX

Setup order:
1. Supabase → SQL Editor → run `vidx-setup.sql` once (tables, columns, signup trigger, policies).
2. Supabase → Authentication → URL Configuration → add your site URL (and `.../reset-password.html`) to Redirect URLs
   (needed for forgot-password / email-confirmation links).
3. Optional for instant signup: Authentication → Providers → Email → turn off "Confirm email".
4. Serve the folder (Live Server / GitHub Pages) and open `index.html`.
