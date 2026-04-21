## ADDED Requirements

### Requirement: Sharee sees all notes shared with them in a dedicated list view
The system SHALL provide the authenticated user with a list of all notes shared with them by other users, separate from their own notes, with the sharing owner identified.

#### Scenario: Sharee views their shared notes list
- **WHEN** the authenticated user navigates to the "Shared with me" tab on the notes screen
- **THEN** the system SHALL display all notes where a `note_shares` row exists with `shared_with_user_id = current_user_id`
- **THEN** each item SHALL display the note title, a preview of the content, the owner's name and avatar, and the sharee's permission level (`view` or `edit`)
- **THEN** archived shared notes SHALL NOT appear in the list

#### Scenario: No shared notes exist
- **WHEN** the authenticated user has no notes shared with them
- **THEN** the system SHALL display an empty state message indicating no notes have been shared with them

---

### Requirement: Sharee sees all documents shared with them in a dedicated list view
The system SHALL provide the authenticated user with a list of all documents shared with them by other users, separate from their own documents, with the sharing owner identified.

#### Scenario: Sharee views their shared documents list
- **WHEN** the authenticated user navigates to the documents screen and selects the "Shared with me" section
- **THEN** the system SHALL display all documents where a `document_shares` row exists with `shared_with_user_id = current_user_id`
- **THEN** each item SHALL display the document title, the owner's name and avatar, and the sharee's permission level
- **THEN** documents SHALL be ordered by `documents.updated_at DESC`

#### Scenario: No shared documents exist
- **WHEN** the authenticated user has no documents shared with them
- **THEN** the system SHALL display an empty state message indicating no documents have been shared with them

---

### Requirement: Shared notes list updates in real time
The shared notes list SHALL stay current without a page reload when share membership or note content changes.

#### Scenario: New share appears while sharee is online
- **WHEN** a share INSERT event arrives on the `note_shares` Realtime channel
- **THEN** the new note SHALL be fetched and prepended (or inserted by recency) into the shared notes list

#### Scenario: Share revoked while sharee is online
- **WHEN** a share DELETE event arrives on the `note_shares` Realtime channel
- **THEN** the corresponding note SHALL be removed from the shared notes list immediately

#### Scenario: Note content updated while sharee is online
- **WHEN** an UPDATE event arrives on the notes content Realtime channel for a note ID in the sharee's shared set
- **THEN** the note card in the list SHALL update its title and preview to reflect the new content

#### Scenario: Content channel recreated after share-set change
- **WHEN** the set of note IDs shared with the user changes (a share is added or removed)
- **THEN** the notes content Realtime channel SHALL be torn down and recreated with the updated ID filter to ensure all relevant updates are received

---

### Requirement: Shared documents list updates in real time
The shared documents list SHALL stay current without a page reload when share membership or document content changes.

#### Scenario: New share appears while sharee is online
- **WHEN** a share INSERT event arrives on the `document_shares` Realtime channel
- **THEN** the new document SHALL be fetched and inserted into the shared documents list

#### Scenario: Share revoked while sharee is online
- **WHEN** a share DELETE event arrives on the `document_shares` Realtime channel
- **THEN** the corresponding document SHALL be removed from the shared documents list immediately

#### Scenario: Document content updated while sharee is online
- **WHEN** an UPDATE event arrives on the documents content Realtime channel for a document ID in the sharee's shared set
- **THEN** the document card in the list SHALL update its title to reflect the new value

---

### Requirement: Owner attribution is displayed for shared content
Every shared note and document displayed to a sharee SHALL show the owner's identity.

#### Scenario: Owner name displayed on shared note card
- **WHEN** a shared note is displayed in the sharee's list
- **THEN** the owner's `full_name` (from `public.users`) and avatar SHALL be displayed alongside the note card

#### Scenario: Owner name displayed on shared document card
- **WHEN** a shared document is displayed in the sharee's list
- **THEN** the owner's `full_name` and avatar SHALL be displayed alongside the document card

---

### Requirement: Shared content is isolated to the "Shared with me" view
Notes and documents shared with the authenticated user SHALL appear exclusively in the dedicated "Shared with me" tab. They SHALL NOT appear in the user's main notes list, archive view, search results, or tag/filter views.

#### Scenario: Shared notes do not appear in main notes list or search
- **WHEN** the authenticated user views their main notes list or performs a search
- **THEN** notes where `note_shares.shared_with_user_id = current_user_id` SHALL NOT be included in the results
- **THEN** shared notes SHALL only be accessible via the "Shared with me" tab

#### Scenario: Shared documents do not appear in main documents list
- **WHEN** the authenticated user views their main documents list
- **THEN** documents where `document_shares.shared_with_user_id = current_user_id` SHALL NOT be included
- **THEN** shared documents SHALL only be accessible via the "Shared with me" section
