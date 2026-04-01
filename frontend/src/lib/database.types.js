/**
 * @fileoverview Database type definitions for the notes app.
 *
 * These JSDoc typedefs mirror the Postgres schema defined in:
 *   supabase/migrations/20260330000000_create_users_notes.sql
 *
 * If you convert this project to TypeScript, replace this file by running:
 *   supabase gen types typescript --local > src/lib/database.types.ts
 */

/**
 * A row in public.users.
 * Linked 1:1 to auth.users — created automatically by the
 * handle_new_auth_user trigger on sign-up.
 *
 * @typedef {Object} User
 * @property {string}      id         - UUID, mirrors auth.users.id
 * @property {string}      email
 * @property {string|null} full_name
 * @property {string}      created_at - ISO 8601 with timezone (timestamptz)
 * @property {string}      updated_at - ISO 8601 with timezone (timestamptz)
 */

/**
 * A row in public.notes.
 *
 * @typedef {Object} Note
 * @property {number}      id          - bigint identity primary key
 * @property {string}      user_id     - UUID FK → public.users.id
 * @property {string}      title
 * @property {string|null} content
 * @property {boolean}     pinned      - When true, note is displayed before unpinned notes
 * @property {string|null} archived_at - NULL = active. ISO 8601 timestamptz when archived.
 * @property {string}      created_at  - ISO 8601 with timezone (timestamptz)
 * @property {string}      updated_at  - ISO 8601 with timezone (timestamptz)
 */

// This module exports no runtime values — types are consumed via JSDoc only.
