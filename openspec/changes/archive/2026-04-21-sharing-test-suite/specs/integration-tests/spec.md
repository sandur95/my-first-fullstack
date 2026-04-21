## ADDED Requirements

### Requirement: get_user_id_by_email RPC resolves known email to UUID
The `get_user_id_by_email` RPC SHALL return the matching user's `id` and `full_name` for a known email.

#### Scenario: Known email returns matching user
- **WHEN** the RPC is called with `"alice@example.com"` (a seed user)
- **THEN** the result SHALL contain exactly one row
- **THEN** the row SHALL have `id = "00000000-0000-0000-0000-000000000001"` and `full_name = "Alice Smith"`

#### Scenario: Unknown email returns empty result
- **WHEN** the RPC is called with `"nobody@example.com"` (not a seed user)
- **THEN** the result SHALL be an empty array

#### Scenario: Direct SELECT on public.users denied for authenticated user
- **WHEN** an authenticated user (Bob) performs `SELECT * FROM public.users WHERE email = 'alice@example.com'`
- **THEN** the RLS policy SHALL deny the query (no rows returned or error)

---

### Requirement: note_shares RLS enforces owner-only write access
Only the note owner SHALL be able to insert, update, or delete rows in `note_shares` for their own notes.

#### Scenario: Owner can insert a share row
- **WHEN** Alice (owner of a note) inserts a share row granting Bob view access
- **THEN** the insert SHALL succeed and the row SHALL exist

#### Scenario: Non-owner cannot insert a share row
- **WHEN** Bob (not the owner) attempts to insert a share row for Alice's note
- **THEN** the insert SHALL be rejected by RLS

#### Scenario: Self-share trigger fires for notes
- **WHEN** Alice attempts to share her own note with herself
- **THEN** the insert SHALL fail with error code `23514`

#### Scenario: Duplicate share rejected
- **WHEN** Alice shares a note with Bob, then attempts to share the same note with Bob again
- **THEN** the second insert SHALL fail with error code `23505`

#### Scenario: Owner can revoke a share
- **WHEN** Alice deletes a share row she created
- **THEN** the delete SHALL succeed and the row SHALL no longer exist

---

### Requirement: document_shares RLS enforces owner-only write access
Only the document owner SHALL be able to insert, update, or delete rows in `document_shares` for their own documents.

#### Scenario: Owner can insert a document share row
- **WHEN** Alice (owner of a document) inserts a share row granting Bob view access
- **THEN** the insert SHALL succeed

#### Scenario: Non-owner cannot insert a document share row
- **WHEN** Bob attempts to insert a share row for Alice's document
- **THEN** the insert SHALL be rejected by RLS

#### Scenario: Self-share trigger fires for documents
- **WHEN** Alice attempts to share her own document with herself
- **THEN** the insert SHALL fail with error code `23514`

---

### Requirement: Realtime delivers share INSERT event to subscribed client
When a `note_shares` row is inserted, a Supabase Realtime subscription on that table SHALL receive a broadcast event containing the new row data.

#### Scenario: Share INSERT event received within timeout
- **WHEN** a Realtime client is subscribed to the `note_shares` table channel
- **AND** a share row is inserted by the admin client
- **THEN** the subscribed client SHALL receive an `INSERT` Realtime event within 3 seconds
- **THEN** the event payload SHALL contain the `note_id` and `shared_with_user_id`

#### Scenario: Share DELETE event received with full row data (REPLICA IDENTITY FULL)
- **WHEN** a Realtime client is subscribed to the `note_shares` table channel
- **AND** a share row is deleted by the admin client
- **THEN** the subscribed client SHALL receive a `DELETE` Realtime event within 3 seconds
- **THEN** `payload.old` SHALL contain `note_id` and `shared_with_user_id` (requires REPLICA IDENTITY FULL)
