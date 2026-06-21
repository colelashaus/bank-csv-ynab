import { useEffect, useMemo, useState } from 'react'
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
  mappingComplete,
} from './lib/csv.js'
import { findDuplicates, dedupeSummary } from './lib/dedupe.js'
import { money, displayDate, shiftDate, toIso, todayIso } from './lib/format.js'
import Particles from './Particles.jsx'

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
  const [headers, setHeaders] = useState([])
  const [mapping, setMapping] = useState(null)
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
  const [choices, setChoices] = useState(() => new Map()) // import_id -> explicit include/exclude
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)
  const [importError, setImportError] = useState(null)

  const selectedBudget = budgets?.find((b) => b.id === budgetId) || null
  const selectedAccount = accounts?.find((a) => a.id === accountId) || null

  const isMapped = mappingComplete(mapping)

  // Build YNAB transactions from the parsed CSV (the full, unfiltered set).
  const built = useMemo(() => {
    if (!rows || !mapping || !accountId || !mappingComplete(mapping)) return null
    return buildTransactions(rows, mapping, { accountId, cleared })
  }, [rows, mapping, accountId, cleared])

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
  }, [rows, accountId, mapping?.date, mapping?.layout, mapping?.amount, mapping?.outflow, mapping?.inflow])

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
    if (!rows || !accountId || !budgetId || !filtered) {
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
    setChoices(new Map())
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
  }, [rows, accountId, budgetId, token, windowDays, fromDate, toDate, filtered])

  // Classify each filtered transaction against the existing ones.
  const dupResults = useMemo(() => {
    if (!filtered || !existing || existing.accountId !== accountId) return null
    return findDuplicates(filtered.transactions, existing.list, { windowDays })
  }, [filtered, existing, accountId, windowDays])

  const dupStats = dupResults ? dedupeSummary(dupResults) : null

  // Per-row import decision. Default: exclude STRONG duplicates, keep everything
  // else (new rows + weak "possible" matches). An explicit user choice (keyed by
  // import_id so it survives date-range changes) always wins.
  function importDecision(t, dup) {
    if (choices.has(t.import_id)) return choices.get(t.import_id)
    return !(dup && dup.status === 'duplicate' && dup.strong)
  }

  const toImport = useMemo(() => {
    if (!filtered) return []
    return filtered.transactions.filter((t, i) => importDecision(t, dupResults?.[i]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, dupResults, choices])

  const importCount = toImport.length
  const excludedCount = filtered
    ? filtered.transactions.length - importCount
    : 0

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
    setMapping(null)
    setHeaders([])
    setImportResult(null)
    setImportError(null)

    Papa.parse(file, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h) => h.trim(),
      complete: (results) => {
        const hdrs = (results.meta?.fields || []).filter((h) => h && h.trim())
        if (!hdrs.length) {
          setParseError("That file doesn't look like a CSV with a header row.")
          return
        }
        // Auto-detect a default mapping; the user can adjust every field below.
        setHeaders(hdrs)
        setMapping(detectColumns(hdrs))
        setRows(results.data)
      },
      error: (err) => {
        setParseError(`Failed to read the file: ${err.message}`)
      },
    })
  }

  function updateMapping(patch) {
    setMapping((prev) => ({ ...prev, ...patch }))
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

  function setChoice(importId, value) {
    setChoices((prev) => {
      const next = new Map(prev)
      next.set(importId, value)
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
    setMapping(null)
    setHeaders([])
    setRows(null)
    setParseError(null)
    setImportResult(null)
    setImportError(null)
    setChoices(new Map())
  }

  // Which step is "active" for the progress rail.
  let activeStep = 1
  if (budgets) activeStep = 2
  if (accountId) activeStep = 3
  if (built) activeStep = 4

  return (
    <>
      <Particles />
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
            {mapping && !parseError && (
              <ColumnMapper
                headers={headers}
                mapping={mapping}
                onChange={updateMapping}
                complete={isMapped}
              />
            )}
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
                decide={(t, dup) => importDecision(t, dup)}
                onChoice={setChoice}
              />
            )}

            {built.skipped.length > 0 && (
              <SkippedList skipped={built.skipped} />
            )}

            <div className="import-bar">
              <div className="import-target">
                Importing into <strong>{selectedAccount?.name}</strong> in{' '}
                <strong>{selectedBudget?.name}</strong>
                {excludedCount > 0 && (
                  <>
                    {' '}
                    · {excludedCount} excluded as duplicate
                    {excludedCount === 1 ? '' : 's'}
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
    </>
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
  const [dragging, setDragging] = useState(false)

  // A <label> wrapping the file input triggers the native file dialog on click
  // (and Enter/Space when the input is focused) without any JS — the most
  // reliable cross-browser approach. Resetting value after selection lets the
  // same file be picked again.
  return (
    <label
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
        onFile(e.dataTransfer.files?.[0])
      }}
    >
      <input
        type="file"
        accept=".csv,text/csv"
        className="visually-hidden"
        onChange={(e) => {
          onFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      <UploadCloud size={28} className="dropzone-icon" />
      {fileName ? (
        <>
          <p className="dropzone-file">{fileName}</p>
          <span className="dropzone-sub">Click to choose a different file</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={(e) => {
              e.preventDefault()
              onClear()
            }}
          >
            Clear
          </button>
        </>
      ) : (
        <>
          <p className="dropzone-main">Drop your bank CSV here</p>
          <p className="dropzone-sub">or click to browse</p>
        </>
      )}
    </label>
  )
}

function ColumnMapper({ headers, mapping, onChange, complete }) {
  // A render function (not a nested component) so selects don't remount/lose
  // focus on every keystroke.
  const renderSelect = (field, required) => (
    <select
      className={`input ${required && !mapping[field] ? 'input-missing' : ''}`}
      value={mapping[field] || ''}
      onChange={(e) => onChange({ [field]: e.target.value })}
    >
      <option value="">{required ? '— choose a column —' : '— none —'}</option>
      {headers.map((h) => (
        <option key={h} value={h}>
          {h}
        </option>
      ))}
    </select>
  )

  return (
    <div className="mapper">
      <p className="mapper-title">Map your columns to YNAB fields</p>
      <p className="mapper-hint">
        Auto-detected from the headers — change anything that’s wrong. Leave
        Payee or Memo as “none” if you don’t want them filled.
      </p>

      <div className="mapper-grid">
        <label className="mapper-field">
          <span>
            Date <em>required</em>
          </span>
          {renderSelect('date', true)}
        </label>

        <label className="mapper-field">
          <span>Payee</span>
          {renderSelect('payee', false)}
        </label>

        <label className="mapper-field">
          <span>Memo</span>
          {renderSelect('memo', false)}
        </label>
      </div>

      <div className="mapper-amount">
        <div className="mapper-layout" role="radiogroup" aria-label="Amount layout">
          <label>
            <input
              type="radio"
              name="layout"
              checked={mapping.layout === 'single'}
              onChange={() => onChange({ layout: 'single' })}
            />
            One signed amount column
          </label>
          <label>
            <input
              type="radio"
              name="layout"
              checked={mapping.layout === 'split'}
              onChange={() => onChange({ layout: 'split' })}
            />
            Separate outflow &amp; inflow
          </label>
        </div>

        {mapping.layout === 'single' ? (
          <div className="mapper-grid">
            <label className="mapper-field">
              <span>
                Amount <em>required</em>
              </span>
              {renderSelect('amount', true)}
            </label>
          </div>
        ) : (
          <div className="mapper-grid">
            <label className="mapper-field">
              <span>Outflow (money out)</span>
              {renderSelect('outflow', false)}
            </label>
            <label className="mapper-field">
              <span>Inflow (money in)</span>
              {renderSelect('inflow', false)}
            </label>
          </div>
        )}
      </div>

      {!complete && (
        <p className="mapper-warn">
          <AlertTriangle size={14} /> Pick a <strong>Date</strong> column and{' '}
          {mapping.layout === 'single' ? (
            <>
              an <strong>Amount</strong> column
            </>
          ) : (
            <>
              at least one of <strong>Outflow</strong> / <strong>Inflow</strong>
            </>
          )}{' '}
          to continue.
        </p>
      )}
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
            Checked against {existing.list.length} existing transaction
            {existing.list.length === 1 ? '' : 's'} in{' '}
            <strong>{accountName}</strong>:{' '}
            {dupStats.strong > 0 && (
              <>
                <strong>{dupStats.strong}</strong> clear duplicate
                {dupStats.strong === 1 ? '' : 's'} excluded
              </>
            )}
            {dupStats.strong > 0 && dupStats.weak > 0 && '; '}
            {dupStats.weak > 0 && (
              <>
                <strong>{dupStats.weak}</strong> possible match
                {dupStats.weak === 1 ? '' : 'es'} (same amount &amp; nearby date,
                different description) — <strong>kept by default</strong>, untick
                to skip
              </>
            )}
            . {dupStats.fresh} look new. Every row’s “import” box is editable.
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

function Register({ preview, dupResults, decide, onChoice }) {
  return (
    <div className="register-wrap">
      <table className="register">
        <thead>
          <tr>
            <th className="num">Import</th>
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
            const willImport = decide(p, dup)
            let badge = null
            if (isDup && dup.strong) {
              badge = (
                <span className={`badge badge-dup conf-${dup.confidence}`} title={dup.reason}>
                  duplicate
                </span>
              )
            } else if (isDup) {
              badge = (
                <span className="badge badge-maybe" title={dup.reason}>
                  possible?
                </span>
              )
            } else {
              badge = <span className="badge badge-new">new</span>
            }
            return (
              <tr key={p.import_id} className={willImport ? '' : 'row-skip'}>
                <td className="num">
                  <input
                    type="checkbox"
                    className="import-check"
                    checked={willImport}
                    onChange={(e) => onChoice(p.import_id, e.target.checked)}
                    aria-label={`Import ${p.payee || 'transaction'} ${displayDate(p.date)}`}
                  />
                </td>
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
                  {badge}
                  {isDup && <span className="dup-reason">{dup.reason}</span>}
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
