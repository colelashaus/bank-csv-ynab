// Pure CSV → YNAB transformation logic for bank transaction CSV exports.
//
// Everything here is dependency-free and side-effect-free so it can be unit
// tested with `node --test` (see test/csv.test.js). The React layer feeds it
// the already-parsed rows from PapaParse.

/**
 * Suggest a default column → YNAB-field mapping from the CSV headers. The user
 * can override every field in the UI. Matching is case-insensitive and based on
 * header *names*, not positions, because banks' export column order varies.
 *
 * Fields use empty string '' for "not mapped" so they slot straight into
 * <select> values.
 *
 * @param {string[]} headers - header field names from the CSV
 * @returns {{
 *   date: string,
 *   payee: string,
 *   memo: string,
 *   amount: string,
 *   outflow: string,
 *   inflow: string,
 *   layout: 'single'|'split'
 * }}
 */
export function detectColumns(headers) {
  const norm = (h) => String(h ?? '').trim().toLowerCase()
  const find = (pred) => headers.find((h) => pred(norm(h))) ?? ''

  const date = find((h) => h.includes('date'))

  // Description preference order; first match wins.
  const payee =
    find((h) => h.includes('description')) ||
    find((h) => h.includes('narrative')) ||
    find((h) => h.includes('details')) ||
    find((h) => h.includes('payee')) ||
    ''

  // Memo: only if there's an obvious column for it; otherwise leave unmapped.
  const memo =
    find((h) => h.includes('memo')) ||
    find((h) => h.includes('reference')) ||
    find((h) => h.includes('notes')) ||
    ''

  // Split outflow/inflow columns. Banks name these many ways — Westpac uses
  // "Debit Amount"/"Credit Amount", YNAB exports use "Outflow"/"Inflow".
  const outflow = find(
    (h) =>
      h.includes('debit') || h.includes('withdrawal') || h.includes('outflow')
  )
  const inflow = find(
    (h) =>
      h.includes('credit') || h.includes('deposit') || h.includes('inflow')
  )

  // A single signed amount column. Must contain "amount"/"value" but NOT be one
  // of the split columns above — "Debit Amount"/"Credit Amount" also contain the
  // word "amount", and matching them here would silently break the sign and drop
  // every credit row.
  const amount = find(
    (h) =>
      (h.includes('amount') || h === 'value') &&
      !/debit|credit|withdrawal|deposit|inflow|outflow/.test(h)
  )

  // Prefer the split layout whenever both columns are present; otherwise use a
  // lone signed amount column; otherwise fall back to a single outflow/inflow.
  let layout = 'single'
  if (outflow && inflow) layout = 'split'
  else if (amount) layout = 'single'
  else if (outflow || inflow) layout = 'split'

  return { date, payee, memo, amount, outflow, inflow, layout }
}

/** Is a mapping complete enough to import? (date + a usable amount source) */
export function mappingComplete(m) {
  if (!m || !m.date) return false
  if (m.layout === 'single') return !!m.amount
  return !!(m.outflow || m.inflow)
}

/**
 * Parse a money string into a Number, stripping currency symbols, thousands
 * separators, and whitespace. Returns NaN when there's nothing numeric.
 *
 * "$1,234.56" -> 1234.56   "-99.90" -> -99.9   "" -> NaN
 */
export function parseMoney(value) {
  if (value === null || value === undefined) return NaN
  let s = String(value).trim()
  if (s === '') return NaN

  // Accounting-style negatives: (12.34) -> -12.34
  let negative = false
  if (/^\(.*\)$/.test(s)) {
    negative = true
    s = s.slice(1, -1)
  }

  s = s.replace(/[$,\s]/g, '')
  if (s === '' || s === '-' || s === '+') return NaN

  const n = Number(s)
  if (Number.isNaN(n)) return NaN
  return negative ? -Math.abs(n) : n
}

/**
 * Compute the signed dollar amount for a row given the mapping.
 * Returns NaN when no amount can be read.
 */
export function rowAmount(row, m) {
  if (m.layout === 'single' && m.amount) {
    return parseMoney(row[m.amount])
  }
  if (m.layout === 'split') {
    const outflow = m.outflow ? parseMoney(row[m.outflow]) : NaN
    const inflow = m.inflow ? parseMoney(row[m.inflow]) : NaN
    const hasOut = !Number.isNaN(outflow) && outflow !== 0
    const hasIn = !Number.isNaN(inflow) && inflow !== 0
    if (hasOut) return -Math.abs(outflow)
    if (hasIn) return Math.abs(inflow)
    // Both blank/zero — fall through to NaN so the row is skipped.
    return NaN
  }
  return NaN
}

/**
 * Normalise a date string to ISO `YYYY-MM-DD`.
 * Handles DD/MM/YYYY, D/M/YYYY, 2-digit years (->20xx), separators / - .,
 * and already-ISO dates. Returns null when it can't be parsed.
 */
export function normalizeDate(value) {
  if (value === null || value === undefined) return null
  const s = String(value).trim()
  if (s === '') return null

  // Already ISO: YYYY-MM-DD (optionally with time component).
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (iso) {
    const [, y, m, d] = iso
    return buildIso(y, m, d)
  }

  // DD/MM/YYYY style with / - or . separators.
  const dmy = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/)
  if (dmy) {
    let [, d, m, y] = dmy
    if (y.length === 2) y = '20' + y
    return buildIso(y, m, d)
  }

  return null
}

function buildIso(y, m, d) {
  const year = Number(y)
  const month = Number(m)
  const day = Number(d)
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const mm = String(month).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  return `${year}-${mm}-${dd}`
}

/** Dollars -> integer milliunits (YNAB's amount unit). */
export function toMilliunits(dollars) {
  return Math.round(dollars * 1000)
}

const PAYEE_MAX = 50
const MEMO_MAX = 200

/**
 * Transform parsed CSV rows into YNAB transaction objects.
 *
 * @param {object[]} rows - array of row objects keyed by header name
 * @param {object} mapping - result of detectColumns() (possibly user-edited)
 * @param {{ accountId: string, cleared?: boolean }} opts
 * @returns {{
 *   transactions: object[],   // ready to POST to YNAB
 *   preview: object[],        // { date, payee, memo, amount(dollars), milliunits }
 *   skipped: { row: number, reason: string }[],
 * }}
 */
export function buildTransactions(rows, mapping, opts) {
  const { accountId, cleared = true } = opts
  const transactions = []
  const preview = []
  const skipped = []
  const occurrences = new Map() // `${milliunits}:${date}` -> count so far

  const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim()

  rows.forEach((row, index) => {
    const rowNo = index + 2 // +1 for 0-index, +1 for header row → spreadsheet row

    const date = mapping.date ? normalizeDate(row[mapping.date]) : null
    const dollars = rowAmount(row, mapping)

    const missingDate = !date
    const missingAmount = Number.isNaN(dollars)

    if (missingDate || missingAmount) {
      const reasons = []
      if (missingDate) reasons.push('no readable date')
      if (missingAmount) reasons.push('no readable amount')
      skipped.push({ row: rowNo, reason: reasons.join(' & ') })
      return
    }

    const milliunits = toMilliunits(dollars)

    // Payee and memo are mapped independently. If no memo column is mapped but
    // the payee text is too long for YNAB's payee field, keep the full text in
    // the memo so nothing is lost.
    const payeeText = mapping.payee ? clean(row[mapping.payee]) : ''
    const memoText = mapping.memo ? clean(row[mapping.memo]) : ''
    const payeeName = payeeText ? payeeText.slice(0, PAYEE_MAX) : null
    let memo = memoText ? memoText.slice(0, MEMO_MAX) : null
    if (!memo && payeeText.length > PAYEE_MAX) {
      memo = payeeText.slice(0, MEMO_MAX)
    }

    const key = `${milliunits}:${date}`
    const occurrence = occurrences.get(key) ?? 0
    occurrences.set(key, occurrence + 1)
    const importId = `YNAB:${milliunits}:${date}:${occurrence}`

    transactions.push({
      account_id: accountId,
      date,
      amount: milliunits,
      payee_name: payeeName,
      memo,
      cleared: cleared ? 'cleared' : 'uncleared',
      approved: false,
      import_id: importId,
    })

    preview.push({
      row: rowNo,
      date,
      payee: payeeName ?? '',
      memo: memo ?? '',
      dollars,
      milliunits,
      import_id: importId,
    })
  })

  return { transactions, preview, skipped }
}

/**
 * Whether an ISO YYYY-MM-DD date falls within an inclusive [from, to] range.
 * Empty/null bounds are open-ended. Relies on ISO dates sorting lexically.
 */
export function dateInRange(iso, from, to) {
  if (from && iso < from) return false
  if (to && iso > to) return false
  return true
}

/** Summary stats over a preview array for the UI summary strip. */
export function summarize(preview) {
  let inflow = 0
  let outflow = 0
  let minDate = null
  let maxDate = null

  for (const p of preview) {
    if (p.dollars >= 0) inflow += p.dollars
    else outflow += p.dollars
    if (minDate === null || p.date < minDate) minDate = p.date
    if (maxDate === null || p.date > maxDate) maxDate = p.date
  }

  return {
    count: preview.length,
    inflow,
    outflow, // negative or zero
    minDate,
    maxDate,
  }
}
