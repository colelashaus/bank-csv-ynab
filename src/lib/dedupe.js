// Client-side duplicate detection, run BEFORE import so transactions that are
// already in the target YNAB account aren't created a second time. This is the
// safety net for importing into an account that already has data — manual
// entries, a previous import, or a linked-bank feed. YNAB's own import_id only
// recognises re-imports of THIS tool's files; it does not know about
// transactions that arrived any other way.
//
// Strategy (mirrors how YNAB matches a CSV you drop into its web app): a new
// transaction is treated as a duplicate of an existing one when the amounts are
// identical and the dates fall within a small window. The description is then
// compared with a `%like%` test (case-insensitive substring either way, with a
// token-overlap fallback) to raise confidence and to choose the best candidate
// when several existing transactions share the same amount and date.
//
// Matching is ONE-TO-ONE: each existing transaction can absorb at most one CSV
// row, so importing three identical $5 coffees against one already in YNAB
// correctly flags one as a duplicate and imports the other two.

/** Lowercase, strip punctuation, collapse whitespace — for comparing text. */
export function normalizeDesc(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * `%like%` comparison: true if either normalized string contains the other,
 * or they share most of the shorter description's significant words
 * (overlap coefficient >= 0.6). Using overlap-vs-smaller-set rather than
 * Jaccard tolerates a bank tacking extra words (branch, ref #) onto a name.
 */
export function descriptionLike(a, b) {
  const na = normalizeDesc(a)
  const nb = normalizeDesc(b)
  if (!na || !nb) return false
  if (na.includes(nb) || nb.includes(na)) return true

  const ta = new Set(na.split(' ').filter((w) => w.length > 2))
  const tb = new Set(nb.split(' ').filter((w) => w.length > 2))
  if (!ta.size || !tb.size) return false
  let inter = 0
  for (const t of ta) if (tb.has(t)) inter++
  return inter / Math.min(ta.size, tb.size) >= 0.6
}

/** Absolute difference in whole days between two ISO YYYY-MM-DD dates. */
export function daysApart(isoA, isoB) {
  const a = Date.parse(`${isoA}T00:00:00Z`)
  const b = Date.parse(`${isoB}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return Infinity
  return Math.abs(Math.round((a - b) / 86400000))
}

const descOf = (t) => t.memo || t.payee_name || ''

/**
 * Classify each new transaction against the account's existing transactions.
 *
 * @param {object[]} newTxns  - transactions built from the CSV
 *   (need: amount [milliunits], date [ISO], payee_name, memo, import_id)
 * @param {object[]} existing - existing YNAB transactions in the account
 *   (need: amount, date, payee_name, memo, import_id, deleted)
 * @param {{ windowDays?: number }} opts
 * @returns {{ status: 'new'|'duplicate', confidence: string|null,
 *             reason: string|null, match: object|null }[]}
 *           aligned 1:1 with newTxns
 */
export function findDuplicates(newTxns, existing, opts = {}) {
  const windowDays = opts.windowDays ?? 3
  const active = (existing || []).filter((e) => !e.deleted)

  // Index existing by amount; each entry can be consumed once.
  const byAmount = new Map()
  for (const e of active) {
    const entry = { tx: e, used: false }
    if (!byAmount.has(e.amount)) byAmount.set(e.amount, [])
    byAmount.get(e.amount).push(entry)
  }
  const existingImportIds = new Set(
    active.map((e) => e.import_id).filter(Boolean)
  )

  // A match is "strong" (safe to exclude by default) when there's solid
  // evidence it's the same transaction: an exact import_id, a description match,
  // or the exact same date. A "weak" match shares only the amount and a nearby
  // date with a *different* description — likely a coincidence, so it's flagged
  // but kept in the import by default to avoid silently dropping a real row.
  const STRONG = new Set(['exact', 'high', 'medium'])

  return newTxns.map((t) => {
    // Strongest signal: YNAB already has this exact import_id.
    if (t.import_id && existingImportIds.has(t.import_id)) {
      return {
        status: 'duplicate',
        confidence: 'exact',
        strong: true,
        reason: 'Identical import id already in this account',
        match: null,
      }
    }

    const pool = byAmount.get(t.amount) || []
    const candidates = pool.filter(
      (c) => !c.used && daysApart(c.tx.date, t.date) <= windowDays
    )
    if (!candidates.length) {
      return { status: 'new', confidence: null, strong: false, reason: null, match: null }
    }

    // Prefer a description-like match, then the closest date.
    candidates.sort((x, y) => {
      const lx = descriptionLike(descOf(x.tx), descOf(t)) ? 1 : 0
      const ly = descriptionLike(descOf(y.tx), descOf(t)) ? 1 : 0
      if (lx !== ly) return ly - lx
      return daysApart(x.tx.date, t.date) - daysApart(y.tx.date, t.date)
    })

    const best = candidates[0]
    best.used = true

    const sameDate = best.tx.date === t.date
    const descMatch = descriptionLike(descOf(best.tx), descOf(t))
    const confidence =
      descMatch && sameDate ? 'high' : descMatch || sameDate ? 'medium' : 'low'
    const payee = descOf(best.tx) || '(no payee)'
    const reason = descMatch
      ? `Matches “${payee}” on ${best.tx.date}`
      : `Same amount as “${payee}” on ${best.tx.date} (description differs)`

    return {
      status: 'duplicate',
      confidence,
      strong: STRONG.has(confidence),
      reason,
      match: best.tx,
    }
  })
}

/** Convenience counts for the UI. */
export function dedupeSummary(results) {
  const dups = results.filter((r) => r.status === 'duplicate')
  const strong = dups.filter((r) => r.strong).length
  return {
    total: results.length,
    duplicates: dups.length,
    strong, // excluded by default
    weak: dups.length - strong, // flagged "possible", kept by default
    fresh: results.length - dups.length,
  }
}
