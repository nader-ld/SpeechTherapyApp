# Speech Practice

An installable speech-practice web app with email/password authentication,
private exercise libraries, recording/playback, timers, custom prompts, and a
synced practice log. Plain HTML, CSS and JavaScript; no build step or npm dependencies.

## Public code, private content

This repository contains application code and invented test fixtures. It must
not contain therapy notes, source documents, personal exercise content, document
links, exports, or recordings, including in Git history.

The live application reads its library from `private/library` in Firestore only
after a verified, allowed account signs in. Firestore rules protect this data.
The public app shell contains no exercise library. The SDK may cache authorized
data on a signed-in device for offline use; shared devices should be treated accordingly.
Audio recordings are held in memory and are not uploaded.

## Local setup

1. Copy `.firebaserc.example` to `.firebaserc` and select your Firebase project.
2. Copy `public/js/firebase-config.example.js` to `public/js/firebase-config.js`
   and fill in the Firebase web configuration and allowed email.
3. Copy `firestore.rules.example` to `firestore.rules` and set the same allowed
   email. The real configuration files are ignored by Git.
4. Enable Firebase email/password authentication and create a Firestore database.
5. Keep source documents in ignored `source/` or `.private/`. Put the structured
   library in `.private/library.json`. It follows `public/data/exercises.schema.json`.
6. Create ignored `.private/source.json`:

```json
{
  "project": "YOUR_PROJECT",
  "account": "YOUR_ADMIN_ACCOUNT",
  "documentUrl": ""
}
```

`documentUrl` may be a private Google Docs edit link. It is stored with the
protected library and displayed in Settings only after sign-in. Leave it blank
if no document is linked. Never publish the Google Doc or relax its sharing settings.

```bash
npm run check
npm run dev
npm run validate -- .private/library.json
npm run deploy:rules
npm run publish:library
npm run deploy
```

Publishing uses the named account's existing `gcloud` credentials. It validates
and writes the library and source link directly to Firestore, without creating
Hosting files. Browser clients can read the protected library but cannot overwrite it.
The publishing script does not upload original PDFs or edit the shared document.

## Updating a shared document

A cloud document cannot be represented by a useful filesystem symlink in Git.
Keep the original Google Doc private. The Settings link opens its current version
with Google's own access checks, so edits are visible there immediately.

The structured exercise library is a reviewed snapshot. After the document changes,
read it using an authorized account, update `.private/library.json`, validate it,
and run `npm run publish:library`. Signed-in apps receive the new library through
Firestore. This does **not** automatically interpret or convert free-form notes
into exercises; review changes before publishing them. No Hosting deploy is needed
for library updates.

## Using the app

Create an account or sign in with email/password, verify the email, and return to
the app. Rules restrict access to the configured owner. Password reset is available.
On iPhone, open in Safari and use Share → Add to Home Screen. On Android, use
Chrome's install option. The first sign-in and first library load need a connection.

## Commands and layout

- `npm run check`: syntax checks, synthetic fixture validation, and tests.
- `npm run validate -- PATH`: validate a private library without publishing it.
- `npm run publish:library`: publish the ignored local library to private Firestore.
- `npm run deploy`: checks, then deploys Hosting and Firestore rules.
- `npm run preview`: Firebase Hosting emulator.

`public/js/cloud-client.js` handles auth and sync; `store.js` holds application
state and local mirrors; `recorder.js` handles audio; `app.js` contains views.
`public/sw.js` caches only the public shell and Firebase SDK, never source notes.
Tests use `tests/fixtures/exercises.json`, which contains invented examples.

Before pushing, inspect the staged files and history. Ignoring a file does not
remove its contents from earlier commits. Never push a backup bundle or old branch
that contains private source materials.
