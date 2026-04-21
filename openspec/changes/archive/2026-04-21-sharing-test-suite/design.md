## Context

The app is a Vite + React project with no existing test infrastructure. All sharing features have been manually verified against a local Supabase instance (port 54321) with seed data containing three users: Alice (`...0001`), Bob (`...0002`), Carol (`...0003`), all with password `password123`. The goal is a regression suite — lock in what already works, not discover new behavior.

## Goals / Non-Goals

**Goals:**
- Install and configure Vitest so `npm test` runs all three layers (unit, component, integration)
- Cover every scenario from the four sharing specs that maps to a testable unit
- Use the existing seed users; no dynamic user creation needed
- Keep integration tests isolated (clean up created rows in `afterEach`)

**Non-Goals:**
- E2E browser tests (Playwright) — deferred, the user has done manual E2E
- Testing non-sharing features (notes CRUD, tags, attachments, profile)
- Achieving 100% line coverage — scenario coverage is the target
- CI pipeline setup (out of scope for this change)

## Decisions

### Decision 1 — Vitest over Jest

**Choice:** Vitest.

**Rationale:** The project uses Vite. Vitest reuses `vite.config.js` transforms, supports ES modules natively, and has a near-identical API to Jest. Adding Jest to a Vite project requires Babel or separate transform config; Vitest is zero-friction.

**Alternative:** Jest + babel-jest. Rejected — requires a separate Babel config and `moduleNameMapper` for path aliases.

---

### Decision 2 — Two Vitest environments in one config

**Choice:** Use Vitest's per-file `@vitest-environment` docblock annotation.
- `__tests__/unit/` and `__tests__/components/` → `jsdom`
- `__tests__/integration/` → `node`

**Rationale:** Component tests need `window`/`document` (jsdom). Integration tests hit a real HTTP server and must not use jsdom (it polyfills fetch in a way that can conflict with Node's native fetch used by `@supabase/supabase-js`).

**Alternative:** Two separate Vitest configs. Rejected as over-engineering for 8 files.

---

### Decision 3 — Integration tests use two Supabase clients

**Choice:** Each integration test file creates:
1. `adminClient` — service-role key, bypasses RLS, used for seeding and teardown
2. `userClient(userId)` — signs in as a seed user via `signInWithPassword`, used to assert RLS boundaries

**Rationale:** Service-role key is available from `supabase status` locally as `service_role key`. Seeding via admin is faster and more reliable than trying to work around RLS policies in setup.

**Alternative:** Use only the service-role client. Rejected — it bypasses RLS and would make RLS tests meaningless.

---

### Decision 4 — SupabaseBroadcastProvider tested with a hand-rolled fake channel

**Choice:** Inject a fake Supabase client whose `.channel()` returns a spy object. Capture the `on()` handlers and invoke them directly in tests. Use `vi.useFakeTimers()` for the 500ms sync timeout scenario.

**Rationale:** The provider's constructor takes `supabaseClient` as an argument — it's already designed for injection. No real network needed. The sync protocol (request → response → synced) is pure state machine logic on top of callbacks.

**Alternative:** Mock `@supabase/supabase-js` at the module level. Rejected — too broad, hides the constructor injection seam.

---

### Decision 5 — Component tests mock the Supabase module

**Choice:** In `__tests__/setup.js`, mock `../lib/supabase` with `vi.mock()` so component tests never attempt real network calls. The mock returns controlled data via `mockResolvedValue`.

**Rationale:** Component tests should only assert rendering logic, not data fetching. The hooks are tested separately at the integration layer.

**Alternative:** Mock at the `fetch` level. Rejected — more complex and fragile.

---

### Decision 6 — Realtime integration test strategy

**Choice:** Subscribe a Vitest-managed Supabase client to the `note_shares` channel, then INSERT a share row via the admin client, and `await` the event using a `Promise` that resolves in the channel handler. Wrap in `vi.waitFor` with a 3-second timeout.

**Rationale:** The local Supabase Realtime server is always available when `supabase start` is running. This directly validates the two-channel strategy from the design doc without any mocking.

**Note:** `REPLICA IDENTITY FULL` must be set on `note_shares` and `document_shares` (already done in migrations `20260403000001` and `20260407000000`).

## Risks / Trade-offs

- **Integration tests require `supabase start`** → If the local instance is not running, integration tests fail with a connection error. Mitigation: add a clear error message in the test setup (`beforeAll`) that checks connectivity and skips the suite with a descriptive message if unreachable.
- **Realtime test timing** → The 3-second timeout for Realtime events is generous on localhost but could flake on a heavily loaded machine. Mitigation: set `testTimeout: 10000` in Vitest config.
- **Seed data dependency** → Integration tests assume the three seed users exist. If `supabase db reset` has not been run, UUIDs won't exist. Mitigation: document the prerequisite in the test `README` comment at the top of each integration file.

## Migration Plan

1. Install devDependencies (`npm install -D ...`) in `frontend/`
2. Update `vite.config.js` with Vitest test block
3. Create `__tests__/setup.js` with global matchers and env var validation
4. Write test files layer by layer: unit → component → integration
5. Run `npm test` and verify all pass against local Supabase

Rollback: delete the `__tests__/` directory and revert `package.json` and `vite.config.js`.

## Open Questions

(none — all resolved during explore session)
