import '@testing-library/jest-dom'

// ---------------------------------------------------------------------------
// Env-var guard
// Only warn (don't throw) so unit + component tests work without a running
// Supabase instance. Integration tests do their own check in beforeAll.
// ---------------------------------------------------------------------------
const REQUIRED = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']
for (const key of REQUIRED) {
  if (!import.meta.env[key]) {
    console.warn(
      `[test-setup] Missing env var: ${key}. ` +
      'Integration tests will fail. Copy .env.example to .env and fill in local Supabase values.',
    )
  }
}
