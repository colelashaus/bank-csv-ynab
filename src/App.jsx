import { useMemo, useRef, useState } from 'react'
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
} from 'lucide-react'
import { getBudgets, getAccounts, createTransactions } from './lib/ynab.js'
import {
  detectColumns,
  buildTransactions,
  summarize,
} from './lib/csv.js'
import { money, displayDate } from './lib/format.js'

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
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)
  const [importError, setImportError] = useState(null)

  const selectedBudget = budgets?.find((b) => b.id === budgetId) || null
  const selectedAccount = accounts?.find((a) => a.id === accountId) || null

  // Recompute the transaction build whenever inputs change.
  const built = useMemo(() => {
    if (!rows || !cols || !accountId) return null
    return buildTransactions(rows, cols, { accountId, cleared })
  }, [rows, cols, accountId, cleared])

  const summary = useMemo(
    () => (built ? summarize(built.preview) : null),
    [built]
  )

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
    if (!built || !built.transactions.length) return
    setImporting(true)
    setImportError(null)
    setImportResult(null)
    try {
      const result = await createTransactions(
        token.trim(),
        budgetId,
        built.transactions
      )
      setImportResult(result)
    } catch (err) {
      setImportError(err.message)
    } finally {
      setImporting(false)
    }
  }

  function resetCsv() {
    setFileName('')
    setCols(null)
    setRows(null)
    setParseError(null)
    setImportResult(null)
    setImportError(null)
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
            {summary && <SummaryStrip summary={summary} skipped={built.skipped} />}

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={cleared}
                onChange={(e) => setCleared(e.target.checked)}
              />
              Mark imported transactions as <strong>cleared</strong>
            </label>

            <Register preview={built.preview} />

            {built.skipped.length > 0 && (
              <SkippedList skipped={built.skipped} />
            )}

            <div className="import-bar">
              <div className="import-target">
                Importing into <strong>{selectedAccount?.name}</strong> in{' '}
                <strong>{selectedBudget?.name}</strong>
              </div>
              <button
                className="btn btn-primary btn-lg"
                onClick={handleImport}
                disabled={importing || built.transactions.length === 0}
              >
                {importing ? (
                  <>
                    <Loader2 className="spin" size={18} /> Importing…
                  </>
                ) : (
                  <>
                    <UploadCloud size={18} /> Import{' '}
                    {built.transactions.length} transaction
                    {built.transactions.length === 1 ? '' : 's'}
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
        label="Skipped rows"
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

function Register({ preview }) {
  return (
    <div className="register-wrap">
      <table className="register">
        <thead>
          <tr>
            <th>Date</th>
            <th>Payee</th>
            <th className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {preview.map((p, i) => (
            <tr key={i}>
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
            </tr>
          ))}
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
        {skipped.length === 1 ? '' : 's'} skipped (not imported)
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
            ? `${result.duplicates} skipped as duplicate${
                result.duplicates === 1 ? '' : 's'
              } (already in YNAB).`
            : 'No duplicates — all transactions were new.'}
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
