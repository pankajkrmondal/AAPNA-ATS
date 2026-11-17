# U10c · Responded per open position (13 Nov 2026)

**Feedback:** owner, 13 Nov: "the analytics is not per open position's". **Brief:** [U10c](../Phase%204/uat-fixes/U10c-responded-per-position.md). Builds on [U10b](CHANGES-2026-11-12-U10b-responded-view.md).

- **Endpoint** `GET /api/pipeline/analytics/completed-forms` takes `mrf=<id>`. It narrows the answer to that MRF, whatever its status, without "No JD yet"; the response adds `mrf_id`. Without `mrf` nothing changes, and the 09:00 bell job is unchanged.
- **Role view** (`?tab=open&mrf=<id>`): a new **Responded** section after Needs attention. It has the same Yesterday / Today / Last 7 days / custom dates as Open Positions › Responded, and lists the position's candidates newest first, with when and how they responded and a Profile link. Its count equals the position's Responded column for the same dates.
- **Open Positions › Responded:** each JD has a **Role view →** link. The role view opens on the same dates.
- **Tests:** unit `completedForms.test.js` 34/34; Playwright `u10b-responded-view.spec.js` 9/9 (mocked API); `npm run build`.
