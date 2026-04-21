## ADDED Requirements

### Requirement: Vitest is configured and runnable
The project SHALL have a working Vitest configuration that runs all test files under `src/__tests__/` with a single `npm test` command.

#### Scenario: npm test executes without configuration errors
- **WHEN** `npm test` is run in the `frontend/` directory
- **THEN** Vitest SHALL discover and execute all `*.test.{js,jsx,ts,tsx}` files under `src/__tests__/`
- **THEN** the process SHALL exit with code 0 when all tests pass

#### Scenario: Component tests run in jsdom environment
- **WHEN** a test file in `src/__tests__/components/` is executed
- **THEN** `window`, `document`, and `HTMLElement` SHALL be available in the test scope

#### Scenario: Integration tests run in node environment
- **WHEN** a test file in `src/__tests__/integration/` is executed
- **THEN** no DOM globals SHALL be injected (pure Node environment)

---

### Requirement: Global test setup configures jest-dom matchers and env vars
The test setup file SHALL extend Vitest's `expect` with `@testing-library/jest-dom` matchers and SHALL validate that required environment variables for local Supabase are present.

#### Scenario: jest-dom matchers available in all tests
- **WHEN** any test uses `expect(element).toBeInTheDocument()`
- **THEN** the matcher SHALL work without an explicit import in each test file

#### Scenario: Missing Supabase env vars produce a clear error
- **WHEN** integration tests are run without `VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY` set
- **THEN** the setup SHALL throw a descriptive error indicating which variable is missing rather than failing with a cryptic network error
