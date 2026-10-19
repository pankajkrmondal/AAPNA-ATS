# AAPNA ATS: system documentation

How the system works as a whole, for developers. User guides for HR, Admins, Super Admins and vendors are in [`../user-guides/`](../user-guides/README.md).

| # | Document | Read it when |
|---|---|---|
| 01 | [System overview](01-SYSTEM-OVERVIEW.md) | You are new: the business flow, architecture, environments, outside services |
| 02 | [Module guide](02-MODULES.md) | You need to find the screens, files, endpoints, tables, emails and jobs of a feature |
| 03 | [Data model](03-DATA-MODEL.md) | You touch queries or the schema; the DDL process and known pitfalls |
| 04 | [Jobs & integrations](04-JOBS-AND-INTEGRATIONS.md) | A scheduled job or an outside service (Graph, Zeko, AI) misbehaves |
| 05 | [Configuration](05-CONFIGURATION.md) | You set up an environment, change a setting or flip a flag |
| 06 | [Operations runbook](06-OPERATIONS-RUNBOOK.md) | HR reports an error, an alert arrives, or you deploy or roll back |
| 07 | [Development history 2026](07-DEVELOPMENT-HISTORY-2026.md) | You want to know what was built, when and why |
| 08 | [Onboarding](08-ONBOARDING.md) | You set up a machine, run the app, or run the tests |

## The update rule
Every release updates, in the same change:
- the affected section of [02-MODULES.md](02-MODULES.md) (and 03 / 04 / 05 if tables, jobs or settings changed);
- the affected page in `docs/user-guides/`, if users see the change;
- one dated line in [07-DEVELOPMENT-HISTORY-2026.md](07-DEVELOPMENT-HISTORY-2026.md);
- [06-OPERATIONS-RUNBOOK.md](06-OPERATIONS-RUNBOOK.md) §3, when an incident taught us something.

This step is part of the release checklist (runbook §2, step 8).

## Older documents
`docs/reference/` holds the June-era module notes. Where they disagree with these pages, these pages win; the outdated ones carry a "superseded" note at the top. Plans, RCAs and changelogs stay where they are and are linked from here.
