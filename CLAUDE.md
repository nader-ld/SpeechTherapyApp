# Project instructions

Speech Practice is a dependency-free HTML/CSS/JavaScript PWA hosted on Firebase.
The repository is public. Private documents and therapy content must stay out of
all commits and their history, and out of the public Hosting directory.

- Keep private originals under ignored `source/` or `.private/`.
- The exercise library is `.private/library.json`, published with
  `npm run publish:library` to owner-only Firestore `private/library`.
- The shared Google Doc link belongs only in ignored `.private/source.json` and
  the protected Firestore document. Never put its ID or content into public code.
- `public/data/exercises.json` is deliberately absent. Do not restore or precache it.
- Deployment-specific Firebase config and rules are ignored; templates are tracked.
- Authentication uses email/password with verified email and owner-only rules.
- Tests use invented fixtures. Run `npm run check` before committing.
- Bump the service-worker version whenever shell files change.
- Preserve concurrent uncommitted UI work. Stage only the requested changes.
- No framework, bundler or npm dependencies. Firebase SDK is pinned and loaded from CDN.
- Recordings stay in memory. Storage failures must retain the user's input.
- Hosting is enabled; the login page is public, data access is enforced by rules.
- Old Git history is backed up locally under `.private/` and must never be pushed.
