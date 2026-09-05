# Local speed and optional accounts · September 5, 2026

Paul authorized the recommended native performance slice and asked us to select and implement an appropriate signup gate.

## Product decision

Offer **Save this walk across devices** after a useful route exists. The Saved walks menu also lets returning members sign in. Planning, walking, locally resuming a route, viewing evidence and sending feedback do not require signup. Dismissing signup continues the current walk unchanged. No automatic signup prompt or trip upload occurs.

Accounts use native AuthenticationServices passkeys on iOS and WebAuthn on the web. No paid auth vendor, email delivery, password database or new application secret is required. A name labels the account; it is not a verified real-world identity. Users must keep access to their password-manager passkey or add another passkey; there is no email/password reset. An additional passkey and account deletion require fresh sign-in. Passkey verification uses the pinned SimpleWebAuthn server package rather than custom cryptography.

Explicitly saved walks contain a name, start/destination, optional stop and avoidance preferences. They are private to the account. Opening a saved walk fills the planner and asks the person to create a fresh route; it does not treat old conditions as current. The route polyline, recent searches and walking progress are not automatically synced. Up to 30 saved walks and five passkeys per account. Users can remove walks, sign out, add a passkey and delete their account from either client. Account deletion cascades through credentials, sessions and synced walks. Anonymous feedback and public observations are separate and not linked.

## Native performance

`LocalStore` serializes bounded versioned JSON files off the UI actor in protected Application Support storage excluded from backups. Map snapshots expire after seven days; active walks are restored only when planned within two days; the up-to-twelve recent-address list expires after thirty days without updates. Expired/corrupt files are discarded on read. Cache failure never prevents a network route. Saved data is restored before network refresh and marked with download time until refresh succeeds. This preserves route instructions without guaranteeing offline MapKit base maps.

The active walk retains exact route geometry, alternatives, selected route, instructions, step index and its original planning time. Editing an endpoint invalidates the saved route; step indexes are clamped and route selection resets them. Backgrounding flushes state. Recent places appear immediately and selecting one bypasses geocoding; live current-location fixes are excluded from recent addresses. Clear recent addresses is available without signup.

Both modeled-condition selection and raw report clustering now run off the main actor, publish bounded marker arrays and discard superseded results. Screen rendering no longer repeatedly scans and sorts the full condition dataset. Optional raw reports load only when requested. No measured overall launch-speed multiplier is claimed; test timing is not a physical-device performance benchmark.

## Authentication and deployment details

Runtime `accounts.db` is outside Git in the existing DATA_DIR, WAL mode with restrictive file permissions. Only hashed 256-bit session/flow tokens are stored. Challenges expire after five minutes and are single-use. Registration/authentication enforce exact RP ID and origin, signatures, user verification and counters. Browser flows bind to a secure HttpOnly flow cookie; browser sessions are Secure, HttpOnly, SameSite=Strict and never returned to browser JavaScript. Native bearer tokens use Keychain, device-only accessibility. Sessions expire after thirty days. Mutations require expected browser Origin or explicit native requests, JSON, and the existing trusted-proxy-aware write limit. Saved-walk reads/deletes always scope by authenticated owner. Authentication failures do not print credentials.

Passkeys are bound to **curbnote.polyfeeds.dev**. The associated-domain capability belongs to `com.curbnote.app` and `.well-known/apple-app-site-association` authorizes `99US464DK4.com.curbnote.app`. Keep this host as an authentication surface when curbnote.xyz is purchased. Do not silently change the RP ID or PUBLIC_ORIGIN and strand existing passkeys; a domain move must explicitly preserve/route authentication and transfer pending saves across origins.

## Verification

- 72 web/backend tests pass, including actual cryptographic passkey signup/login, signature/origin/user-verification failures, flow binding, replay rejection, explicit-save consent, cross-account isolation, logout and deletion.
- A headless mobile Chromium test with a virtual authenticator passes signup → explicit save → logout → login → open saved walk → delete account. It uses isolated temporary data and no production users. Its screenshot was inspected.
- Fourteen native unit tests pass, including disk persistence/expiry/corruption, offline marker restore, route/step restoration, invalidation, recent-address bounds and existing API/model checks.
- Native UI tests pass address search → route → guide → optional signup gate → continue anonymously → terminate/relaunch → resume at step 2, plus double-tap zoom and single-marker detail behavior. Screenshots were inspected.
- Native Face ID/passkey creation on a physical phone remains an acceptance check; virtual-authenticator web verification does not replace it. Apple association delivery and signed entitlement are verified during release.

Sources: [Apple passkeys](https://developer.apple.com/documentation/authenticationservices/supporting-passkeys), [SimpleWebAuthn](https://simplewebauthn.dev/docs/packages/server), [Apple responsiveness](https://developer.apple.com/documentation/xcode/improving-app-responsiveness).

Publication results follow after final release checks.
