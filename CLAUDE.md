# Project instructions

Speech Practice is a dependency-free HTML/CSS/JavaScript PWA hosted on Firebase.
The repository is public. Private documents and therapy content must stay out of
all commits and their history, and out of the public Hosting directory.

- Keep private originals under ignored `source/` or `.private/`.
- The exercise library is `.private/library.json`, published with
  `npm run publish:library` to owner-only Firestore `private/library`.
- Content update after a therapy session: the `/update-library` project command
  (`.claude/commands/update-library.md`). It runs `npm run fetch:source`, which
  exports the Google Doc through the Gmail gcloud login (needs a one-time
  `gcloud auth login <gmail> --enable-gdrive-access`), diffs, edits the private
  library, validates and publishes. No hosting deploy is needed for content.
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

## App conventions

- Mobile first (~390px wide), large tap targets, works in light and dark.
- Look and feel follows Google's Material style (like the Firebase console):
  colour tokens at the top of `public/css/app.css`, Google blue primary, tonal
  containers, pill buttons, a navigation bar with an active-indicator pill,
  Material SVG icons inline in `public/index.html`. Keep new UI inside that
  system. The app icon is regenerated with `npm run icons` (pure Python).
- Library schema is `public/data/exercises.schema.json`. Exercise `mode` is
  `items`, `timed` (`durationSec`) or `reps` (`targetReps`). `itemTimerSec` /
  `timerSec` add a per-prompt countdown; `answer` is revealed on tap and
  `answerSource: "self"` marks answers written for the app rather than taken
  from the therapist's worksheet. `weeks` are oldest first; the last started
  one is "current". Item `source: "self"` marks self-made extra prompts.
- Screenshots: headless Chrome writes the PNG then hangs, so wrap it in
  `perl -e 'alarm 30; exec @ARGV' --`, and frame the page in a 390px iframe
  because Chrome's minimum window is wider. Stub `js/cloud.js` in a copy of
  `public/` (call `onUser` with a fake user and seed the store) to get past
  sign-in; the library can come from `tests/fixtures/exercises.json`.
