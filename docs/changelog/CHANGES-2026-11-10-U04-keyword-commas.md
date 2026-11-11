# 2026-11-10 · U04 Commas in keyword skills and location

**UAT (Chhaya):** "Comma is not working for skill or location; it picks one option only." Brief: [U04](../Phase%204/uat-fixes/U04-keyword-commas.md). Strict search (`SCREENING_V2`) only; the old path is not patched.

**Location stays an exact match on one part of the stored location** (the 13 Oct rule, [CHANGES-2026-10-13-strict-keyword-filtering.md](CHANGES-2026-10-13-strict-keyword-filtering.md)). The brief proposed whole-word matching; HR decided on 10 Nov to keep exact matching. "Delhi" means Delhi only, never "New Delhi" or "Delhi NCR". Several typed cities are ORed, each exact: "Noida, Delhi" finds an exact Noida or an exact Delhi. On the strict path this already worked; the old path ignored location when skills were typed. No filter code changed; tests now pin the exact rule for several cities.

**Skills All / Any:** the "Match any one skill" checkbox is now a Segmented control, **All skills | Any skill** (default All). The payload is unchanged (`matchMode`).

**Parsed terms:** the keyword summary returns `summary.terms = { skills, location, matchMode }`. The summary bar shows them as chips, for example "Skills (any): java · python   Location (any): noida · delhi".

**Location input:** a half-typed city is already committed when Search is pressed (the Select commits on blur). The browser check confirms this; no change was needed.

**Tests:** `screeningFilters.test.js` 62/62; integration `keywordFilters.test.js` 25/25 (staging DB); full unit suite; frontend build; browser check `e2e/u04-keyword-commas.spec.js` 1/1.

**Flag:** production stays on the old search until the N11 before/after check is built and RT signs it off (see `docs/system/05-CONFIGURATION.md`).
