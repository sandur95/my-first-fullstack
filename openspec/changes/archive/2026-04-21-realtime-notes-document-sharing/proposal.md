## Why

The app has notes and markdown documents with sharing infrastructure in the database, but there is no unified, coherent specification documenting how sharing works end-to-end — from granting access, to real-time collaborative editing of shared content, to the sharee's experience. Without this spec we cannot reason about gaps, edge cases, or future extension points consistently.

## What Changes

- Specify the **note sharing** capability: how owners grant/revoke view or edit access to other users by email, what sharees can see and do, and how real-time updates propagate
- Specify the **document sharing** capability: same ownership model as notes, but for long-form markdown documents with Yjs-based collaborative editing for edit-permission sharees
- Specify the **shared content browsing** capability: unified experience for sharees to see all notes and documents shared with them, with owner attribution and live updates
- Specify the **user search** capability: how the app resolves a typed email address to a user ID when creating a share

## Capabilities

### New Capabilities
- `note-sharing`: Owner grants/revokes view or edit access to a note by sharee email; sharees can read or edit the note body/title based on permission; pin, archive, tag, delete remain owner-only
- `document-sharing`: Owner grants/revokes view or edit access to a document by sharee email; view-permission sharees see a rendered markdown preview; edit-permission sharees collaborate in the Yjs-backed live editor
- `shared-content-browsing`: Sharees see all notes and documents shared with them in dedicated list views, with owner avatar/name attribution and real-time share grant/revoke events
- `user-lookup`: Resolving a target user by email address to obtain their UUID when creating a share row; uses a security-definer RPC to avoid exposing the full users table

### Modified Capabilities

(none — no existing spec-level requirements are changing)

## Impact

- **Database**: `note_shares`, `document_shares`, `get_user_id_by_email()` RPC — already migrated; no schema changes expected
- **Frontend hooks**: `useShares`, `useDocumentShares`, `useSharedNotes`, `useSharedDocuments` — already implemented; spec validates current behavior
- **Frontend components**: `SharePanel`, `DocumentSharePanel`, `NotesList` (shared tab), `DocumentEditor` (shared mode) — already implemented; spec validates current behavior
- **Realtime**: Supabase Realtime channels on `note_shares`, `notes`, `document_shares`, `documents` — already wired; spec documents subscription strategy and channel lifecycle
- **Storage/Attachments**: attachment uploads on shared notes remain owner-only; no impact on storage policies
