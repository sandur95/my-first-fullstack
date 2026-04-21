## ADDED Requirements

### Requirement: Owner can share a note by sharee email
The system SHALL allow a note owner to grant another registered user access to a note by entering that user's email address and selecting a permission level (`view` or `edit`).

#### Scenario: Successful share with view permission
- **WHEN** the owner opens the Share panel for a note and submits a valid registered email with `view` permission
- **THEN** a `note_shares` row is created with `permission = 'view'` and the sharee immediately appears in the share list

#### Scenario: Successful share with edit permission
- **WHEN** the owner opens the Share panel for a note and submits a valid registered email with `edit` permission
- **THEN** a `note_shares` row is created with `permission = 'edit'` and the sharee immediately appears in the share list

#### Scenario: Email not found
- **WHEN** the owner submits an email that does not correspond to any registered account
- **THEN** the system SHALL display the error "No account found with that email address." and SHALL NOT create a share row

#### Scenario: Duplicate share attempt
- **WHEN** the owner submits an email for a user who already has a share row for that note
- **THEN** the system SHALL display the error "This note is already shared with that user." and SHALL NOT create a duplicate share row

#### Scenario: Owner attempts to share with themselves
- **WHEN** the owner enters their own email address
- **THEN** the system SHALL display the error "You cannot share a note with yourself." enforced at the database constraint level

---

### Requirement: Owner can update permission level of an existing share
The system SHALL allow a note owner to change a sharee's permission from `view` to `edit` or from `edit` to `view` without revoking and re-sharing.

#### Scenario: Permission upgraded from view to edit
- **WHEN** the owner selects `edit` on an existing `view`-permission sharee in the Share panel
- **THEN** the `note_shares.permission` column SHALL be updated to `edit` and the share list SHALL reflect the new value immediately

#### Scenario: Permission downgraded from edit to view
- **WHEN** the owner selects `view` on an existing `edit`-permission sharee in the Share panel
- **THEN** the `note_shares.permission` column SHALL be updated to `view` and the sharee SHALL lose edit capability immediately

---

### Requirement: Owner can revoke a share
The system SHALL allow a note owner to revoke a previously granted share, removing the sharee's access entirely.

#### Scenario: Successful revocation
- **WHEN** the owner clicks "Revoke" on a sharee in the Share panel
- **THEN** the `note_shares` row SHALL be deleted, the sharee SHALL be removed from the share list immediately, and the sharee SHALL no longer see the note in their shared notes list

---

### Requirement: Sharee with view permission can read a note
A note shared with `view` permission SHALL be visible to the sharee in read-only form with the owner's name attributed.

#### Scenario: View-permission sharee opens a shared note
- **WHEN** a sharee opens a note shared with `view` permission
- **THEN** the system SHALL display the note title and content in a read-only rendered Markdown view
- **THEN** the system SHALL display the owner's name as attribution
- **THEN** editing controls (title input, content editor) SHALL be disabled or hidden

---

### Requirement: Sharee with edit permission can modify a note
A note shared with `edit` permission SHALL allow the sharee to change the note's title and content.

#### Scenario: Edit-permission sharee edits a shared note
- **WHEN** a sharee opens a note shared with `edit` permission and modifies the title or content
- **THEN** the changes SHALL be persisted to the database
- **THEN** auto-save SHALL apply the same way as for owned notes

#### Scenario: Edit-permission boundary — pin, archive, tag, delete, attachments
- **WHEN** a sharee (even with `edit` permission) attempts to pin, archive, add or remove tags, delete the note, or upload an attachment
- **THEN** the system SHALL NOT expose those controls to the sharee, and the database RLS SHALL reject any direct attempts

---

### Requirement: View-permission sharee can view and download note attachments (read-only)
A note shared with `view` (or `edit`) permission SHALL expose the note's existing attachment list to the sharee in read-only form. Sharees can view and download attachments but cannot upload new ones or delete existing ones.

#### Scenario: View-permission sharee sees attachment list
- **WHEN** a sharee opens a note that contains one or more attachments
- **THEN** the system SHALL display the attachment list (thumbnails for images, file icon for PDFs, file names)
- **THEN** each attachment SHALL be navigable/downloadable via an authenticated signed link
- **THEN** no upload control and no delete button SHALL be displayed to the sharee

---

### Requirement: Share operations propagate in real time to the sharee
Changes to the `note_shares` table (INSERT, UPDATE, DELETE) SHALL be reflected in the sharee's shared notes list without a page reload.

#### Scenario: Share granted while sharee is online
- **WHEN** an owner grants a share while the sharee has the app open
- **THEN** the shared note SHALL appear in the sharee's "Shared with me" notes list within one Realtime event cycle

#### Scenario: Share revoked while sharee is online
- **WHEN** an owner revokes a share while the sharee has the app open
- **THEN** the note SHALL be removed from the sharee's "Shared with me" notes list within one Realtime event cycle

#### Scenario: Note content updated while sharee is online
- **WHEN** an owner or another edit-permission sharee saves changes to a note
- **THEN** the sharee's rendered view of that note SHALL reflect the updated content within one Realtime event cycle

---

### Non-requirement: No owner notification on sharee account deletion
When a sharee's account is deleted the database SHALL cascade-remove the associated `note_shares` and `document_shares` rows automatically. The system SHALL NOT send any in-app notification or toast to the note/document owner as a result of this cascade removal. Owners wishing to audit their share lists can open the Share panel at any time to see current sharees.
