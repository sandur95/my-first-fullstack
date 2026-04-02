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
    │   ├── useNotes.js                 ← Notes CRUD + local state
    │   ├── useProfile.js               ← User profile fetch + update
    │   ├── useTags.js                  ← Tag list + create
    │   └── useTheme.js                 ← Light/dark theme toggle
    ├── components/
    │   ├── AuthForm.jsx                ← Login / sign-up
    │   ├── NoteEditor.jsx              ← Create / edit form
    │   ├── NoteCard.jsx                ← Single note display
    │   ├── NotesList.jsx               ← Authenticated main view
    │   ├── ProfileEditor.jsx           ← Inline display-name editor
    │   └── ThemeToggle.jsx             ← Light/dark mode button
    ├── App.jsx                         ← Root: auth gate
    ├── App.css                         ← Component styles
    └── index.css                       ← Design tokens + base reset

supabase/
├── migrations/
│   ├── 20260330000000_create_users_notes.sql
│   ├── 20260330000001_create_user_profile_trigger.sql
│   ├── 20260401000000_add_notes_pinned.sql
│   ├── 20260401000001_add_notes_archived_at.sql
│   ├── 20260401000002_create_tags.sql
│   ├── 20260401000003_add_notes_fts.sql
│   └── 20260401000004_enable_notes_realtime.sql
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

#### `migrations/20260401000000_add_notes_pinned.sql`

Adds a `pinned boolean NOT NULL DEFAULT false` column. Replaces the initial `notes_user_id_idx` with a composite index `(user_id, pinned DESC, created_at DESC)` so that the `ORDER BY pinned DESC, created_at DESC` clause can be served entirely from the index without a runtime sort step.

#### `migrations/20260401000001_add_notes_archived_at.sql`

Adds `archived_at timestamptz DEFAULT NULL` for soft-delete support. A note is active when `archived_at IS NULL` and archived when it is set to `now()`. Replaces the previous composite index with two partial indexes:
- `notes_active_user_pinned_created_idx` — covers the primary active-notes query
- `notes_archived_user_created_idx`      — covers the archive-tab query

Partial indexes are 5–20× smaller than full-table indexes and are faster to scan for queries that consistently filter on the same condition.

#### `migrations/20260401000002_create_tags.sql`

Creates `public.tags` (user-owned, unique name per user) and the `public.note_tags` join table. Adds a `security definer` helper function `owns_note(p_note_id)` that the `note_tags` RLS policies call to verify note ownership without a per-row correlated subquery on `notes`.

#### `migrations/20260401000003_add_notes_fts.sql`

Adds a **generated** `tsvector` column `search_vector` that Postgres maintains automatically on every `INSERT`/`UPDATE`. Title matches are weighted A and content matches are weighted B so callers can order by `ts_rank()` for relevance. A partial GIN index (`WHERE archived_at IS NULL`) covers full-text queries on active notes and is 30–50% smaller than a full-table index.

#### `migrations/20260401000004_enable_notes_realtime.sql`

Adds `notes` to the `supabase_realtime` publication. Clients subscribe with a `user_id=eq.<uid>` filter and RLS ensures they only receive events for their own rows.

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

#### `hooks/useProfile.js` — User profile

Fetches `full_name` from `public.users` once on mount (or when `userId` changes) and exposes `updateFullName`. Stores `null` instead of an empty string to avoid ghost values in the database. Returns `{ fullName, updateFullName }`.

#### `hooks/useTags.js` — Tags

Fetches the user's tag list ordered by name and exposes `createTag`. Uses `.toSorted()` (immutable sort) after an optimistic insert so the list stays alphabetical without a refetch. Returns `{ tags, createTag }`.

#### `hooks/useTheme.js` — Theme

Reads the initial theme from the `<html data-theme="…">` attribute set by the inline script in `index.html` — no `useEffect` and no flash of the wrong theme on load. `toggleTheme` writes to the DOM attribute, `localStorage`, and React state in one event handler. Returns `{ theme, toggleTheme }`.

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

#### `components/ProfileEditor.jsx`

Inline form for viewing and editing the user's display name. Mirrors the `NoteEditor` CSS patterns (`note-editor` / `note-editor-actions`) for visual consistency. Syncs the input field from `useProfile` via a single `useEffect` when the fetched value resolves. Defined at module top level. (`rerender-no-inline-components`)

#### `components/ThemeToggle.jsx`

Button that calls `useTheme().toggleTheme()`. The SVG icon constants (`SunIcon`, `MoonIcon`) are hoisted to module-level variables so they are never re-created on render. (`rendering-hoist-jsx`)

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
| `rerender-functional-setstate` | `useNotes`, `useTags` callbacks | Stable callback refs, no stale closures |
| `rerender-no-inline-components` | `NotesList`, `ProfileEditor` | Prevents full remount on every render |
| `rerender-derived-state-no-effect` | `App`, `AuthForm` | Eliminates redundant state + renders |
| `rerender-lazy-state-init` | `useTheme` | Reads DOM once at mount, no re-render |
| `rerender-move-effect-to-event` | `useTheme.toggleTheme` | DOM + localStorage written in event handler, not effect |
| `rendering-conditional-render` | All components | Prevents `0`/`NaN` text rendering |
| `rendering-hoist-jsx` | `ThemeToggle` | SVG constants never re-created on render |
| `bundle-barrel-imports` | All imports | Direct imports only, no barrel overhead |
| `security-rls-performance` (DB) | All migrations | `(select auth.uid())` cached once per query |
| `schema-foreign-key-indexes` (DB) | All migrations | Fast JOINs + cascade deletes on FK columns |
| `query-partial-indexes` (DB) | archived_at, FTS migrations | Indexes cover only the rows they serve |
| `query-index-types` (DB) | FTS migration | GIN index for `@@` tsvector queries |

---

## Decisions

- **No router** — two views (auth / notes) need only a single conditional in `App`.
- **No React Query / SWR** — `useNotes`, `useProfile`, and `useTags` provide sufficient deduplication for this scope.
- **JS not TypeScript** — matches the existing Vite scaffold; JSDoc types give IDE hints.
- **`window.confirm` for deletes** — keeps scope minimal; swap for a modal component later.
- **Soft-delete over hard-delete** — `archived_at` lets users recover notes; data is never permanently lost from the app.
- **Generated `search_vector`** — Postgres maintains the FTS column automatically; no application code needs to build or update it.
- **Realtime via Supabase channel** — `INSERT`/`UPDATE`/`DELETE` events streamed over WebSocket; client-side filter + RLS guarantee users only receive their own events.

---

## Further considerations

1. **Email confirmation** — Supabase requires email confirmation by default. For local dev you can disable it in `supabase/config.toml`:
   ```toml
   [auth]
   enable_confirmations = false
   ```
2. **`.env.local` in git** — Vite gitignores `.env.local` automatically. Only `.env.example` should be committed.
