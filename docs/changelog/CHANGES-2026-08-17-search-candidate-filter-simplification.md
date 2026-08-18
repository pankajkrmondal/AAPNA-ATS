# Search Candidate — filter simplification, fixed ordering, lighter list query (2026-08-17)

Two requests against the **Search Candidate** page (`/candidates`), handled together
because they touch the same query path:

1. The filter and Advanced filter "don't make any sense" — keep **Name, Email, Phone
   number**, nothing more.
2. Reduce server load from the ~4k-row candidate table; order by **id descending**
   (the first candidate ever added shows last); **no sorting in the UI — only search**.

**Files:** `frontend/src/pages/Candidates.jsx`,
`backend/src/services/candidate.service.js`.

---

## 1. Three filters, one search affordance

The page carried **three overlapping ways** to narrow or reorder the same table:

- a debounced free-text quick-search box (backend `search` param — name + email +
  skills + current company at once),
- a collapsible **Advanced filters** panel with five fields (email, name, phone,
  position, location) plus an "N filters active / Clear all" strip,
- per-column sort arrows on Name, Email and Position.

Now there is one card with exactly three fields — **Candidate Name**, **Email ID**,
**Phone / Contact Number** — with **Search** and **Reset**. Reset is disabled when
nothing is filtered.

Removed: the quick-search box and its `quick`/`quickInput` state and 350ms debounce
effect, the `advancedOpen` toggle and the whole collapsible panel, the active-filter
counter, and the `position`/`location` filter fields. `searchParams` is now
`{ name, email, phone }`; the `FilterOutlined` and `ReloadOutlined` imports went with
them.

**Unchanged on purpose:** the backend still accepts `search`, `position`, `location`,
`status`, `finalStatus` and `vendorEmail` on `GET /api/candidates` — other callers use
them. This is a UI narrowing, not an API change.

**Known behaviour, not introduced here:** `buildWhereClause()` **ORs** name/email/phone
*with each other* (the legacy "search by any identifier" rule,
`candidate.service.js:537-550`). Filling two of the three fields returns rows matching
**either**, not both. Left as-is because the same clause serves other callers and the
CSV export; switching this page to AND would need a separate flag.

## 2. Fixed id-descending order, no sort UI

- `sorter: true` removed from the Name, Email and Position columns — the table renders
  no sort arrows anywhere.
- The `sort` state is gone. `loadCandidates()` always requests `sort: 'id',
  order: 'desc'`.
- `handleTableChange` handles pagination only; its sorter-mapping branch is deleted.
- `resolveSortField()` gained `if (sort === 'id') return 'id'` — it previously knew
  only name / email / position / modifiedAt and **silently fell back to `createdAt`**
  for anything else, so without this the page would have asked for `id` and quietly
  got date order.

**Why id and not createdAt** (the old default): `createdAt` is nullable
(`schema.prisma:110`) and has no index. Under `DESC` Postgres sorts NULLs **first**, so
legacy rows with no date led page 1; and every page request sorted the full matching
set. `id` is the primary key — stable insertion order, index walk instead of a sort.

## 3. Lighter list query

The page was **already** paginated server-side (25 rows/request, max 100 — it never
pulled 4k), so the load was per-row weight, not row count: `search()` called
`findMany` with **no `select`**, returning all ~80 `rpa_cv` columns including
`resume_full_text` (the entire resume as plain text) and `ai_profile_insights`.

`search()` now passes `omit: { resume_full_text: true, ai_profile_insights: true }`.
Safe because nothing on that path reads either: `mapCandidate()` references neither,
and `screening.service.js` pulls both through its own raw SQL. The export path is
untouched — it already uses the narrow `EXPORT_SELECT` allowlist.

Prisma 6.9; top-level `omit` is GA and present in the generated client
(`rpa_cvFindManyArgs.omit`).

## Verification

- `npx vite build` — compiles clean (only the pre-existing >500kB chunk warning).
- `node --test src/tests/**/*.test.js` — **182 passed, 0 failed**.
- Manual re-test: open Search Candidate → rows load with no search term, newest
  candidate first; no sort arrows on any column; search by name, by email, by phone;
  Reset returns to the full list; page-size 25/50/100 and paging still work; View /
  Edit / Conversations modals and CSV export unaffected (export takes the same three
  filters as the table).
