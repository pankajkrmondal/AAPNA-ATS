# U03d · The dossier download in the AAPNA look (18–19 Nov 2026)
Follows U03c. Asked for in review: "why is the dossier format not converted to the new AAPNA format as finalized?" The owner chose a restyle only, with all the content kept.

**What changed**
- **What the download is:** the "Download dossier" HTML, on its own or as `Candidate-Dossier.html` in the ZIP.
- **New look:** it now uses the panel report's AAPNA design:
  - a white page on the canvas, with an olive top bar;
  - the embedded AAPNA logo, the wordmark and a "Candidate dossier" pill;
  - olive numbered section headings;
  - rounded records and cards, and olive-dark link buttons;
  - phone and print rules.
- **Same content:** the same nine sections, in the same order, with every record, including the full progress log. On a real staging journey (768), the visible text of the old and new downloads matched word for word. The only difference is the "·" from the old brand line.
- **Unchanged:** the XLSX, the READ-ME, the ZIP contents, the download options, the panel cuts and the email table.

**Files**
- `exports/candidateDossier.export.js`:
  - `STYLES` was rewritten;
  - a new `AAPNA_TOKENS` is shared with `PANEL_STYLES` (the panel output is byte-identical);
  - the header's brand row was added.
- Tests:
  - `candidateDossier.test.js`: both download sha256 snapshots were re-taken, and one test was added (131/131);
  - full unit suite: 1111/1111.

**Check**
- Before/after screenshots and a print-to-PDF are in the session scratchpad.
- Still to do: open a real download from the drawer once the backend has reloaded.
