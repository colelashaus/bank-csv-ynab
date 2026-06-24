// Thin YNAB API client. Every call runs directly from the browser — the
// token lives only in React state and is sent solely to api.ynab.com over
// HTTPS. Nothing is persisted anywhere.

const BASE_URL = 'https://api.ynab.com/v1'

class YnabError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'YnabError'
    this.status = status
  }
}

async function request(path, token, options = {}) {
  let res
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    })
  } catch (e) {
    throw new YnabError(
      'Could not reach YNAB. Check your internet connection and try again.',
      0
    )
  }

  let body = null
  try {
    body = await res.json()
  } catch {
    // Some responses (rare) may not be JSON.
  }

  if (!res.ok) {
    if (res.status === 401) {
      throw new YnabError(
        "Your token wasn't accepted. Double-check you pasted the full Personal Access Token.",
        401
      )
    }
    if (res.status === 429) {
      throw new YnabError(
        "You've hit YNAB's rate limit. Wait a minute and try again.",
        429
      )
    }
    const detail = body?.error?.detail || `Request failed (HTTP ${res.status}).`
    throw new YnabError(detail, res.status)
  }

  return body
}

/** GET /budgets → [{ id, name }] */
export async function getBudgets(token) {
  const body = await request('/budgets', token)
  return body?.data?.budgets ?? []
}

/**
 * GET /budgets/{id}/accounts → open accounts only.
 * Filters out closed/deleted accounts.
 */
export async function getAccounts(token, budgetId) {
  const body = await request(
    `/budgets/${encodeURIComponent(budgetId)}/accounts`,
    token
  )
  const accounts = body?.data?.accounts ?? []
  return accounts.filter((a) => !a.closed && !a.deleted)
}

/**
 * GET /budgets/{id}/accounts/{account_id}/transactions
 * Used to pre-check for duplicates before importing. Optionally bounded with
 * since_date (ISO YYYY-MM-DD) to only fetch transactions on/after that date.
 * Filters out deleted transactions.
 */
export async function getAccountTransactions(token, budgetId, accountId, sinceDate) {
  const q = sinceDate ? `?since_date=${encodeURIComponent(sinceDate)}` : ''
  const body = await request(
    `/budgets/${encodeURIComponent(budgetId)}/accounts/${encodeURIComponent(
      accountId
    )}/transactions${q}`,
    token
  )
  const txns = body?.data?.transactions ?? []
  return txns.filter((t) => !t.deleted)
}

/**
 * Flatten YNAB's category_groups into groups usable in a grouped <select>.
 * Drops deleted/hidden groups and categories, and the special internal group
 * (which holds "Inflow: Ready to Assign" etc.). Pure — unit tested.
 */
export function flattenCategories(groups) {
  const out = []
  for (const g of groups || []) {
    if (g.deleted || g.hidden) continue
    if (g.name === 'Internal Master Category') continue
    const categories = (g.categories || [])
      .filter((c) => !c.deleted && !c.hidden)
      .map((c) => ({ id: c.id, name: c.name }))
    if (categories.length) out.push({ name: g.name, categories })
  }
  return out
}

/**
 * GET /budgets/{id}/categories → grouped, import-ready categories.
 */
export async function getCategories(token, budgetId) {
  const body = await request(
    `/budgets/${encodeURIComponent(budgetId)}/categories`,
    token
  )
  return flattenCategories(body?.data?.category_groups ?? [])
}

/**
 * POST /budgets/{id}/transactions
 * @returns {{ created: number, duplicates: number }}
 */
export async function createTransactions(token, budgetId, transactions) {
  const body = await request(
    `/budgets/${encodeURIComponent(budgetId)}/transactions`,
    token,
    {
      method: 'POST',
      body: JSON.stringify({ transactions }),
    }
  )
  const created = body?.data?.transactions?.length ?? 0
  const duplicates = body?.data?.duplicate_import_ids?.length ?? 0
  return { created, duplicates }
}

export { YnabError }
