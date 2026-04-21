## 1. Install and Configure Test Infrastructure

- [ ] 1.1 Install devDependencies in `frontend/`: `vitest`, `@vitest/coverage-v8`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, `jsdom`
- [ ] 1.2 Add `"test": "vitest"` and `"test:coverage": "vitest run --coverage"` scripts to `frontend/package.json`
- [ ] 1.3 Add `test` block to `frontend/vite.config.js`: set `globals: true`, `environment: 'jsdom'`, `setupFiles: ['./src/__tests__/setup.js']`, `testTimeout: 10000`
- [ ] 1.4 Create `frontend/src/__tests__/setup.js`: import `@testing-library/jest-dom`, validate `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` env vars exist (throw descriptive error if missing), mock `../lib/supabase` with `vi.mock`
- [ ] 1.5 Create `frontend/src/__tests__/helpers/supabase-clients.js`: export `adminClient` (service-role key), `signInAs(email, password)` returning an authed client, and seed user constants (`ALICE`, `BOB`, `CAROL` with their UUIDs and emails)
- [ ] 1.6 Run `npm test` and confirm the framework starts (no test files yet = 0 tests, no errors)

## 2. Unit Tests — Pure Logic

- [ ] 2.1 Create `src/__tests__/unit/yjs-encoding.test.js`: test `uint8ArrayToBase64` → `base64ToUint8Array` round-trip and `uint8ArrayToHex` → `hexToUint8Array` round-trip with a known byte array
- [ ] 2.2 Create `src/__tests__/unit/SupabaseBroadcastProvider.test.js`: build a fake Supabase channel (capture `on()` handlers, spy on `send()`); test (a) `yjs-state-response` sets `synced=true` and applies state; (b) 500ms timeout self-syncs via `vi.useFakeTimers()`; (c) local Yjs edit calls `send` with `yjs-update`; (d) remote `yjs-update` does NOT call `send`
- [ ] 2.3 Create `src/__tests__/unit/email-normalization.test.js`: mock `@supabase/supabase-js` RPC; call `useShares.shareByEmail("  Alice@Example.COM  ", 'view')`; assert the RPC was called with `"alice@example.com"`
- [ ] 2.4 Create `src/__tests__/unit/error-code-mapping.test.js`: mock the insert to return `{ code: '23505' }`, assert return value is the duplicate message; mock `{ code: '23514' }`, assert self-share message; test the same for `useDocumentShares`

## 3. Component Tests — Permission Boundaries

- [ ] 3.1 Create `src/__tests__/components/NoteEditor.sharePermission.test.jsx`: render `NoteEditor` with `sharePermission="edit"` and assert "Attach file" button is NOT in the document; render with `sharePermission={null}` and assert it IS present
- [ ] 3.2 Create `src/__tests__/components/NoteCard.sharePermission.test.jsx`: test (a) `sharePermission="view"` + `isOwner=false` → edit action is no-op; (b) `sharePermission="edit"` + `isOwner=false` → edit action is callable; (c) `sharePermission="view"` + `ownerName="Alice Smith"` → "Alice Smith" text present; (d) `sharePermission={null}` + `ownerName={null}` → no attribution text
- [ ] 3.3 Create `src/__tests__/components/DocumentEditor.sharePermission.test.jsx`: render with `isOwner=false` (any sharePermission) and assert no delete button; render with `isOwner=true` and assert delete button present; render with `sharePermission="view"` and assert markdown preview visible, editor textarea absent

## 4. Integration Tests — Database (RLS, RPC, Triggers)

- [ ] 4.1 Create `src/__tests__/integration/get_user_id_by_email.test.js` (`@vitest-environment node`): test (a) known email returns correct UUID + full_name; (b) unknown email returns empty array; (c) Bob's authed client can SELECT from `public.users` using the allowed policy but cannot enumerate other users' emails directly
- [ ] 4.2 Create `src/__tests__/integration/note-shares.rls.test.js` (`@vitest-environment node`): `beforeEach` seeds Alice's note via `adminClient`; `afterEach` deletes it; test (a) Alice can insert share row for Bob; (b) Bob cannot insert share row for Alice's note; (c) self-share by Alice returns `23514`; (d) duplicate share returns `23505`; (e) Alice can delete the share row
- [ ] 4.3 Create `src/__tests__/integration/document-shares.rls.test.js` (`@vitest-environment node`): mirror of 4.2 for documents — seed Alice's document, test owner insert/revoke, non-owner blocked, self-share trigger fires

## 5. Integration Tests — Realtime

- [ ] 5.1 Create `src/__tests__/integration/realtime-shares.test.js` (`@vitest-environment node`): subscribe to `note_shares` channel via anon client; insert row via `adminClient`; await INSERT event (max 3s); assert payload contains `note_id` and `shared_with_user_id`
- [ ] 5.2 In same file, test DELETE event: insert then delete a share row via `adminClient`; await DELETE event; assert `payload.old` contains `note_id` (validates REPLICA IDENTITY FULL is set)

## 6. Verify and Polish

- [ ] 6.1 Run full test suite (`npm test`) against local Supabase instance and confirm all tests pass
- [ ] 6.2 Run `npm run test:coverage` and review which lines are uncovered; add targeted tests for any missed error branches in `useShares` / `useDocumentShares`
- [ ] 6.3 Add a comment block at the top of each integration test file documenting the prerequisite: `supabase start` must be running and `supabase db seed` must have been run
