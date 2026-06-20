// Display formatting helpers.

const AUD = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** Format a dollar Number as AUD currency, e.g. -1234.5 -> "-$1,234.50". */
export function money(dollars) {
  if (dollars === null || dollars === undefined || Number.isNaN(dollars)) {
    return '—'
  }
  return AUD.format(dollars)
}

/** Format milliunits (integer) as currency. */
export function moneyFromMilliunits(milliunits) {
  return money((milliunits ?? 0) / 1000)
}

/** Shift an ISO YYYY-MM-DD date by a (possibly negative) number of days. */
export function shiftDate(iso, days) {
  const m = iso?.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return iso
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  d.setUTCDate(d.getUTCDate() + days)
  const y = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${mm}-${dd}`
}

/** ISO YYYY-MM-DD -> DD/MM/YYYY for display (day-first, AU/UK style). */
export function displayDate(iso) {
  if (!iso) return '—'
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return iso
  const [, y, mm, dd] = m
  return `${dd}/${mm}/${y}`
}
