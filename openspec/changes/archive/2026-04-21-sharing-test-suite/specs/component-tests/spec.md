## ADDED Requirements

### Requirement: NoteEditor hides owner-only controls for sharees
When `sharePermission` is non-null (the note is shared), `NoteEditor` SHALL hide pin, archive, tag management, delete, and attachment controls.

#### Scenario: Attachment section hidden when sharePermission is set
- **WHEN** `NoteEditor` renders with `sharePermission="edit"`
- **THEN** the "Attach file" button SHALL NOT be in the document

#### Scenario: Attachment section visible for note owner
- **WHEN** `NoteEditor` renders with `sharePermission={null}`
- **THEN** the "Attach file" button SHALL be in the document

---

### Requirement: NoteCard shows edit button only for owner or edit-permission sharee
The edit/open action on a `NoteCard` SHALL only be available when the viewer is the owner or has `edit` permission.

#### Scenario: Edit action present for owner
- **WHEN** `NoteCard` renders with `isOwner={true}` and `sharePermission={null}`
- **THEN** the edit/open action SHALL be present

#### Scenario: Edit action present for edit-permission sharee
- **WHEN** `NoteCard` renders with `isOwner={false}` and `sharePermission="edit"`
- **THEN** the edit/open action SHALL be present

#### Scenario: No edit action for view-permission sharee
- **WHEN** `NoteCard` renders with `isOwner={false}` and `sharePermission="view"`
- **THEN** the edit/open action SHALL NOT trigger a meaningful handler (onEdit is a no-op)

---

### Requirement: NoteCard shows owner attribution for shared notes
When a note is shared (sharePermission is non-null), `NoteCard` SHALL display the owner's name.

#### Scenario: Owner name displayed on shared note card
- **WHEN** `NoteCard` renders with `sharePermission="view"` and `ownerName="Alice Smith"`
- **THEN** the text "Alice Smith" SHALL be in the document

#### Scenario: Owner name not shown on own note
- **WHEN** `NoteCard` renders with `sharePermission={null}` and `ownerName={null}`
- **THEN** no attribution byline SHALL be rendered

---

### Requirement: DocumentEditor hides delete for non-owners
The delete action in `DocumentEditor` SHALL only be available to the document owner, never to a sharee regardless of permission level.

#### Scenario: Delete hidden for edit-permission sharee
- **WHEN** `DocumentEditor` renders for a user who is not the owner (`canEdit=true`, `isOwner=false`)
- **THEN** no delete button or destructive action SHALL be visible

#### Scenario: Delete visible for owner
- **WHEN** `DocumentEditor` renders for the document owner (`isOwner=true`)
- **THEN** the delete action SHALL be present

---

### Requirement: DocumentEditor shows read-only preview for view-permission sharees
When `sharePermission` is `"view"`, the `DocumentEditor` SHALL render the Markdown preview and hide the live editor.

#### Scenario: Read-only markdown rendered for view-permission sharee
- **WHEN** `DocumentEditor` renders with `sharePermission="view"` (canEdit=false)
- **THEN** the markdown preview SHALL be visible
- **THEN** the textarea/editor input SHALL NOT be present
