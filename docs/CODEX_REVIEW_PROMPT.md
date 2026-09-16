# Review prompt

Review the application code, authentication, private library access, offline
behavior, sync, imports, recording and deployment configuration. Read README.md
and CLAUDE.md first. Run `npm run check`.

The repository is public. Use synthetic test fixtures. Do not copy private
therapy notes, Google Doc IDs/links, PDFs or local deployment configuration into
review reports, tests or commits. Do not publish old local history.

Verify:

- Unauthenticated, unverified and wrong-account users cannot read private data.
- The exercise library and document link load only after verified sign-in.
- Source documents and exercise JSON are absent from Hosting and service-worker caches.
- Sign-out cannot be undone by stale auth or snapshot callbacks.
- Imports reject invalid records and preserve sync after a partial storage failure.
- Offline writes are queued; real cross-device behavior is distinguished from mocks.
- Delayed microphone permissions cannot start recording after practice ends.
- iPhone recording/playback and timer chimes receive a real-device test.
- Documentation describes the private document link and reviewed publishing workflow
  accurately: Google Doc changes are not automatically converted into exercises.
- Any UI work under active development remains separate from the requested commit.
