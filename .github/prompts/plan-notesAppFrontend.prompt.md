# Plan: Notes App Frontend with Supabase Auth

Build a React 19 + Vite notes SPA with Supabase Auth. Users sign up, log in, and manage their own private notes. RLS enforces ownership at the database layer.

**Skills applied:** vercel-react-best-practices + supabase-postgres-best-practices

---

## Phase 1 — Package & Config

**Step 1.** Update `frontend/package.json` — add `@supabase/supabase-js` to `dependencies`:
```json
"@supabase/supabase-js": "^2"
```

**Step 2.** Create `frontend/.env` and `frontend/.env.example` with identical content:
```
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

---

## Phase 2 — Database Migration

**Step 3.** Create `supabase/migrations/20260330000001_create_user_profile_trigger.sql`:

```sql
-- Automatically creates a public.users row when a user signs up via any auth method.
-- security definer + explicit search_path prevents search-path injection.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, email, full_name)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();
```

*Why:* Without this, signing up creates a row in `auth.users` but not `public.users`, breaking the FK constraint on `notes.user_id`. An `AFTER INSERT` trigger is atomic and works for every auth method.

---

## Phase 3 — Supabase Client & Types

**Step 4.** Create `frontend/src/lib/supabase.js`:
- Import `createClient` directly from `@supabase/supabase-js` (bundle-barrel-imports — direct import, no barrel)
- Read `import.meta.env.VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
- Throw a clear error if either is missing (fail fast, security boundary)
- Export a single `supabase` constant — **singleton** to prevent duplicate `onAuthStateChange` subscriptions and session cache drift
- JSDoc `@type {SupabaseClient}` annotation

**Step 5.** Create `frontend/src/lib/database.types.js`:
- Pure JSDoc file — no runtime exports
- `@typedef User` with properties: `id (string/uuid)`, `email (string)`, `full_name (string|null)`, `created_at (string)`, `updated_at (string)`
- `@typedef Note` with properties: `id (number/bigint)`, `user_id (string/uuid)`, `title (string)`, `content (string|null)`, `created_at (string)`, `updated_at (string)`
- Comment: "Run `supabase gen types typescript --local` if converting to TypeScript"

---

## Phase 4 — Custom Hooks

**Step 6.** Create `frontend/src/hooks/useAuth.js`:
- `useState(null)` for `session`, `useState(true)` for `loading`
- Single `useEffect` that:
  1. Calls `supabase.auth.getSession()` to set initial session
  2. Subscribes via `supabase.auth.onAuthStateChange()`
  3. Returns cleanup `subscription.unsubscribe()`
- *Why a single effect:* prevents race between initial fetch and subscriber
- Returns `{ session, loading }`

**Step 7.** Create `frontend/src/hooks/useNotes.js`:
- `useState([])` for `notes`, `useState(false)` for `loading`, `useState(null)` for `error`
- `fetchNotes` wrapped in `useCallback([userId])` — re-fetches when user changes; called from a `useEffect([fetchNotes])`
- `createNote(userId, {title, content})` — inserts, then `setNotes(prev => [data, ...prev])` — functional setState (rerender-functional-setstate)
- `updateNote(id, {title, content})` — updates, then `setNotes(prev => prev.map(...))` — functional setState, no `notes` dep
- `deleteNote(id)` — deletes, then `setNotes(prev => prev.filter(...))` — functional setState
- All three wrapped in `useCallback` with minimal deps (no `notes` needed because functional updates)
- Returns `{ notes, loading, error, createNote, updateNote, deleteNote }`

---

## Phase 5 — Components

All components defined at **module top level** — never inside another component (rerender-no-inline-components).
All conditionals use **explicit ternaries** (`condition ? <X /> : null`), never `&&` (rendering-conditional-render).

**Step 8.** Create `frontend/src/components/AuthForm.jsx`:
- State: `mode ('login'|'signup')`, `email`, `password`, `error`, `loading`, `message`
- `isSignup = mode === 'signup'` — **derived during render**, no useEffect (rerender-derived-state-no-effect)
- `handleSubmit`: calls `supabase.auth.signUp` or `supabase.auth.signInWithPassword` based on `isSignup`
- On signup success: show "Check your email to confirm your account."
- Error `<p role="alert">`, message `<p role="status">` — accessibility
- Toggle button (`type="button"`, class `auth-toggle`) to switch between login/signup modes
- No props needed — `onAuthStateChange` in `useAuth` will automatically detect the login

**Step 9.** Create `frontend/src/components/NoteCard.jsx`:
- Props: `{ note: Note, onEdit: Function, onDelete: Function }`
- Renders `<article>` with title, content (ternary null check), date, Edit + Delete buttons
- `<time dateTime={note.created_at}>` with `toLocaleDateString()`
- Edit button: `type="button"` class `btn-secondary`, calls `onEdit(note)`
- Delete button: `type="button"` class `btn-danger`, calls `onDelete(note.id)`

**Step 10.** Create `frontend/src/components/NoteEditor.jsx`:
- Props: `{ editingNote: Note|null, onSave, onCancel, saving: boolean }`
- State: `title (string)`, `content (string)`
- `useEffect([editingNote])` — syncs form fields when edit target changes
- `handleSubmit`: calls `onSave({title, content})`, clears fields only if `editingNote === null`
- Submit button label: "Saving…" / "Update" / "Create" (ternary chain)
- Cancel button shown only when `editingNote !== null` (ternary)

**Step 11.** Create `frontend/src/components/NotesList.jsx`:
- Props: `{ userId: string, onSignOut: Function }`
- Uses `useNotes(userId)` hook
- State: `editingNote (Note|null)`, `saving (boolean)`, `saveError (string|null)`
- `handleSave`: if `editingNote !== null` call `updateNote`, else `createNote`; wraps in try/catch with `setSaveError`
- `handleDelete`: calls `window.confirm` first, then `deleteNote`
- Renders: sticky header with "Notes" logo + Sign out button, `<NoteEditor>`, errors, loading state, empty state, notes grid with `<NoteCard>` per note

---

## Phase 6 — Update Existing Files

**Step 12.** Replace `frontend/src/App.jsx` entirely:
```jsx
import { useAuth } from './hooks/useAuth'
import AuthForm from './components/AuthForm'
import NotesList from './components/NotesList'
import { supabase } from './lib/supabase'
import './App.css'

function App() {
  const { session, loading } = useAuth()
  const userId = session?.user?.id ?? null  // derived during render (rerender-derived-state-no-effect)

  async function handleSignOut() {
    await supabase.auth.signOut()
  }

  if (loading) return <div className="centered-status">Loading…</div>

  return session !== null ? (
    <NotesList userId={userId} onSignOut={handleSignOut} />
  ) : (
    <AuthForm />
  )
}
export default App
```

**Step 13.** Replace `frontend/src/index.css` with design tokens + base reset:
- CSS custom properties: `--bg`, `--surface`, `--border`, `--text`, `--text-muted`, `--primary`, `--primary-hover`, `--danger`, `--danger-hover`, `--radius`, `--shadow`
- `box-sizing: border-box` universal reset
- `body`: system font stack, `color: var(--text)`, `background: var(--bg)`, `margin: 0`
- Heading and paragraph margin resets

**Step 14.** Replace `frontend/src/App.css` with component styles:
- `.auth-container` — full-viewport flex center
- `.auth-card` — white card, max-width 400px, box-shadow
- Auth form: flex column, `label`, `input` with focus ring using `--primary`
- `.auth-toggle` — borderless text button
- `.form-error` / `.form-message` — colored feedback bars with border
- `.notes-layout` — flex column, min-height 100vh
- `.notes-header` — sticky top, flex space-between, box-shadow
- `.notes-main` — max-width 900px, centered, flex column gap
- `.note-editor` — white card with flex column gap
- `.notes-grid` — `display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr))`
- `.note-card` — white card with flex column; footer flex space-between
- Base `button` styles + `button[type="submit"]` → primary blue + `btn-secondary`, `btn-danger` variants
- `.centered-status` — full-viewport flex center for loading state

**Step 15.** Create/replace `frontend/README.md` with detailed documentation.

---

## Phase 7 — Update package.json

**Step 16.** In `frontend/package.json`, add to `"dependencies"`:
```json
"@supabase/supabase-js": "^2"
```

---

## Relevant Files

- `frontend/package.json` — add `@supabase/supabase-js`
- `frontend/.env` + `frontend/.env.example` — create with placeholder vars
- `supabase/migrations/20260330000001_create_user_profile_trigger.sql` — create
- `frontend/src/lib/supabase.js` — create (singleton client)
- `frontend/src/lib/database.types.js` — create (JSDoc types)
- `frontend/src/hooks/useAuth.js` — create
- `frontend/src/hooks/useNotes.js` — create
- `frontend/src/components/AuthForm.jsx` — create
- `frontend/src/components/NoteCard.jsx` — create
- `frontend/src/components/NoteEditor.jsx` — create
- `frontend/src/components/NotesList.jsx` — create
- `frontend/src/App.jsx` — replace (currently default Vite demo)
- `frontend/src/App.css` — replace
- `frontend/src/index.css` — replace
- `frontend/README.md` — replace with detailed docs

---

## Verification

1. `cd frontend && npm install` — no errors, `@supabase/supabase-js` present in node_modules
2. Fill `.env` with a real Supabase project URL + anon key
3. `supabase db reset` (local) or `supabase db push` (remote) — migrations apply without error
4. `npm run dev` — app loads, shows AuthForm
5. Sign up with a test email → "Check your email" message shown
6. Confirm email → sign in → NotesList view shown
7. Create a note → appears in grid immediately (optimistic local update)
8. Edit a note → form pre-fills, Update saves
9. Delete a note → confirm dialog, note removed from grid
10. Sign out → returns to AuthForm
11. Sign in as a different user → sees only their own notes (RLS enforced)
12. `npm run build` — no bundle errors

---

## Decisions

- **No router** — two views (auth / notes) are simple enough for a single conditional render in App
- **No React Query / SWR** — the `useNotes` hook provides sufficient deduplication for this scope
- **JS not TypeScript** — matched to the existing Vite scaffold; JSDoc types provide IDE hints
- **Window.confirm for delete** — keeps scope minimal; can be replaced with a modal component later
- **Excluded:** real-time subscriptions, note tags/search, pagination — out of scope for this task
