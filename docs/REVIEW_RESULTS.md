# Review results

Authentication, storage, synchronization, offline caching, imports and recording
lifecycle were reviewed. Regression fixes cover stale sign-out callbacks, partial
import syncing, prompt identifier collisions, permission failures and offline batches.

## Public-repository privacy follow-up

- Source PDFs and transcribed personal content are kept locally in ignored paths.
- The public repository uses invented fixtures and clean history.
- The exercise library and source-document link are stored in owner-only Firestore.
- Public Hosting no longer serves the exercise JSON; the service worker removes old
  caches and blocks the previous JSON URL. Previously downloaded copies cannot be
  remotely erased from browsers that never load the update.
- The source link opens the current private Google Doc using Google's own access
  checks. Structured exercise updates are reviewed and explicitly published.
- Deployment-specific identities and configuration are excluded from public Git.

Automated tests exercise the auth/sync adapter with mocks. Real authenticated
cross-device sync and physical iPhone recording/playback still require owner testing.
