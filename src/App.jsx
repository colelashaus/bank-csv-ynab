import { useEffect, useMemo, useRef, useState } from 'react'
import Papa from 'papaparse'
import {
  KeyRound,
  Wallet,
  FileSpreadsheet,
  ListChecks,
  ShieldCheck,
  UploadCloud,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  RefreshCw,
  ExternalLink,
  Layers,
  Search,
  CalendarRange,
} from 'lucide-react'
import {
  getBudgets,
  getAccounts,
  getAccountTransactions,
  createTransactions,
} from './lib/ynab.js'
import {
  detectColumns,
  buildTransactions,
  summarize,
  dateInRange,
} from './lib/csv.js'
import { findDuplicates, dedupeSummary } from './lib/dedupe.js'
import { money, displayDate, shiftDate, toIso, todayIso } from './lib/format.js'

const STEPS = [
  { n: 1, label: 'Connect', icon: KeyRound },
  { n: 2, label: 'Account', icon: Wallet },
  { n: 3, label: 'CSV', icon: FileSpreadsheet },
  { n: 4, label: 'Review & import', icon: ListChecks },
]

export default function App() {
  // Step 1 — token + budgets
  const [token, setToken] = useState('')
  const [budgets, setBudgets] = useState(null)
  const [connecting, setConnecting] = useState(false)
  const [connectError, setConnectError] = useState(null)

  // Step 2 — budget + account
  const [budgetId, setBudgetId] = useState('')
  const [accounts, setAccounts] = useState(null)
  const [loadingAccounts, setLoadingAccounts] = useState(false)
  const [accountsError, setAccountsError] = useState(null)
  const [accountId, setAccountId] = useState('')

  // Step 3 — CSV
  const [fileName, setFileName] = useState('')
  const [cols, setCols] = useState(null)
  const [parseError, setParseError] = useState(null)
  const [rows, setRows] = useState(null)

  // Step 4 — review + import
  const [cleared, setCleared] = useState(true)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [windowDays, setWindowDays] = useState(3)
  const [existing, setExisting] = useState(null) // { list, accountId }
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState(null)
  const [overrides, setOverrides] = useState(() => new Set()) // import_ids to import anyway
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)
  const [importError, setImportError] = useState(null)

  const selectedBudget = budgets?.find((b) => b.id === budgetId) || null
  const selectedAccount = accounts?.find((a) => a.id === accountId) || null

  // Build YNAB transactions from the parsed CSV (the full, unfiltered set).
  const built = useMemo(() => {
    if (!rows || !cols || !accountId) return null
    return buildTransactions(rows, cols, { accountId, cleared })
  }, [rows, cols, accountId, cleared])

  // Full date span of the file (drives the date pickers' bounds + "All" reset).
  const fullSummary = useMemo(
    () => (built ? summarize(built.preview) : null),
    [built]
  )

  // Default the date range to the file's full span whenever a new file/account
  // is loaded (not when the "cleared" toggle flips).
  useEffect(() => {
    if (!built) return
    const s = summarize(built.preview)
    setFromDate(s.minDate || '')
    setToDate(s.maxDate || '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, cols, accountId])

  // Apply the date-range filter. Kept aligned: transactions[i] <-> preview[i].
  const filtered = useMemo(() => {
    if (!built) return null
    if (!fromDate && !toDate) return built
    const transactions = []
    const preview = []
    built.transactions.forEach((t, i) => {
      if (dateInRange(t.date, fromDate, toDate)) {
        transactions.push(t)
        preview.push(built.preview[i])
      }
    })
    return { transactions, preview, skipped: built.skipped }
  }, [built, fromDate, toDate])

  const excludedByRange = built
    ? built.transactions.length - filtered.transactions.length
    : 0

  const summary = useMemo(
    () => (filtered ? summarize(filtered.preview) : null),
    [filtered]
  )

  // Fetch the account's existing transactions for the SELECTED range so we can
  // flag rows already in YNAB. Scoped to the range so we don't pull years of
  // history. Re-runs when the file, account, range, or match window changes.
  useEffect(() => {
    if (!rows || !cols || !accountId || !budgetId || !filtered) {
      setExisting(null)
      return
    }
    const s = summarize(filtered.preview)
    if (!s || !s.minDate) {
      setExisting({ list: [], accountId })
      return
    }
    let cancelled = false
    setChecking(true)
    setCheckError(null)
    setOverrides(new Set())
    const since = shiftDate(s.minDate, -(Math.max(windowDays, 7)))
    getAccountTransactions(token.trim(), budgetId, accountId, since)
      .then((list) => {
        if (!cancelled) setExisting({ list, accountId })
      })
      .catch((err) => {
        if (!cancelled) {
          setCheckError(err.message)
          setExisting({ list: [], accountId })
        }
      })
      .finally(() => {
        if (!cancelled) setChecking(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, cols, accountId, budgetId, token, windowDays, fromDate, toDate])

  // Classify each filtered transaction against the existing ones.
  const dupResults = useMemo(() => {
    if (!filtered || !existing || existing.accountId !== accountId) return null
    return findDuplicates(filtered.transactions, existing.list, { windowDays })
  }, [filtered, existing, accountId, windowDays])

  const dupStats = dupResults ? dedupeSummary(dupResults) : null

  // Which transactions will actually be imported (in-range, non-duplicate or
  // user-overridden). Overrides are keyed by import_id so they survive filtering.
  const toImport = useMemo(() => {
    if (!filtered) return []
    return filtered.transactions.filter(
      (t, i) =>
        !dupResults ||
        dupResults[i].status !== 'duplicate' ||
        overrides.has(t.import_id)
    )
  }, [filtered, dupResults, overrides])

  const importCount = toImport.length

  async function handleConnect(e) {
    e.preventDefault()
    const t = token.trim()
    if (!t) return
    setConnecting(true)
    setConnectError(null)
    setBudgets(null)
    setAccounts(null)
    setBudgetId('')
    setAccountId('')
    try {
      const list = await getBudgets(t)
      setBudgets(list)
      if (list.length === 1) {
        setBudgetId(list[0].id)
        await loadAccounts(t, list[0].id)
      }
    } catch (err) {
      setConnectError(err.message)
    } finally {
      setConnecting(false)
    }
  }

  async function loadAccounts(t, bId) {
    setLoadingAccounts(true)
    setAccountsError(null)
    setAccounts(null)
    setAccountId('')
    try {
      const list = await getAccounts(t, bId)
      setAccounts(list)
    } catch (err) {
      setAccountsError(err.message)
    } finally {
      setLoadingAccounts(false)
    }
  }

  function handleBudgetChange(e) {
    const bId = e.target.value
    setBudgetId(bId)
    setAccountId('')
    if (bId) loadAccounts(token.trim(), bId)
    else setAccounts(null)
  }

  function handleFile(file) {
    if (!file) return
    setFileName(file.name)
    setParseError(null)
    setRows(null)
    setCols(null)
    setImportResult(null)
    setImportError(null)

    Papa.parse(file, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h) => h.trim(),
      complete: (results) => {
        const headers = results.meta?.fields || []
        if (!headers.length) {
          setParseError("That file doesn't look like a CSV with a header row.")
          return
        }
        const detected = detectColumns(headers)
        if (!detected.date) {
          setParseError(
            `Couldn't find a date column. Detected headers: ${headers.join(', ')}`
          )
          return
        }
        if (detected.layout === 'none') {
          setParseError(
            `Couldn't find an amount column (need an "amount", or "debit"/"credit"). Detected headers: ${headers.join(
              ', '
            )}`
          )
          return
        }
        setCols({ ...detected, headers })
        setRows(results.data)
      },
      error: (err) => {
        setParseError(`Failed to read the file: ${err.message}`)
      },
    })
  }

  async function handleImport() {
    if (!toImport.length) return
    setImporting(true)
    setImportError(null)
    setImportResult(null)
    try {
      const result = await createTransactions(token.trim(), budgetId, toImport)
      setImportResult(result)
    } catch (err) {
      setImportError(err.message)
    } finally {
      setImporting(false)
    }
  }

  function toggleOverride(importId) {
    setOverrides((prev) => {
      const next = new Set(prev)
      if (next.has(importId)) next.delete(importId)
      else next.add(importId)
      return next
    })
  }

  function applyPreset(name) {
    const now = new Date()
    if (name === 'thisMonth') {
      setFromDate(toIso(new Date(now.getFullYear(), now.getMonth(), 1)))
      setToDate(todayIso())
    } else if (name === 'lastMonth') {
      setFromDate(toIso(new Date(now.getFullYear(), now.getMonth() - 1, 1)))
      setToDate(toIso(new Date(now.getFullYear(), now.getMonth(), 0)))
    } else if (name === 'last30') {
      const d = new Date(now)
      d.setDate(d.getDate() - 29)
      setFromDate(toIso(d))
      setToDate(todayIso())
    } else if (name === 'thisYear') {
      setFromDate(`${now.getFullYear()}-01-01`)
      setToDate(todayIso())
    } else if (name === 'all') {
      setFromDate(fullSummary?.minDate || '')
      setToDate(fullSummary?.maxDate || '')
    }
  }

  function resetCsv() {
    setFileName('')
    setCols(null)
    setRows(null)
    setParseError(null)
    setImportResult(null)
    setImportError(null)
    setOverrides(new Set())
  }

  // Which step is "active" for the progress rail.
  let activeStep = 1
  if (budgets) activeStep = 2
  if (accountId) activeStep = 3
  if (built) activeStep = 4

  return (
    <div className="page">
      <header className="masthead">
        <h1>
          Bank CSV <span className="arrow">→</span> YNAB
        </h1>
        <p className="tagline">
          Import a transaction CSV from any bank straight into one of your YNAB
          accounts.
        </p>
        <StepRail active={activeStep} />
      </header>

      <main>
        {/* ── Step 1: Connect ───────────────────────────── */}
        <Section step={1} title="Connect to YNAB" icon={KeyRound}>
          <form onSubmit={handleConnect} className="stack">
            <label htmlFor="token" className="field-label">
              YNAB Personal Access Token
            </label>
            <div className="token-row">
              <input
                id="token"
                type="password"
                className="input mono"
                placeholder="paste your token…"
                value={token}
                autoComplete="off"
                spellCheck="false"
                onChange={(e) => setToken(e.target.value)}
              />
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!token.trim() || connecting}
              >
                {connecting ? (
                  <>
                    <Loader2 className="spin" size={16} /> Connecting…
                  </>
                ) : (
                  'Connect'
                )}
              </button>
            </div>

            <p className="hint">
              Create one under{' '}
              <a
                href="https://app.ynab.com/settings/developer"
                target="_blank"
                rel="noreferrer"
              >
                YNAB → Account Settings → Developer Settings{' '}
                <ExternalLink size={12} />
              </a>{' '}
              → “New Token”.
            </p>

            {connectError && <ErrorBox>{connectError}</ErrorBox>}
            {budgets && !connectError && (
              <SuccessNote>
                Connected — found {budgets.length} budget
                {budgets.length === 1 ? '' : 's'}.
              </SuccessNote>
            )}
          </form>

          <SecurityNote />
        </Section>

        {/* ── Step 2: Budget + Account ──────────────────── */}
        {budgets && (
          <Section step={2} title="Pick a budget & account" icon={Wallet}>
            <div className="stack">
              <div>
                <label htmlFor="budget" className="field-label">
                  Budget
                </label>
                <select
                  id="budget"
                  className="input"
                  value={budgetId}
                  onChange={handleBudgetChange}
                >
                  <option value="">Select a budget…</option>
                  {budgets.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>

              {loadingAccounts && (
                <p className="hint">
                  <Loader2 className="spin" size={14} /> Loading accounts…
                </p>
              )}
              {accountsError && <ErrorBox>{accountsError}</ErrorBox>}

              {accounts && (
                <div>
                  <label htmlFor="account" className="field-label">
                    Account
                  </label>
                  {accounts.length === 0 ? (
                    <EmptyNote>
                      This budget has no open accounts. Pick another budget.
                    </EmptyNote>
                  ) : (
                    <select
                      id="account"
                      className="input"
                      value={accountId}
                      onChange={(e) => setAccountId(e.target.value)}
                    >
                      <option value="">Select an account…</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} · {a.type} · {money(a.balance / 1000)}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}
            </div>
          </Section>
        )}

        {/* ── Step 3: CSV ───────────────────────────────── */}
        {accountId && (
          <Section step={3} title="Drop your bank CSV" icon={FileSpreadsheet}>
            <Dropzone
              fileName={fileName}
              onFile={handleFile}
              onClear={resetCsv}
            />
            {parseError && <ErrorBox>{parseError}</ErrorBox>}
            {cols && !parseError && <ColumnMap cols={cols} />}
          </Section>
        )}

        {/* ── Step 4: Review & import ───────────────────── */}
        {built && (
          <Section step={4} title="Review & import" icon={ListChecks}>
            <DateRangePanel
              fromDate={fromDate}
              toDate={toDate}
              onFrom={setFromDate}
              onTo={setToDate}
              onPreset={applyPreset}
              fullSummary={fullSummary}
              excludedByRange={excludedByRange}
              shown={filtered?.transactions.length ?? 0}
              total={built.transactions.length}
            />

            {summary && <SummaryStrip summary={summary} skipped={built.skipped} />}

            <DuplicatePanel
              checking={checking}
              checkError={checkError}
              existing={existing}
              dupStats={dupStats}
              accountName={selectedAccount?.name}
              windowDays={windowDays}
              onWindowDays={setWindowDays}
            />

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={cleared}
                onChange={(e) => setCleared(e.target.checked)}
              />
              Mark imported transactions as <strong>cleared</strong>
            </label>

            {filtered.preview.length === 0 ? (
              <EmptyNote>
                No transactions fall within the selected date range. Widen the
                range above.
              </EmptyNote>
            ) : (
              <Register
                preview={filtered.preview}
                dupResults={dupResults}
                overrides={overrides}
                onToggleOverride={toggleOverride}
              />
            )}

            {built.skipped.length > 0 && (
              <SkippedList skipped={built.skipped} />
            )}

            <div className="import-bar">
              <div className="import-target">
                Importing into <strong>{selectedAccount?.name}</strong> in{' '}
                <strong>{selectedBudget?.name}</strong>
                {dupStats && dupStats.duplicates > 0 && (
                  <>
                    {' '}
                    · {dupStats.duplicates} duplicate
                    {dupStats.duplicates === 1 ? '' : 's'} skipped
                    {overrides.size > 0 ? ` (${overrides.size} overridden)` : ''}
                  </>
                )}
              </div>
              <button
                className="btn btn-primary btn-lg"
                onClick={handleImport}
                disabled={importing || checking || importCount === 0}
              >
                {importing ? (
                  <>
                    <Loader2 className="spin" size={18} /> Importing…
                  </>
                ) : checking ? (
                  <>
                    <Loader2 className="spin" size={18} /> Checking…
                  </>
                ) : (
                  <>
                    <UploadCloud size={18} /> Import {importCount} transaction
                    {importCount === 1 ? '' : 's'}
                  </>
                )}
              </button>
            </div>

            {importError && <ErrorBox>{importError}</ErrorBox>}
            {importResult && (
              <ImportResult result={importResult} onReset={resetCsv} />
            )}
          </Section>
        )}
      </main>

      <footer className="footer">
        <p>
          Fully client-side. Your token stays in this browser tab and is sent
          only to YNAB. No server, no storage.{' '}
          <a
            href="https://github.com/colelashaus/bank-csv-ynab"
            target="_blank"
            rel="noreferrer"
          >
            Source on GitHub <ExternalLink size={12} />
          </a>
        </p>
      </footer>
    </div>
  )
}

/* ─────────────────────────── sub-components ─────────────────────────── */

function StepRail({ active }) {
  return (
    <ol className="step-rail" aria-label="Progress">
      {STEPS.map(({ n, label, icon: Icon }) => {
        const state =
          n < active ? 'done' : n === active ? 'current' : 'upcoming'
        return (
          <li key={n} className={`step step-${state}`}>
            <span className="step-dot">
              {state === 'done' ? <CheckCircle2 size={16} /> : <Icon size={16} />}
            </span>
            <span className="step-label">{label}</span>
          </li>
        )
      })}
    </ol>
  )
}

function Section({ step, title, icon: Icon, children }) {
  return (
    <section className="card">
      <h2 className="card-title">
        <span className="card-step">{step}</span>
        <Icon size={18} /> {title}
      </h2>
      {children}
    </section>
  )
}

function Dropzone({ fileName, onFile, onClear }) {
  const inputRef = useRef(null)
  const [dragging, setDragging] = useState(false)

  return (
    <div
      className={`dropzone ${dragging ? 'dropzone-active' : ''} ${
        fileName ? 'dropzone-filled' : ''
      }`}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        const file = e.dataTransfer.files?.[0]
        onFile(file)
      }}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          inputRef.current?.click()
        }
      }}
      role="button"
      tabIndex={0}
      aria-label="Choose or drop a CSV file"
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="visually-hidden"
        onChange={(e) => onFile(e.target.files?.[0])}
      />
      <UploadCloud size={28} className="dropzone-icon" />
      {fileName ? (
        <>
          <p className="dropzone-file">{fileName}</p>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={(e) => {
              e.stopPropagation()
              onClear()
            }}
          >
            Choose a different file
          </button>
        </>
      ) : (
        <>
          <p className="dropzone-main">Drop your bank CSV here</p>
          <p className="dropzone-sub">or click to browse</p>
        </>
      )}
    </div>
  )
}

function ColumnMap({ cols }) {
  const items = [
    ['Date', cols.date],
    ['Description', cols.payee],
  ]
  if (cols.layout === 'single') {
    items.push(['Amount', cols.amount])
  } else {
    items.push(['Debit', cols.debit])
    items.push(['Credit', cols.credit])
  }
  return (
    <div className="colmap">
      <p className="colmap-title">Detected columns</p>
      <ul className="colmap-list">
        {items.map(([role, header]) => (
          <li key={role}>
            <span className="colmap-role">{role}</span>
            <span className={`colmap-header ${header ? '' : 'colmap-missing'}`}>
              {header || 'not found'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function DateRangePanel({
  fromDate,
  toDate,
  onFrom,
  onTo,
  onPreset,
  fullSummary,
  excludedByRange,
  shown,
  total,
}) {
  const min = fullSummary?.minDate || undefined
  const max = fullSummary?.maxDate || undefined
  const invalid = fromDate && toDate && fromDate > toDate
  return (
    <div className="range">
      <div className="range-head">
        <CalendarRange size={16} />
        <span className="range-title">Date range</span>
        <span className="range-count">
          {shown} of {total} shown
          {excludedByRange > 0 ? ` · ${excludedByRange} outside range` : ''}
        </span>
      </div>
      <div className="range-controls">
        <label className="range-field">
          From
          <input
            type="date"
            className="input"
            value={fromDate}
            min={min}
            max={max}
            onChange={(e) => onFrom(e.target.value)}
          />
        </label>
        <label className="range-field">
          To
          <input
            type="date"
            className="input"
            value={toDate}
            min={min}
            max={max}
            onChange={(e) => onTo(e.target.value)}
          />
        </label>
        <div className="range-presets">
          <button type="button" className="chip" onClick={() => onPreset('thisMonth')}>
            This month
          </button>
          <button type="button" className="chip" onClick={() => onPreset('lastMonth')}>
            Last month
          </button>
          <button type="button" className="chip" onClick={() => onPreset('last30')}>
            Last 30 days
          </button>
          <button type="button" className="chip" onClick={() => onPreset('thisYear')}>
            This year
          </button>
          <button type="button" className="chip" onClick={() => onPreset('all')}>
            All
          </button>
        </div>
      </div>
      {invalid && (
        <p className="range-invalid">
          <AlertTriangle size={13} /> “From” is after “To” — nothing will match.
        </p>
      )}
    </div>
  )
}

function SummaryStrip({ summary, skipped }) {
  return (
    <div className="summary">
      <Stat label="Transactions" value={summary.count} />
      <Stat
        label="Inflow"
        value={money(summary.inflow)}
        tone="pos"
        icon={ArrowDownLeft}
      />
      <Stat
        label="Outflow"
        value={money(summary.outflow)}
        tone="neg"
        icon={ArrowUpRight}
      />
      <Stat
        label="Date range"
        value={
          summary.minDate
            ? `${displayDate(summary.minDate)} – ${displayDate(summary.maxDate)}`
            : '—'
        }
      />
      <Stat
        label="Unreadable rows"
        value={skipped.length}
        tone={skipped.length ? 'warn' : undefined}
      />
    </div>
  )
}

function Stat({ label, value, tone, icon: Icon }) {
  return (
    <div className={`stat ${tone ? `stat-${tone}` : ''}`}>
      <span className="stat-label">
        {Icon && <Icon size={13} />} {label}
      </span>
      <span className="stat-value mono">{value}</span>
    </div>
  )
}

function DuplicatePanel({
  checking,
  checkError,
  existing,
  dupStats,
  accountName,
  windowDays,
  onWindowDays,
}) {
  if (checking) {
    return (
      <div className="dedupe dedupe-checking">
        <Loader2 className="spin" size={16} />
        <span>Checking {accountName} for transactions already imported…</span>
      </div>
    )
  }

  if (checkError) {
    return (
      <div className="dedupe dedupe-warn">
        <AlertTriangle size={16} />
        <div>
          <strong>Couldn’t check for existing transactions.</strong>{' '}
          {checkError} You can still import, but duplicates won’t be filtered —
          re-importing the same file is still safe (YNAB skips exact matches).
        </div>
      </div>
    )
  }

  if (!dupStats || !existing) return null

  const tone = dupStats.duplicates > 0 ? 'dedupe-found' : 'dedupe-clear'
  return (
    <div className={`dedupe ${tone}`}>
      {dupStats.duplicates > 0 ? <Layers size={16} /> : <CheckCircle2 size={16} />}
      <div className="dedupe-body">
        {dupStats.duplicates > 0 ? (
          <span>
            <strong>{dupStats.duplicates}</strong> of {dupStats.total}{' '}
            transaction{dupStats.total === 1 ? '' : 's'} look like they’re{' '}
            <strong>already in {accountName}</strong> — excluded by default.{' '}
            {dupStats.fresh} new to import. Tick “import anyway” on any row you
            want to force in.
          </span>
        ) : (
          <span>
            Checked against {existing.list.length} existing transaction
            {existing.list.length === 1 ? '' : 's'} in {accountName} — no
            duplicates found. All {dupStats.total} look new.
          </span>
        )}
        <label className="dedupe-window">
          <Search size={13} /> Match window:
          <select
            value={windowDays}
            onChange={(e) => onWindowDays(Number(e.target.value))}
          >
            <option value={0}>same day</option>
            <option value={1}>±1 day</option>
            <option value={3}>±3 days</option>
            <option value={5}>±5 days</option>
            <option value={7}>±7 days</option>
          </select>
        </label>
      </div>
    </div>
  )
}

function Register({ preview, dupResults, overrides, onToggleOverride }) {
  return (
    <div className="register-wrap">
      <table className="register">
        <thead>
          <tr>
            <th>Date</th>
            <th>Payee</th>
            <th className="num">Amount</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {preview.map((p, i) => {
            const dup = dupResults?.[i]
            const isDup = dup?.status === 'duplicate'
            const overridden = overrides.has(p.import_id)
            return (
              <tr key={p.import_id} className={isDup && !overridden ? 'row-dup' : ''}>
                <td className="mono nowrap">{displayDate(p.date)}</td>
                <td className="payee-cell">
                  {p.payee || <span className="muted">(no description)</span>}
                  {p.memo && <span className="memo">{p.memo}</span>}
                </td>
                <td
                  className={`num mono ${
                    p.dollars >= 0 ? 'amount-pos' : 'amount-neg'
                  }`}
                >
                  {money(p.dollars)}
                </td>
                <td className="status-cell">
                  {isDup ? (
                    <>
                      <span
                        className={`badge badge-dup conf-${dup.confidence}`}
                        title={dup.reason}
                      >
                        duplicate
                      </span>
                      <label className="override">
                        <input
                          type="checkbox"
                          checked={overridden}
                          onChange={() => onToggleOverride(p.import_id)}
                        />
                        import anyway
                      </label>
                      <span className="dup-reason">{dup.reason}</span>
                    </>
                  ) : (
                    <span className="badge badge-new">new</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function SkippedList({ skipped }) {
  return (
    <details className="skipped">
      <summary>
        <AlertTriangle size={15} /> {skipped.length} row
        {skipped.length === 1 ? '' : 's'} unreadable (excluded — no date or
        amount)
      </summary>
      <ul>
        {skipped.map((s) => (
          <li key={s.row}>
            Row {s.row}: {s.reason}
          </li>
        ))}
      </ul>
    </details>
  )
}

function ImportResult({ result, onReset }) {
  return (
    <div className="result">
      <CheckCircle2 size={22} className="result-icon" />
      <div>
        <p className="result-headline">
          Imported {result.created} transaction
          {result.created === 1 ? '' : 's'}.
        </p>
        <p className="result-sub">
          {result.duplicates > 0
            ? `${result.duplicates} skipped by YNAB as duplicate${
                result.duplicates === 1 ? '' : 's'
              } (already in YNAB).`
            : 'No duplicates reported by YNAB — all transactions were new.'}
        </p>
        <button className="btn btn-ghost btn-sm" onClick={onReset}>
          <RefreshCw size={14} /> Import another file
        </button>
      </div>
    </div>
  )
}

function SecurityNote() {
  return (
    <p className="security">
      <ShieldCheck size={15} />
      Your token never leaves this browser tab except in the direct HTTPS call
      to YNAB. It isn’t saved to disk, localStorage, or any server.
    </p>
  )
}

function ErrorBox({ children }) {
  return (
    <div className="alert alert-error" role="alert">
      <AlertTriangle size={16} />
      <span>{children}</span>
    </div>
  )
}

function SuccessNote({ children }) {
  return (
    <p className="success-note">
      <CheckCircle2 size={15} /> {children}
    </p>
  )
}

function EmptyNote({ children }) {
  return <p className="empty-note">{children}</p>
}
