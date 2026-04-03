# my-first-fullstack

A private notes app. Users sign up, log in, and manage their own notes. Every user sees only their own data — Row Level Security enforces ownership at the database level, not just in application code.

**Stack:** React 19 · Vite 8 · Supabase (Postgres + Auth) · local-first dev with the Supabase CLI

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | 18+ | [nodejs.org](https://nodejs.org) |
| Supabase CLI | latest | `npm install -g supabase` |
| Docker Desktop | latest | Required by the Supabase local stack |

---

## Folder structure

```
my-first-fullstack/
├── frontend/                       ← React SPA (Vite)
│   ├── .env.example                ← Copy to .env.local and fill in values
│   └── src/
│       ├── lib/
│       │   ├── supabase.js         ← Singleton Supabase client
│       │   └── database.types.js   ← JSDoc types mirroring the DB schema
│       ├── hooks/
│       │   ├── useAuth.js          ← Reactive session state
│       │   ├── useNotes.js         ← Notes CRUD + optimistic local state
│       │   ├── useProfile.js       ← User profile fetch + update
│       │   ├── useTags.js          ← Tag list + create
│       │   └── useTheme.js         ← Light/dark theme toggle
│       └── components/
│           ├── AuthForm.jsx        ← Login / sign-up form
│           ├── NoteEditor.jsx      ← Create / edit form
│           ├── NoteCard.jsx        ← Single note card
│           ├── NotesList.jsx       ← Authenticated main view
│           ├── ProfileEditor.jsx   ← Inline profile name editor
│           └── ThemeToggle.jsx     ← Light/dark mode button
└── supabase/
    ├── config.toml                 ← Local Supabase config (ports, auth settings)
    ├── seed.sql                    ← Sample users + notes (Alice, Bob, Carol)
    └── migrations/
        ├── 20260330000000_create_users_notes.sql
        ├── 20260330000001_create_user_profile_trigger.sql
        ├── 20260401000000_add_notes_pinned.sql
        ├── 20260401000001_add_notes_archived_at.sql
        ├── 20260401000002_create_tags.sql
        ├── 20260401000003_add_notes_fts.sql
        └── 20260401000004_enable_notes_realtime.sql
```

---

## Run locally from scratch

### 1. Start the local Supabase stack

```bash
supabase start
```

This starts Postgres, Auth, Storage, and the API gateway in Docker. First run pulls images — it takes a few minutes. Subsequent starts are fast.

When it finishes, it prints local credentials:

```
API URL:      http://localhost:54321
Anon key:     <your-anon-key>
DB URL:       postgresql://postgres:postgres@localhost:54322/postgres
Studio URL:   http://localhost:54323
```

Keep this terminal running (or use `supabase start` without a shell — it runs in the background).

### 2. Apply the schema and seed data

```bash
supabase db reset
```

This runs all migrations in `supabase/migrations/` in order, then applies `supabase/seed.sql`. Safe to re-run — seed uses `ON CONFLICT DO NOTHING`.

### 3. Configure the frontend

```bash
cd frontend
cp .env.example .env.local
```

Open `.env.local` and fill in the values printed by `supabase start`:

```env
VITE_SUPABASE_URL=http://localhost:54321
VITE_SUPABASE_ANON_KEY=<anon-key-from-supabase-start>
```

### 4. Install dependencies and start the dev server

```bash
npm install
npm run dev
```

The app is now running at **http://localhost:5173**.

---

## Useful commands

| Command | What it does |
|---------|-------------|
| `supabase start` | Start the local Supabase stack |
| `supabase stop` | Stop all containers (preserves data) |
| `supabase stop --no-backup` | Stop and wipe all local data |
| `supabase db reset` | Reapply all migrations + seed from scratch |
| `supabase db diff -f <name>` | Generate a new migration from schema changes |
| `supabase status` | Show running services and their URLs/keys |
| `supabase studio` | Open the local Supabase Studio in the browser |

### Generate TypeScript types from the live local schema

```bash
supabase gen types typescript --local > frontend/src/lib/database.types.ts
```

The project currently uses JSDoc types in `database.types.js`. Run the command above if you want to switch to TypeScript — it will generate a fully typed version from the actual database schema.

### Frontend scripts

```bash
cd frontend
npm run dev       # start Vite dev server (http://localhost:5173)
npm run build     # production build → frontend/dist/
npm run preview   # serve the production build locally
npm run lint      # ESLint
```

---

## How authentication works

1. The user signs up via the `AuthForm` — Supabase Auth sends a confirmation email.
2. On confirmation, a Postgres trigger (`handle_new_auth_user`) automatically inserts a matching row into `public.users`. This keeps the FK on `notes.user_id` satisfied for every auth method (email, OAuth, magic link) without any application-side workaround.
3. `useAuth.js` subscribes to `onAuthStateChange` — the UI reacts automatically when the session starts or ends.
4. Every Supabase query runs with the user's JWT. RLS policies on `notes` allow `SELECT / INSERT / UPDATE / DELETE` only where `user_id = (select auth.uid())`. Even if application code is wrong, the database refuses cross-user access.

---

## Database schema

```
public.users
  id            uuid  PK  → references auth.users(id)
  email         text
  full_name     text
  created_at    timestamptz
  updated_at    timestamptz

public.notes
  id            bigint  PK  (generated always as identity)
  user_id       uuid    FK  → public.users(id)
  title         text    NOT NULL
  content       text
  pinned        boolean NOT NULL DEFAULT false
  archived_at   timestamptz   ← NULL = active; set to now() to soft-delete
  search_vector tsvector GENERATED ALWAYS AS STORED  ← weighted FTS column
  created_at    timestamptz
  updated_at    timestamptz

public.tags
  id          bigint  PK  (generated always as identity)
  user_id     uuid    FK  → public.users(id)
  name        text    NOT NULL
  created_at  timestamptz
  UNIQUE (user_id, name)

public.note_tags  (join table)
  note_id     bigint  FK  → public.notes(id)  ON DELETE CASCADE
  tag_id      bigint  FK  → public.tags(id)   ON DELETE CASCADE
  PRIMARY KEY (note_id, tag_id)
```

Indexes on `notes`:
- `notes_active_user_pinned_created_idx` — partial index (`WHERE archived_at IS NULL`) covering `(user_id, pinned DESC, created_at DESC)` for the active-notes query
- `notes_archived_user_created_idx`      — partial index (`WHERE archived_at IS NOT NULL`) for the archive tab
- `notes_active_search_vector_idx`       — partial GIN index for full-text search on active notes

Index on `tags(user_id)` — FK column not covered by the PK.


