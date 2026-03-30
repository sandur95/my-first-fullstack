# Notes App — Frontend

A full-stack notes app built with **React 19 + Vite + Supabase**. Users can sign up, log in, and privately manage their own notes. All data access is protected by Postgres Row Level Security — the database enforces ownership, not just the application layer.

---

## Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) project (or `supabase start` for local dev)

---

## Local setup

```bash
# 1. Install dependencies
cd frontend
npm install

# 2. Configure environment variables
cp .env.example .env.local
# Edit .env.local — fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY

# 3. Apply the database schema
supabase db reset          # local
# or:
# supabase db push          # remote

# 4. Start the dev server
npm run dev
```

---

## File structure

```
frontend/
├── .env.local                          ← Supabase connection vars (gitignored by Vite)
├── .env.example                        ← Committed template — copy to .env.local
└── src/
    ├── lib/
    │   ├── supabase.js                 ← Singleton Supabase client
    │   └── database.types.js           ← JSDoc types mirroring DB schema
    ├── hooks/
    │   ├── useAuth.js                  ← Reactive auth session
    │   └── useNotes.js                 ← Notes CRUD + local state
    ├── components/
    │   ├── AuthForm.jsx                ← Login / sign-up
    │   ├── NoteEditor.jsx              ← Create / edit form
    │   ├── NoteCard.jsx                ← Single note display
    │   └── NotesList.jsx               ← Authenticated main view
    ├── App.jsx                         ← Root: auth gate
    ├── App.css                         ← Component styles
    └── index.css                       ← Design tokens + base reset

supabase/
├── migrations/
│   ├── 20260330000000_create_users_notes.sql
│   └── 20260330000001_create_user_profile_trigger.sql
└── seed.sql
```

---

## What was built and why

### Database (`supabase/`)

#### `migrations/20260330000000_create_users_notes.sql`

Defines the two core tables:

| Table | Purpose |
|-------|---------|
| `public.users` | Public profile row linked 1:1 to `auth.users`. Stores `email` and `full_name`. |
| `public.notes` | User-owned notes. Each row has a `user_id` FK referencing `public.users`. |

**Schema decisions:**
- `bigint generated always as identity` PK on `notes` — sequential inserts, no index fragmentation (unlike random UUIDv4).
- `text` columns instead of `varchar(n)` — same performance in Postgres, no artificial length limit.
- `timestamptz` (not `timestamp`) — always timezone-aware; prevents bugs with UTC conversions.
- `create index notes_user_id_idx on notes(user_id)` — Postgres does **not** auto-index FK columns. Without this index every RLS policy check and JOIN would be a sequential scan.

**RLS policies:**
- Both tables have `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` so even the table owner cannot bypass policies.
- `auth.uid()` is wrapped in `(select auth.uid())` — without the subquery wrapper Postgres evaluates `auth.uid()` once **per row**, which can be 100× slower on large tables.
- Separate `SELECT / INSERT / UPDATE / DELETE` policies on `notes` give precise, auditable control.

#### `migrations/20260330000001_create_user_profile_trigger.sql`

An `AFTER INSERT ON auth.users` trigger that automatically creates a matching `public.users` profile row whenever a new user signs up — for any auth method (email, OAuth, magic link). This keeps the FK constraint satisfied without any application-layer workaround. Uses `security definer` + `set search_path = ''` to prevent search-path injection.

#### `seed.sql`

Three seed users (Alice, Bob, Carol) with seven notes. Uses single-statement batch inserts (one round-trip per table) and `ON CONFLICT DO NOTHING` so the file is safe to run multiple times.

---

### Frontend (`src/`)

#### `lib/supabase.js` — Singleton client

Creates and exports **one** Supabase client for the entire app. Importing directly from this file (rather than constructing a new client in each component) is critical because:
- Multiple clients cause duplicate `onAuthStateChange` subscriptions.
- The client holds an in-memory session cache; multiple instances each hold their own copy and can drift out of sync.

`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are read from `.env`. The module throws immediately if either is missing, so misconfiguration is caught at startup rather than silently failing on the first API call.

The anon key is safe to expose in the browser — RLS controls what each authenticated user can access.

#### `lib/database.types.js` — JSDoc type definitions

Mirrors the Postgres schema as JSDoc `@typedef`s. Provides IDE autocompletion and inline documentation without requiring TypeScript. To convert:
```bash
supabase gen types typescript --local > src/lib/database.types.ts
```

#### `hooks/useAuth.js` — Auth state

Subscribes to `supabase.auth.onAuthStateChange` so the UI updates automatically on sign-in, sign-out, and token refresh. The initial `getSession()` call and the subscription are in the **same `useEffect`** to prevent a race condition where the listener fires before the initial session is loaded.

Returns `{ session, loading }`.

#### `hooks/useNotes.js` — Notes CRUD

Manages the notes list for the authenticated user.

| Pattern | Why |
|---------|-----|
| `setNotes(prev => ...)` functional updates | Callbacks (`createNote`, `updateNote`, `deleteNote`) don't need `notes` in their dependency arrays — they receive the latest state via the updater function. This prevents stale closures and makes callbacks stable references. (`rerender-functional-setstate`) |
| `useCallback` with minimal deps | Stable function references avoid cascading child re-renders. |
| `fetchNotes` in `useCallback([userId])` | Re-fetches when `userId` changes (e.g. a different user logs in). |

#### `components/AuthForm.jsx`

Email/password sign-in and sign-up in a single togglable form.

- `isSignup` is **derived during render** from `mode` state — no `useEffect` or extra `useState` needed. (`rerender-derived-state-no-effect`)
- All conditionals use explicit ternaries (`condition ? <X /> : null`) rather than `&&`, which prevents rendering `0` or `NaN` as text when the condition is a number. (`rendering-conditional-render`)
- Error and success messages include ARIA `role="alert"` / `role="status"` for accessibility.

#### `components/NoteEditor.jsx`

Doubles as a **create** form (when `editingNote` is `null`) and an **edit** form (when a note is passed in). Uses a single `useEffect` to sync the form fields when `editingNote` changes.

#### `components/NoteCard.jsx`

Displays one note with Edit and Delete actions. Defined at **module top level** — never inside `NotesList` or any other component. Inline component definitions cause React to treat the component as a new type on every parent render, which forces a full remount, losing all state and re-running effects. (`rerender-no-inline-components`)

#### `components/NotesList.jsx`

The main authenticated view. Composites `NoteEditor` + `NoteCard` list. All sub-components are top-level imports. Handles save/delete orchestration and delegates mutation calls to `useNotes`.

#### `App.jsx` — Root

Reads the session from `useAuth` and derives `userId` during render:

```js
const userId = session?.user?.id ?? null  // derived, no useState
```

Shows `<AuthForm>` when unauthenticated and `<NotesList>` when authenticated. Uses an explicit ternary for the conditional render.

---

## Performance optimisations applied

| Rule | Where | Effect |
|------|-------|--------|
| `rerender-functional-setstate` | `useNotes` callbacks | Stable callback refs, no stale closures |
| `rerender-no-inline-components` | `NotesList` | Prevents full remount on every render |
| `rerender-derived-state-no-effect` | `App`, `AuthForm` | Eliminates redundant state + renders |
| `rendering-conditional-render` | All components | Prevents `0`/`NaN` text rendering |
| `bundle-barrel-imports` | All imports | Direct imports only, no barrel overhead |
| `security-rls-performance` (DB) | Migration | `(select auth.uid())` cached once per query |
| `schema-foreign-key-indexes` (DB) | Migration | Fast JOINs + cascade deletes on `notes.user_id` |

---

## Decisions

- **No router** — two views (auth / notes) need only a single conditional in `App`.
- **No React Query / SWR** — `useNotes` provides sufficient deduplication for this scope.
- **JS not TypeScript** — matches the existing Vite scaffold; JSDoc types give IDE hints.
- **`window.confirm` for deletes** — keeps scope minimal; swap for a modal component later.
- **Excluded:** realtime subscriptions, search/tagging, pagination — out of scope.

---

## Further considerations

1. **Email confirmation** — Supabase requires email confirmation by default. For local dev you can disable it in `supabase/config.toml`:
   ```toml
   [auth]
   enable_confirmations = false
   ```
2. **`.env.local` in git** — Vite gitignores `.env.local` automatically. Only `.env.example` should be committed.
