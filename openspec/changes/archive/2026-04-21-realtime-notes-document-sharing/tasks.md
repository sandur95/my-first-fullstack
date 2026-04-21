## 1. Resolve Open Questions from Design

- [x] 1.1 Decide and document whether `view`-permission note sharees can see the note attachment list (read-only); update `specs/note-sharing/spec.md` with a new requirement if access is granted, or an explicit exclusion if not
- [x] 1.2 Decide and document whether shared notes and documents appear in the sharee's search and filter results, or only in the dedicated "Shared with me" view; update `specs/shared-content-browsing/spec.md` accordingly
- [x] 1.3 Decide whether owners should be notified (in-app toast or otherwise) when a sharee's account is deleted and the share row is cascade-removed; add a requirement to the relevant spec if notification is desired

## 2. Validate Note Sharing Against Spec

- [x] 2.1 Verify `NoteEditor` hides pin, archive, tag management, delete, and attachment upload controls when `sharePermission` is non-null (spec: "Edit-permission boundary — pin, archive, tag, delete, attachments")
- [x] 2.2 Verify `NoteCard` hides the share button and owner-only actions (archive, delete, tag management) for shared notes where `isOwner = false`
- [x] 2.3 Verify that the `useSharedNotes` channel 2 (notes content) is filtered to `allSharedNoteIds` and is recreated when the share set changes (spec: "Content channel recreated after share-set change")
- [x] 2.4 Verify the self-share prevention trigger (`prevent_self_share`) exists in the applied migrations and returns a `23514` check violation code that the frontend error handler maps to the correct user-facing message

## 3. Validate Document Sharing Against Spec

- [x] 3.1 Verify `DocumentEditor` hides the delete button for `edit`-permission sharees (`canEdit = true` but `isOwner = false`) — spec: "Edit-permission boundary — delete"
- [x] 3.2 Verify `DocumentEditor` shows only the read-only rendered Markdown preview (not the Yjs editor) for `view`-permission sharees
- [x] 3.3 Verify that after any Yjs edit session ends (auto-save), both `documents.yjs_state` and `documents.body` are updated in the same write operation (spec: "Yjs state persisted after edit session")
- [x] 3.4 Verify the self-share prevention trigger (`prevent_document_self_share`) exists and the frontend maps `23514` to the correct document-specific error message

## 4. Validate User Lookup Against Spec

- [x] 4.1 Verify `get_user_id_by_email` RPC is defined with `SECURITY DEFINER` and `SET search_path = ''` in the applied migrations
- [x] 4.2 Verify both `useShares.shareByEmail` and `useDocumentShares.shareByEmail` normalize the input email (trim + lowercase) before calling the RPC (spec: "Email input is normalized before lookup")
- [x] 4.3 Verify no frontend code performs a direct `SELECT` on `public.users` to look up another user's email

## 5. Validate Shared Content Browsing Against Spec

- [x] 5.1 Verify the "Shared with me" tab in `NotesList` displays owner name and avatar on each shared note card (spec: "Owner attribution is displayed for shared content")
- [x] 5.2 Verify the shared documents list in `DocumentsList` displays owner name and avatar on each shared document card
- [x] 5.3 Verify both shared lists show an empty-state message when no shares exist (spec: "No shared notes exist" / "No shared documents exist")
- [x] 5.4 Verify shared documents are ordered by `documents.updated_at DESC` in the `useSharedDocuments` query (spec: "Sharee views their shared documents list")

## 6. Archive Specs into openspec/specs

- [x] 6.1 Copy `specs/note-sharing/spec.md` → `openspec/specs/note-sharing/spec.md` so the capability is tracked in the global spec registry
- [x] 6.2 Copy `specs/document-sharing/spec.md` → `openspec/specs/document-sharing/spec.md`
- [x] 6.3 Copy `specs/shared-content-browsing/spec.md` → `openspec/specs/shared-content-browsing/spec.md`
- [x] 6.4 Copy `specs/user-lookup/spec.md` → `openspec/specs/user-lookup/spec.md`
