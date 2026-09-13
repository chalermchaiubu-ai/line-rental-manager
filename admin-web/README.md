# CLT Tenant Hub — Web Admin

Internal admin panel for **Owner / Admin / Staff** only. Tenants keep using the
LINE OA (`@631prhjs`) — this app does not replace or touch that.

This is a separate SPA living in `admin-web/` inside the same GitHub repo as
the LINE bot (`server.js`), so there is still one repo and one Supabase
project — but it deploys and runs completely independently from the bot's
Render Web Service. Nothing here modifies `server.js`, `schema.sql`,
`render.yaml`, or the bot's own environment variables.

## Stack

- React + Vite (plain JS, no TypeScript — matches the rest of the project's
  "keep it simple" approach)
- React Router for navigation
- Tailwind CSS
- `@supabase/supabase-js` — **browser (anon key) client only**. All access is
  enforced by Supabase Row Level Security, the same `is_staff()` /
  `is_owner_or_admin()` gating already used by the rest of the schema.

## One-time setup (do this once)

1. **Run the SQL migration**: `sql/001_staff_auth_link.sql` in Supabase →
   SQL Editor. It's additive/idempotent — safe to run even if parts already
   exist. It lets the app find a logged-in user's `staff_users` role.

2. **Create a Supabase Auth login for yourself** (and later for
   admin/staff): Supabase Dashboard → Authentication → Users → Add user.
   Then link it to a `staff_users` row — exact SQL is at the bottom of the
   migration file above.

3. Copy `.env.example` to `.env` and fill in:
   ```
   VITE_SUPABASE_URL=https://aaftuxnkjkkhrbctegga.supabase.co
   VITE_SUPABASE_ANON_KEY=<Supabase Dashboard -> Settings -> API -> anon/public key>
   ```
   This is the **public anon key only** — never the service_role key.

## Local development

```bash
cd admin-web
npm install
npm run dev
```

Opens at http://localhost:5173.

## Build

```bash
npm run build
```

Outputs a static site to `admin-web/dist/`.

## Deploying (suggested: Render Static Site, kept separate from the bot)

The LINE bot already runs as a Render **Web Service** from the repo root.
Add a **second, independent** Render service for this app so the bot is
never touched:

1. Render Dashboard → New → Static Site
2. Connect the same GitHub repo
3. **Root Directory**: `admin-web`
4. **Build Command**: `npm install && npm run build`
5. **Publish Directory**: `admin-web/dist`
6. Add environment variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
   (Static Sites need build-time env vars set in Render's dashboard the same
   way)
7. Because this is a client-side router (React Router), add a rewrite rule:
   `/*` → `/index.html` (Render Static Sites: Settings → Redirects/Rewrites)

Any other static host (Vercel, Netlify, Cloudflare Pages) works the same way
— point it at `admin-web/`, same build/publish commands and SPA rewrite rule.

## Status

Phase 3 (this commit): project scaffold, Supabase Auth login, role-aware
layout/sidebar, and a permission-guarded route for every planned page (most
pages are still "coming soon" placeholders — see the project task list for
the phase-by-phase build order: Dashboard → Rooms/Tenants → Meter bulk entry
→ Bill generation → Payment verification → Maintenance → Move-out/Reports/
Settings).

Frontend permission checks (`src/auth/permissions.js`) are UX only — the
real security boundary is Supabase RLS, which already exists in this
project. Every page/query added in later phases must keep working correctly
under RLS even if someone bypasses this UI.
