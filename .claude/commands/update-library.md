---
description: After a therapy session, pull the ND Activities doc, add the new activity to the private library, validate and publish it to Firestore.
---

Update the private exercise library from the therapist's document. Work only inside
`.private/` for content; never write any of it into tracked files, commit messages, or output
beyond short summaries. Do not deploy hosting and do not commit unless I ask.

Extra context from me: $ARGUMENTS

Steps:

1. Run `npm run fetch:source`. If it says the gcloud login cannot read Drive, stop and show me
   the one-line login command it prints. If it says no change since the last fetch and I gave no
   extra context, stop and tell me.
2. Read `.private/source/ND_Activities-latest.txt` and, if present,
   `.private/source/ND_Activities-previous.txt`. Work out what is new or changed. If there is
   no previous copy, compare the document against `.private/library.json` instead.
3. Read `CLAUDE.md` (App conventions) and `public/data/exercises.schema.json`. Then edit
   `.private/library.json`:
   - Add each new activity as new `exercises` entries and one new last entry in `weeks`
     (`label: "Activity #N"`, no `startDate` unless the document gives one).
   - Reuse existing exercise ids where an activity repeats an earlier one. Never rename or
     delete existing ids; practice history points at them.
   - Prompts and answers that come from the document keep the default source. Anything you
     write to extend the set gets `source: "self"`; answers you write for blanks in the
     worksheet get `answerSource: "self"`.
   - Copy the therapist's wording for instructions; keep it in the second person.
   - If something in the document is ambiguous (order, which items are examples, what an
     exercise's mode should be), ask me before publishing rather than guessing.
4. Run `npm run validate -- .private/library.json` and `npm run check`. Fix problems.
5. Back up the current library to `.private/content-sync/library-<date>.json`, then run
   `npm run publish:library`. Treat it as done only when the script confirms the read-back.
6. Report in a few lines: what activity was added or changed, counts of exercises and prompts
   added, and anything I should confirm. Remind me the phone picks it up on next open.
