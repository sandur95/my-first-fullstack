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
 * @property {string}      id          - UUID, mirrors auth.users.id
 * @property {string}      email
 * @property {string|null} full_name
 * @property {string|null} avatar_path - Relative path in the private "avatars" storage bucket.
 *                                       NULL = no avatar uploaded. e.g. '<user_id>/avatar.png'.
 *                                       Never store signed URLs here — generate them at display time.
 * @property {string}      created_at  - ISO 8601 with timezone (timestamptz)
 * @property {string}      updated_at  - ISO 8601 with timezone (timestamptz)
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
 * @property {NoteTag[]}            [note_tags]        - Joined tag associations (present when fetched with nested select)
 * @property {NoteAttachment[]}     [note_attachments] - Joined attachment metadata (present when fetched with nested select)
 */

/**
 * A row in public.note_attachments.
 * When fetched via nested select (e.g. inside a notes query) only the columns
 * requested in the select string are present.
 *
 * @typedef {Object} NoteAttachment
 * @property {number}      id           - bigint identity primary key
 * @property {number}      note_id      - bigint FK → public.notes.id
 * @property {string}      user_id      - UUID FK → public.users.id
 * @property {string}      storage_path - Relative path in the private "attachments" bucket.
 *                                        Convention: '<user_id>/<note_id>/<timestamp>_<random>_<name>'.
 *                                        Never store signed URLs here — generate at display time.
 * @property {string}      file_name    - Original filename for display and download
 * @property {string|null} mime_type    - e.g. 'image/jpeg', 'application/pdf'
 * @property {number|null} file_size    - Size in bytes
 * @property {string}      created_at   - ISO 8601 with timezone (timestamptz)
 */

/**
 * A row in public.tags.
 *
 * @typedef {Object} Tag
 * @property {number} id         - bigint identity primary key
 * @property {string} user_id    - UUID FK → public.users.id
 * @property {string} name
 * @property {string} created_at - ISO 8601 with timezone (timestamptz)
 */

/**
 * A row in public.note_tags (join table).
 * When fetched via nested select the `tags` field contains the related Tag row.
 *
 * @typedef {Object} NoteTag
 * @property {number} note_id
 * @property {number} tag_id
 * @property {Tag}    tags    - Nested Tag row from Supabase nested select
 */

// This module exports no runtime values — types are consumed via JSDoc only.
