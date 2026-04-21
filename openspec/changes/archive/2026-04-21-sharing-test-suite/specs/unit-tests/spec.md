## ADDED Requirements

### Requirement: yjs-encoding round-trips correctly
The `uint8ArrayToBase64` / `base64ToUint8Array` and `uint8ArrayToHex` / `hexToUint8Array` functions SHALL be lossless inverses of each other.

#### Scenario: Base64 encode then decode returns original bytes
- **WHEN** a `Uint8Array` of arbitrary bytes is encoded to base64 then decoded
- **THEN** the result SHALL be byte-for-byte identical to the original array

#### Scenario: Hex encode then decode returns original bytes
- **WHEN** a `Uint8Array` is encoded to Postgres hex format (`\x...`) then decoded
- **THEN** the result SHALL be byte-for-byte identical to the original array

---

### Requirement: SupabaseBroadcastProvider marks synced after peer response
When a peer responds with `yjs-state-response`, the provider SHALL apply the state to the Yjs document and mark itself as synced.

#### Scenario: Provider syncs on yjs-state-response
- **WHEN** the channel fires a `yjs-state-response` broadcast event with a valid encoded Yjs state
- **THEN** `provider.synced` SHALL be `true`
- **THEN** `onSynced` callbacks SHALL have been called with `true`
- **THEN** the Yjs doc SHALL contain the state from the response

---

### Requirement: SupabaseBroadcastProvider marks synced after timeout with no peers
If no peer responds within `SYNC_TIMEOUT_MS`, the provider SHALL mark itself synced (solo mode).

#### Scenario: Provider self-syncs after 500ms timeout
- **WHEN** the channel subscribes successfully and no `yjs-state-response` arrives within 500ms
- **THEN** `provider.synced` SHALL be `true` after `vi.advanceTimersByTime(600)` with fake timers

---

### Requirement: SupabaseBroadcastProvider broadcasts local Yjs updates
Local Yjs document changes SHALL be broadcast to peers; updates received from peers SHALL NOT be re-broadcast.

#### Scenario: Local edit is broadcast
- **WHEN** a local change is applied to the Yjs doc (non-'broadcast' origin)
- **THEN** the channel's `send` method SHALL be called with event `yjs-update`

#### Scenario: Remote update is not re-broadcast
- **WHEN** a `yjs-update` event is received from the channel (origin = 'broadcast')
- **THEN** the channel's `send` method SHALL NOT be called

---

### Requirement: shareByEmail normalizes email before calling the RPC
The `shareByEmail` function in `useShares` and `useDocumentShares` SHALL trim whitespace and convert to lowercase before passing the email to `get_user_id_by_email`.

#### Scenario: Email with leading/trailing spaces is normalized
- **WHEN** `shareByEmail` is called with `"  Alice@Example.COM  "`
- **THEN** the RPC SHALL be called with `"alice@example.com"`

---

### Requirement: shareByEmail maps database error codes to user-facing messages
The `shareByEmail` function SHALL translate `23505` (unique violation) and `23514` (check violation) to specific human-readable strings.

#### Scenario: 23505 maps to duplicate share message
- **WHEN** the insert returns an error with `code: '23505'`
- **THEN** `shareByEmail` SHALL return `"This note is already shared with that user."`

#### Scenario: 23514 maps to self-share message
- **WHEN** the insert returns an error with `code: '23514'`
- **THEN** `shareByEmail` SHALL return `"You cannot share a note with yourself."`
