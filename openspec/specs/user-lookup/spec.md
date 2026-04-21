## ADDED Requirements

### Requirement: System resolves a registered user by email via secure RPC
The system SHALL provide a mechanism to resolve a typed email address to the corresponding user's UUID without exposing the full `public.users` table to arbitrary authenticated queries.

#### Scenario: Email resolves to a registered user
- **WHEN** the `get_user_id_by_email` RPC is called with a valid, normalized (trimmed, lowercased) email address that matches a row in `public.users`
- **THEN** the RPC SHALL return exactly one row containing the matching user's `id` (UUID) and `full_name`
- **THEN** no other user's data SHALL be included in the response

#### Scenario: Email does not match any registered user
- **WHEN** the `get_user_id_by_email` RPC is called with an email that does not match any row in `public.users`
- **THEN** the RPC SHALL return an empty result set (zero rows)
- **THEN** the calling code SHALL treat the empty result as "no account found" and display an appropriate user-facing error

#### Scenario: Email input is normalized before lookup
- **WHEN** the user enters an email with leading/trailing whitespace or uppercase letters
- **THEN** the calling code SHALL normalize the email (trim whitespace, convert to lowercase) before passing it to the RPC
- **THEN** the lookup SHALL succeed for emails that differ only in case or surrounding whitespace

#### Scenario: RPC is not callable as a direct table query
- **WHEN** any authenticated user attempts to SELECT from `public.users` to look up another user's email
- **THEN** the RLS policy SHALL deny access (no `users_select_any` policy exists)
- **THEN** only the security-definer RPC SHALL provide cross-user email lookup

#### Scenario: RPC uses security-definer with fixed search_path
- **WHEN** the RPC executes
- **THEN** it SHALL run with `SECURITY DEFINER` and `SET search_path = ''` to prevent search-path injection
- **THEN** it SHALL reference tables with fully qualified names (e.g., `public.users`)
