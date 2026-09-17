# Next steps

## Scheduled content updates — deferred

Goal: check the private shared document daily or weekly, update the exercise
library when relevant content changes, validate it, and publish to private
Firestore. Content updates do not need a Hosting deployment or app reinstall.

Status: a task prompt is prepared locally in `.private/content-sync-task.md`.
No schedule is active. This private file is intentionally absent from GitHub.

- [ ] Recheck the personal Google Drive connection and verify a complete document
  read. The last connector attempts returned service/tool errors; account access
  has not yet been verified after reconnection.
- [ ] Choose the cadence and time. Weekly Monday at 9 AM America/Los_Angeles was
  suggested, but the schedule has not been selected or activated.
- [ ] Run the prepared prompt manually once. Verify both the no-change path and
  the validation/publication path before relying on unattended runs.
- [ ] Create the task in the desktop app's Scheduled interface, using this local
  project so it can access ignored `.private/` files. Scheduling tools and desktop
  control were unavailable in the prior session.
- [ ] Verify unattended Drive reads and the existing private publication command
  have the required access. Local runs need the computer awake and the app running.
- [ ] Confirm source revision/hash tracking, backup creation, conflict detection,
  and successful publication readback. These are instructions in the prepared
  prompt, not a separately implemented background service.
- [ ] Inspect the first scheduled results. Ambiguous changes or failed checks must
  leave the published library intact and report the issue for review.

Content workflow: read the document → compare → prepare a private candidate →
validate → publish with `npm run publish:library` → verify and record the revision.
Preserve exercise IDs and practice history. Never publish source notes to GitHub,
Hosting, public logs or artifacts. Scheduled content work must not commit code,
release unrelated UI changes, change sharing permissions or send messages.
