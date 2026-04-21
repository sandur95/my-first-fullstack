## ADDED Requirements

### Requirement: Owner can share a document by sharee email
The system SHALL allow a document owner to grant another registered user access to a document by entering that user's email address and selecting a permission level (`view` or `edit`).

#### Scenario: Successful share with view permission
- **WHEN** the owner opens the Share panel for a document and submits a valid registered email with `view` permission
- **THEN** a `document_shares` row is created with `permission = 'view'` and the sharee immediately appears in the share list

#### Scenario: Successful share with edit permission
- **WHEN** the owner opens the Share panel for a document and submits a valid registered email with `edit` permission
- **THEN** a `document_shares` row is created with `permission = 'edit'` and the sharee immediately appears in the share list

#### Scenario: Email not found
- **WHEN** the owner submits an email that does not correspond to any registered account
- **THEN** the system SHALL display the error "No account found with that email address." and SHALL NOT create a share row

#### Scenario: Duplicate share attempt
- **WHEN** the owner submits an email for a user who already has a share row for that document
- **THEN** the system SHALL display the error "This document is already shared with that user." and SHALL NOT create a duplicate share row

#### Scenario: Owner attempts to share with themselves
- **WHEN** the owner enters their own email address
- **THEN** the system SHALL display "You cannot share a document with yourself." enforced at the database constraint level

---

### Requirement: Owner can update permission level of an existing document share
The system SHALL allow a document owner to change a sharee's permission from `view` to `edit` or from `edit` to `view`.

#### Scenario: Permission upgraded from view to edit
- **WHEN** the owner selects `edit` on an existing `view`-permission sharee
- **THEN** the `document_shares.permission` column SHALL be updated to `edit` and the sharee SHALL gain access to the live Yjs editor on their next open

#### Scenario: Permission downgraded from edit to view
- **WHEN** the owner selects `view` on an existing `edit`-permission sharee
- **THEN** the `document_shares.permission` column SHALL be updated to `view` and the sharee SHALL see only the rendered Markdown preview

---

### Requirement: Owner can revoke a document share
The system SHALL allow a document owner to revoke a share, removing the sharee's access entirely.

#### Scenario: Successful revocation
- **WHEN** the owner clicks "Revoke" on a sharee in the Share panel
- **THEN** the `document_shares` row SHALL be deleted, the sharee SHALL be removed from the share list, and the sharee SHALL no longer see the document in their shared documents list

---

### Requirement: Sharee with view permission sees rendered Markdown
A document shared with `view` permission SHALL display the document's plain-text `body` column rendered as Markdown, with owner attribution, in a read-only view.

#### Scenario: View-permission sharee opens a shared document
- **WHEN** a sharee navigates to a document shared with `view` permission
- **THEN** the system SHALL render the `body` column as read-only Markdown
- **THEN** the system SHALL display the owner's name as attribution
- **THEN** editing controls and the live Yjs editor SHALL NOT be available

---

### Requirement: Sharee with edit permission participates in collaborative editing
A document shared with `edit` permission SHALL allow the sharee to edit the document through the same Yjs-backed live editor used by the owner, with real-time synchronization between all connected peers.

#### Scenario: Sharee joins a live editing session
- **WHEN** an edit-permission sharee opens a document and at least one other peer (owner or another sharee) is already connected
- **THEN** the sharee's Yjs provider SHALL receive the current document state via `yjs-state-response` within `SYNC_TIMEOUT_MS`
- **THEN** subsequent keystrokes from any peer SHALL be broadcast as `yjs-update` events and applied to all connected peers within one broadcast cycle

#### Scenario: Sharee opens a document with no active peers
- **WHEN** an edit-permission sharee opens a document and no other peer is connected
- **THEN** the Yjs provider SHALL initialize from the persisted `yjs_state` bytea column
- **THEN** after `SYNC_TIMEOUT_MS` with no `yjs-state-response`, the provider SHALL mark itself as synced and allow editing

#### Scenario: Yjs state persisted after edit session
- **WHEN** any peer saves the document (title or body change)
- **THEN** the `documents.yjs_state` column SHALL be updated with the current `Y.encodeStateAsUpdate` snapshot
- **THEN** the `documents.body` column SHALL be updated with the plain-text export of the Yjs document text

#### Scenario: Edit-permission boundary — delete
- **WHEN** a sharee (even with `edit` permission) attempts to delete the document
- **THEN** the system SHALL NOT expose a delete control to the sharee, and the database RLS SHALL reject any direct DELETE attempt

---

### Requirement: Document share operations propagate in real time to the sharee
Changes to the `document_shares` table (INSERT, UPDATE, DELETE) SHALL be reflected in the sharee's shared documents list without a page reload.

#### Scenario: Share granted while sharee is online
- **WHEN** an owner grants a share while the sharee has the app open
- **THEN** the shared document SHALL appear in the sharee's shared documents list within one Realtime event cycle

#### Scenario: Share revoked while sharee is online
- **WHEN** an owner revokes a share while the sharee has the app open
- **THEN** the document SHALL be removed from the sharee's shared documents list within one Realtime event cycle

#### Scenario: Document body updated while sharee is online (view mode)
- **WHEN** the document body is saved by the owner or an edit-permission peer
- **THEN** the sharee's rendered Markdown view SHALL reflect the updated `body` content within one Realtime UPDATE event cycle
