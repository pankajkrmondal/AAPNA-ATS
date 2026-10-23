# PW-Task: MRF Hold, on-behalf decisions and the HR Admin Recruiter role

Playwright test plans and results for the work in
[MRF-Hold-and-Delegate-Approval-Plan.md](../MRF-Hold-and-Delegate-Approval-Plan.md) and
[HR-Admin-Recruiter-Role-Impact.md](../HR-Admin-Recruiter-Role-Impact.md).

How these files are used:

- One file per task: the test plan, the test cases, then a **results log** that only grows.
- After each build task: run the cases in the Playwright browser on **staging**, fix what fails, and retest until clean.
- Log every run with its date, PASS / FAIL / BLOCKED and the fix made. **Never delete** a plan, a case or a past run.
- Screenshots go in `screenshots/`, named `<task>-<case>-<what>.png`.
- Log in with the accounts given in chat at test time. Credentials are never written here.
- Test data: only `ZZ-TEST`-named MRFs and `PHASE3-TESTPASS-FIXTURE`-tagged candidates. **Never change MRF 137** (it carries real candidates).

| Task | File | Covers | Status |
|---|---|---|---|
| R1 | [R1-HR-Admin-Recruiter-role-regression.md](R1-HR-Admin-Recruiter-role-regression.md) | New role; Chhaya keeps every Recruiter function across all modules | **Run 1 PASS (22 Oct)**; Chhaya spot-check pending deploy |
| H1 | [H1-DDL-settings-flags.md](H1-DDL-settings-flags.md) | Hold columns, CHECK widening, settings keys, flags, rules | **Run 1 PASS (22 Oct)** |
| H2 | [H2-Hold-via-email-link.md](H2-Hold-via-email-link.md) | Approver page Approve / Reject / Hold, old-link messages | **Run 1 PASS** (1 UI fix) |
| H3 | [H3-Hold-release-sweep.md](H3-Hold-release-sweep.md) | Hold-until date → Pending → new email to both approvers (**done-when**) | **Run 1 PASS**; run 2 (23 Oct) H3-07 PASS in the browser |
| E1 | [E1-Editable-hold-email-templates.md](E1-Editable-hold-email-templates.md) | The 4 hold / on-behalf notices editable under Email Templates | **Run 1 PASS (23 Oct)** |
| H4 | [H4-Settings-card-held-MRFs.md](H4-Settings-card-held-MRFs.md) | List badge/tab, details banner, change date, release now, Settings card | **Run 1 PASS** (1 cosmetic fix) |
| H5 | [H5-Decide-on-behalf.md](H5-Decide-on-behalf.md) | On-behalf panel: window on/off, per role | **Run 1 PASS**; plain-Recruiter case needs an account |
| H6 | [H6-Regression-flags-off.md](H6-Regression-flags-off.md) | Both flags off | **Run 1 PASS** |
