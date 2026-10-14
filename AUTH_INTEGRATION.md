# VRiichi! authentication integration notes

**Status: development only; do not enable online purchases or valuable inventory yet.**

## Confirmed components
- Browser portal: Cloudflare Pages at https://vriichi-auth.pages.dev
- Browser Mahjong game: itch.io (separate origin / iframe)
- Supabase Auth: Google sign-in, profile trigger, public.profiles
- itch.io OAuth: authorization-code with PKCE, identity verification, a tested link to a profile
- Cloudflare Pages API: `/api/session` reads server-side game sessions, but **there is no production session issuer yet**.
- Supabase SQL objects built manually: `player_identities`, `itch_oauth_attempts`, `game_sessions`, `session_handoffs`, RPC functions `consume_itch_link_ticket` and `consume_session_handoff`.
- Supabase Edge Functions deployed outside this repository: `itch-start`, `itch-callback`, `itch-link-prepare`, `itch-link-launch`. **Their deployed code must be exported/reviewed before coordinated edits.**

## Known boundary
A Google Supabase session is NOT interchangeable with an itch.io OAuth token or a VRiichi! game session. The portal's cookies are first-party only on the portal domain; the embedded itch.io game should not assume they will be sent inside an iframe. `session_handoffs` being single-use does not make it browser-bound by itself.

## Before enabling standalone itch.io login
1. Preserve existing Google sign-in and linked accounts; export/inspect deployed Supabase Edge Function code.
2. Agree on an end-to-end threat model for the OAuth start, callback, one-time handoff, and game session. Verify browser-binding, origin restrictions, PKCE/state, replay defense, race/conflict checks, expirations, logout/revocation, and how new itch.io users register without an existing Google profile.
3. Implement server-side account lookup and session issuance only after itch.io token verification; store only SHA-256 hashes of 32-byte session tokens in `game_sessions`. Never put long-lived credentials or access tokens in callback query strings.
4. Bind the one-time login handoff to the originating browser before redeeming it. Avoid relying on third-party cookies in the itch.io iframe. Test on actual itch.io embedded browser deployment.
5. Ensure every privileged API action (mailbox rewards, purchases, gacha) validates the same session and uses server-authoritative, transactional changes.
6. Add rate limiting, secure logging without credentials, monitoring, migrations/backups, and test cases for unauthorized, expired, forged, replayed, and concurrently redeemed credentials.
7. Run a security review before accepting payments.

## Existing public endpoints
- `GET /api/health` is only a generic liveness check. A 200 status is **not authentication**.
- `GET /api/session` verifies an existing game-session cookie and returns 401 when none exists. It **does not** create sessions.

## Secret hygiene
The GitHub repository is public. Only client-side public publishable keys should appear in browser source. Keep `SUPABASE_SECRET_KEY` exclusively in Cloudflare Pages server-side encrypted secrets and Supabase service-role keys exclusively on trusted backends. Never echo secret values in endpoint responses.
