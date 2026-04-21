## Why

All sharing features (note sharing, document sharing, shared content browsing, user lookup) have been manually tested and are working. Without an automated regression suite, future changes to hooks, components, RLS policies, or the Yjs provider cannot be made with confidence. This change locks in the verified behavior as an executable test suite.

## What Changes

- Add **Vitest** as the test runner with `jsdom` (components) and `node` (integration) environments
- Add **React Testing Library** for component render tests
- Add unit tests for pure logic: Yjs encoding, `SupabaseBroadcastProvider` sync protocol, error code → message mapping, email normalization
- Add component tests locking in permission-boundary rendering (controls hidden/shown based on `sharePermission` and `isOwner`)
- Add integration tests against local Supabase for: `get_user_id_by_email` RPC, `note_shares` and `document_shares` RLS policies, self-share triggers, and Realtime event propagation

## Capabilities

### New Capabilities
- `test-infrastructure`: Vitest config, environment setup, shared test utilities (seeded user credentials, admin/user Supabase client factories)
- `unit-tests`: Pure logic and class-level tests (yjs-encoding, SupabaseBroadcastProvider, error mapping, email normalization)
- `component-tests`: RTL render tests for NoteEditor, NoteCard, and DocumentEditor permission boundaries
- `integration-tests`: Live Supabase tests for RPC, RLS, triggers, and Realtime channels

### Modified Capabilities
(none)

## Impact

- **`frontend/package.json`**: adds `vitest`, `@vitest/coverage-v8`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, `jsdom` as devDependencies; adds `test` and `test:coverage` scripts
- **`frontend/vite.config.js`**: adds `test` block for Vitest configuration
- **`frontend/src/__tests__/`**: new test directory (~8 test files)
- **`frontend/src/__tests__/setup.ts`**: global test setup (jest-dom matchers, env vars for local Supabase)
- No runtime code changes; no migrations; no existing files modified beyond `package.json` and `vite.config.js`
