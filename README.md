# Bank CSV → YNAB Importer

A small, **fully client-side** web app that imports a transaction CSV from
**any bank** into one of your **YNAB** accounts.

There is no backend and no database. You supply your own YNAB **Personal Access
Token**, and it lives only in the browser tab's memory — it is sent **only** in
the direct HTTPS calls to `api.ynab.com`, and is never written to disk,
`localStorage`, a cookie, or any server. That's why this repo can safely be
public: there are no secrets in it, and it never collects yours.

**Live app:** _add your Render URL here once deployed_

## What it does

1. **Connect** — paste your YNAB Personal Access Token; the app loads your
   budgets.
2. **Account** — pick a budget (auto-selected if you only have one) and an open
   account.
3. **CSV** — drag & drop (or browse to) a CSV exported from your bank.
4. **Review & import** — preview every transaction as a register with running
   inflow/outflow totals, a date range, and a list of any rows it couldn't
   read; then import. The app reports how many transactions YNAB created and how
   many it skipped as duplicates.

### How it reads bank CSVs — with an editable column mapping

Bank exports vary, so columns are auto-detected by **header name**
(case-insensitive), not position — most banks' CSVs map correctly with no setup.
But the detection is only a **starting point**: after you drop a file you get a
**column-mapping panel** where you can change exactly which CSV column feeds each
YNAB field:

- **Date** *(required)* — accepts `DD/MM/YYYY`, `D/M/YYYY`, 2-digit years
  (→ `20xx`), and ISO `YYYY-MM-DD`. Dates are read **day-first** (AU/UK style).
- **Payee** and **Memo** — mapped **independently**, so a messy bank narrative
  can go to the memo (or nowhere) instead of becoming the payee. Set either to
  *none* if you don't want it filled.
- **Amount** — pick the layout: either a single **signed amount** column, **or**
  separate **Outflow / Inflow** columns. `$`, commas and spaces are stripped; an
  outflow becomes negative, an inflow positive.

Auto-detection handles common header names (`amount`/`value`,
`debit`/`credit`/`withdrawal`/`deposit`, `outflow`/`inflow`,
`description`/`narrative`/`details`/`payee`, `memo`/`reference`/`notes`), and you
override anything it gets wrong before importing.

Rows with no readable date or amount are never silently dropped: they're
excluded from the import and listed in the preview as unreadable.

### Pick a date range

Banks often only let you export *everything* (years of history), but you
usually just want the latest period. The review step has a **date-range filter**
with From/To pickers and one-click presets — **This month**, **Last month**,
**Last 30 days**, **This year**, **All** — so you can narrow a giant export down
to exactly what you want to import. The range drives everything downstream: the
totals, the duplicate check, and the import all operate on the filtered set, and
the panel shows how many rows fall outside the range.

### Duplicate detection

Importing into an account that **already has transactions** (manual entries, a
previous import, or a linked-bank feed) is the risky case, so the app runs two
layers of protection:

1. **Pre-import check (the important one).** Before you import, the app fetches
   the selected account's existing transactions for the CSV's date range and
   flags any row that looks like it's already there — matching the way YNAB's
   own CSV import does:
   - **amount** must be identical, **and**
   - the **date** falls within a window you control (same-day up to ±7 days), **and**
   - the **description** is compared with a `%like%` test (case-insensitive
     substring either way, with a significant-word-overlap fallback) to raise
     confidence and pick the best match.

   Matching is **one-to-one**: each existing transaction can absorb at most one
   CSV row, so three identical $5 coffees against one already in YNAB flags one
   duplicate and imports the other two.

   Matches come in two strengths so a coincidence never silently drops a real
   transaction:
   - **Clear duplicates** (exact import id, or matching description) are
     **excluded by default**.
   - **Possible matches** (same amount and a nearby date but a *different*
     description) are **kept by default and flagged "possible?"** for you to
     review.

   Every row has an **Import** checkbox, so you can include or exclude any
   transaction regardless of how it was classified.

2. **YNAB `import_id` (the safety net).** Every transaction also gets a stable
   `import_id` of the form `YNAB:{milliunits}:{date}:{occurrence}`, so even if
   the pre-import check is skipped or misses something, **re-importing the same
   file is still safe** — YNAB itself recognises and skips exact matches, and
   reports how many it skipped.

A sample file, [`sample.csv`](sample.csv), is included so you can try the flow
without exporting real data.

## Getting a YNAB Personal Access Token

1. Sign in to YNAB on the web.
2. Go to **Account Settings → Developer Settings**
   (<https://app.ynab.com/settings/developer>).
3. Under **Personal Access Tokens**, click **New Token**, enter your password,
   and copy the token.
4. Paste it into the app. (You can revoke it any time from that same screen.)

## Run it locally

Requires [Node.js](https://nodejs.org/) 18+.

```bash
npm install
npm run dev      # start the dev server (printed URL, usually http://localhost:5173)
npm run build    # production build into dist/
npm run preview  # preview the production build
npm test         # run the CSV-parsing unit tests
```

## Deploy your own copy to Render (free)

This repo includes a [`render.yaml`](render.yaml) blueprint that defines a single
**free static site** (no cold starts, permanently free).

1. Fork this repo to your own GitHub account.
2. In the [Render dashboard](https://dashboard.render.com/), click
   **New → Blueprint**.
3. Connect your GitHub account if prompted, select your fork, and approve the
   blueprint. Render reads `render.yaml`, runs `npm install && npm run build`,
   and publishes the `dist/` folder.
4. Render gives you a URL like `https://your-app.onrender.com`. Every push to
   `main` afterwards auto-deploys.

The blueprint also adds an SPA rewrite (all paths → `/index.html`) so deep links
never 404.

## Tech

- [Vite](https://vite.dev/) + [React](https://react.dev/) (plain JSX)
- [PapaParse](https://www.papaparse.com/) for CSV parsing
- [lucide-react](https://lucide.dev/) for icons
- YNAB calls go straight from the browser via `fetch` (YNAB's API allows CORS
  from any origin)

## License

[MIT](LICENSE)
