## Context

The app is a React + Supabase fullstack application with two content types: **notes** (short Markdown notes with pinning, archiving, tagging, and attachments) and **documents** (long-form Markdown with Yjs-based real-time collaborative editing). Both content types have sharing infrastructure already deployed to the database (`note_shares`, `document_shares`, `share_permission` enum, `get_user_id_by_email` RPC), and the frontend hooks and components are already implemented.

This change produces the specification that formally describes how all sharing features work, establishing a contract for validating correctness, guiding future changes, and onboarding contributors.

## Goals / Non-Goals

**Goals:**
- Produce verified specs for all four sharing-related capabilities: `note-sharing`, `document-sharing`, `shared-content-browsing`, and `user-lookup`
- Document real-time channel strategy, permission boundaries, and security model
- Establish clear owner vs. sharee capability boundaries for each content type
- Surface any gaps between the implemented code and the intended behavior so they can be tracked as tasks

**Non-Goals:**
- Re-implementing or refactoring any existing code (this is a spec pass, not a code change)
- Adding new sharing features (e.g., public links, team/org-level sharing, expiring shares)
- Changing the database schema (all migrations are already applied)
- Adding full-text search to shared content views

## Decisions

### Decision 1 — Four separate capability specs

**Choice:** Split into `note-sharing`, `document-sharing`, `shared-content-browsing`, and `user-lookup`.

**Rationale:** Notes and documents have meaningfully different ownership rules (notes have pin/archive/tags/attachments that are owner-only; documents have Yjs collaborative editing for edit-permission sharees). A single monolithic spec would conflate these differences. `shared-content-browsing` and `user-lookup` are cross-cutting concerns worth isolating.

**Alternative considered:** One `content-sharing` spec. Rejected because it would produce an unreadably large spec and make capability-level task generation noisy.

---

### Decision 2 — Permission model: `view` | `edit` enum, not RBAC

**Choice:** Use the existing `share_permission` enum (`view`, `edit`) as the authoritative permission vocabulary.

**Rationale:** The two-tier model covers all current use cases. The enum is database-enforced, preventing invalid values at the constraint level. Adding future tiers (e.g., `comment`) requires a standalone migration (`ALTER TYPE … ADD VALUE` cannot run in a transaction), which is a deliberate friction point ensuring migrations are intentional.

**Alternative considered:** A bitmask or numeric permission level. Rejected because it loses readability and requires application-layer decoding rather than database-enforced constraints.

---

### Decision 3 — Email-based share creation via security-definer RPC

**Choice:** Use `get_user_id_by_email(p_email)` RPC to resolve a typed email to a UUID, rather than allowing direct `SELECT` on `public.users`.

**Rationale:** Exposing `public.users.email` to arbitrary authenticated queries would allow any user to enumerate the entire user base. The security-definer RPC returns only the `{id, full_name}` of the exact matching row, leaking no additional data.

**Alternative considered:** Allowing sharees to be set by UUID (copied from a profile URL). Rejected because it is user-hostile; email is the natural identifier users know.

---

### Decision 4 — Realtime channel strategy: two channels per sharee view

**Choice:** The sharee's list view subscribes to two Supabase Realtime channels: (1) the `_shares` table channel (INSERT/UPDATE/DELETE on share rows) and (2) a content channel filtered to the currently-shared item IDs (UPDATE on the content rows).

**Rationale:** Separating the "membership" channel from the "content" channel means content updates don't trigger share-set refetches, and share revocations can cleanly remove items from the list without requiring a full content reload. The content channel must be recreated when the share set changes (new IDs to subscribe to), which is handled by tracking `allSharedIds` as a sorted comma-separated string dependency.

**Alternative considered:** Single channel with broad filters. Rejected because Supabase Realtime filter expressions have limited `IN`-list support; two focused channels are simpler and more reliable.

---

### Decision 5 — Yjs state persistence for document sharing

**Choice:** Persist the Yjs CRDT state in `documents.yjs_state` (bytea) alongside the plain-text `body` column. Sharees with `edit` permission join the same Supabase Broadcast channel as the owner and participate in Yjs sync.

**Rationale:** The `SupabaseBroadcastProvider` handles ephemeral peer-to-peer Yjs sync. Without persisted state, a sharee opening a document when no peers are online would start from empty. The `yjs_state` column provides the initial state so solo editing is always possible. The `body` column is kept as a plain-text export for search, preview, and `view`-permission rendering.

**Alternative considered:** Derive document body from Yjs on every read. Rejected because `view`-permission sharees and the shared documents list only need plain text; parsing Yjs on every read adds unnecessary cost.

## Risks / Trade-offs

- **Channel recreation cost on share-set change** → Every time a share is granted or revoked, the content Realtime channel must be torn down and recreated with the new ID set. This is a brief reconnect (~100–200ms) that is invisible to users in practice, but worth noting in the spec as expected behavior.
- **`get_user_id_by_email` timing oracle** → The RPC confirms whether an email has an account. A determined attacker could use share attempts to enumerate registered emails. Mitigation: the RPC is already rate-limited by Supabase Auth's API gateway, and the information leaked (account existence) is low-sensitivity for this app type. A CAPTCHA or rate-limit on the share endpoint could be added if this becomes a concern.
- **`note_shares` REPLICA IDENTITY FULL requirement** → DELETE events on `note_shares` only include changed columns if `REPLICA IDENTITY FULL` is set. If this is not set, the sharee's realtime channel cannot identify which share was removed. The migration should document this requirement explicitly. Current implementation already handles this (migration `20260403000001`).
- **Self-share prevention relies on DB trigger** → The `prevent_self_share` and `prevent_document_self_share` CHECK constraints fire at the database level. If the frontend bypasses the hooks and writes directly, the constraint still protects correctness. The spec should document both the client-side guard and the DB constraint as defense-in-depth.

## Migration Plan

This is a specification-only change — no new migrations, no new frontend code. The spec validates existing behavior.

1. Create specs for all four capabilities
2. Generate implementation tasks that identify any gaps between spec and current code
3. Apply gap-fix tasks (if any) as follow-on patches

Rollback: Not applicable — spec files are additive and do not affect runtime behavior.

## Open Questions

- Should `view`-permission sharees for notes be able to see the note's attachment list (read-only)? The migration comment says attachment uploads are owner-only, but read access is unspecified.
- Should shared notes/documents appear in the sharee's search/filter results, or only in the dedicated "Shared with me" list view?
- What happens to a share row when the sharee deletes their account? (The FK is `ON DELETE CASCADE` on `public.users`, so the share row is automatically removed — but should the owner be notified?)
