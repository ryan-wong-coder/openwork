# Public device approval after the PWA hotfix

The single approved public HTTPS run passed on 2026-10-20, starting at 08:43:16 UTC. It used one operator-owned synthetic invitation/account and a fresh headless Chrome 155.0.8059.85 profile. [Report](report.json).

The actual public `/app/device` HTML matched the reviewed hotfix index SHA-256 `33a3b317539c456f01a7bbf63608cc2dffa8e5a5f5b855cf9b6c7917d71f3e0e`, with the original strict CSP. The account was registered through the real invitation form. Tab A held the real record-writer lease. Tab B opened a newly generated device authorization link: the code was correctly prefilled, and approval was enabled while the calendar and preferences remained locked.

A trusted CDP mouse click on “同意连接” approved the pending request. The real PKCE token exchange then succeeded; the device `/me` identity matched the browser account, the device appeared in the server-backed device list, and the device credential could read its owner's sync endpoint. Tab A retained its record-writer lease. No personal record mutation, administrator action or model request was made. Observed renderer exceptions, CSP violations, blocked requests and external page requests were zero; this is CDP/DNS observation, not system packet capture.

The [success screenshot](second-tab-approved.png) was actually viewed and its size/SHA-256 independently verified. Only the synthetic account identifier was redacted to “合成账号”; the authorization input was already empty after success. No invitation token, authorization code, password or device credential appears in public evidence.

The owned Chrome process and temporary profile were removed. Exact synthetic account/device/authorization cleanup identity was delivered privately to the release operator; server-side cleanup requires its separate receipt. This validates the public browser approval and service protocol, not an installed native desktop pairing session, OS credential storage, or the user's own account. The frozen 1.1.1 installer source/tag and API/database schemas were unchanged by this PWA-only hotfix.

The operator subsequently completed the exact [synthetic cleanup](../cleanup.json):
one account, its invitation, authorization and device were removed after a
private consistent SQLite backup. Other accounts and administrators were
preserved, the foreign-key check passed, and no business record or media
deletion was needed. The original QA report retains its handoff-time scope.
