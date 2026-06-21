import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  detectColumns,
  parseMoney,
  rowAmount,
  normalizeDate,
  toMilliunits,
  buildTransactions,
  summarize,
  dateInRange,
} from '../src/lib/csv.js'

test('detectColumns — single amount layout', () => {
  const cols = detectColumns(['Date', 'Description', 'Amount', 'Balance'])
  assert.equal(cols.date, 'Date')
  assert.equal(cols.payee, 'Description')
  assert.equal(cols.amount, 'Amount')
  assert.equal(cols.layout, 'single')
})

test('detectColumns — split debit/credit layout', () => {
  const cols = detectColumns([
    'Transaction Date',
    'Narrative',
    'Debit',
    'Credit',
  ])
  assert.equal(cols.date, 'Transaction Date')
  assert.equal(cols.payee, 'Narrative')
  assert.equal(cols.debit, 'Debit')
  assert.equal(cols.credit, 'Credit')
  assert.equal(cols.layout, 'split')
})

test('detectColumns — case insensitive & details fallback', () => {
  const cols = detectColumns(['DATE', 'details', 'amount'])
  assert.equal(cols.date, 'DATE')
  assert.equal(cols.payee, 'details')
  assert.equal(cols.layout, 'single')
})

test('detectColumns — Westpac "Debit Amount"/"Credit Amount" is split, not single', () => {
  // Regression: both headers contain the word "amount"; must not be treated as
  // a single signed-amount column (that broke signs and dropped credit rows).
  const cols = detectColumns([
    'Bank Account',
    'Date',
    'Narrative',
    'Debit Amount',
    'Credit Amount',
    'Balance',
    'Categories',
    'Serial',
  ])
  assert.equal(cols.layout, 'split')
  assert.equal(cols.date, 'Date')
  assert.equal(cols.payee, 'Narrative')
  assert.equal(cols.debit, 'Debit Amount')
  assert.equal(cols.credit, 'Credit Amount')
  assert.equal(cols.amount, null)
})

test('detectColumns — YNAB-export Outflow/Inflow is split', () => {
  const cols = detectColumns(['Account', 'Date', 'Payee', 'Memo', 'Outflow', 'Inflow', 'Cleared'])
  assert.equal(cols.layout, 'split')
  assert.equal(cols.debit, 'Outflow')
  assert.equal(cols.credit, 'Inflow')
  assert.equal(cols.payee, 'Payee')
})

test('buildTransactions — Westpac rows: debit negative, credit positive, none dropped', () => {
  const cols = detectColumns([
    'Bank Account',
    'Date',
    'Narrative',
    'Debit Amount',
    'Credit Amount',
    'Balance',
  ])
  const rows = [
    {
      'Bank Account': '123456789012',
      Date: '19/06/2026',
      Narrative: 'DEBIT CARD PURCHASE WOOLWORTHS 2741 TOWNSVILLE AUS',
      'Debit Amount': '21.10',
      'Credit Amount': '',
      Balance: '3246.83',
    },
    {
      'Bank Account': '123456789012',
      Date: '18/06/2026',
      Narrative: 'DEPOSIT CTRLINK PARENT 901J0TJZ302143290K',
      'Debit Amount': '',
      'Credit Amount': '674.20',
      Balance: '3282.88',
    },
  ]
  const { transactions, skipped } = buildTransactions(rows, cols, {
    accountId: 'acc-1',
  })
  assert.equal(skipped.length, 0)
  assert.equal(transactions.length, 2)
  assert.equal(transactions[0].amount, -21100) // debit -> outflow
  assert.equal(transactions[1].amount, 674200) // credit -> inflow
})

test('parseMoney strips $, commas, spaces', () => {
  assert.equal(parseMoney('-99.90'), -99.9)
  assert.equal(parseMoney('99.90'), 99.9)
  assert.equal(parseMoney('$1,234.56'), 1234.56)
  assert.equal(parseMoney(' $ 12.00 '), 12)
  assert.equal(parseMoney('(50.00)'), -50)
  assert.ok(Number.isNaN(parseMoney('')))
  assert.ok(Number.isNaN(parseMoney(null)))
})

test('rowAmount — single column passes sign through', () => {
  const cols = { layout: 'single', amount: 'Amount' }
  assert.equal(rowAmount({ Amount: '-99.90' }, cols), -99.9)
  assert.equal(rowAmount({ Amount: '99.90' }, cols), 99.9)
})

test('rowAmount — split: debit negative, credit positive', () => {
  const cols = { layout: 'split', debit: 'Debit', credit: 'Credit' }
  assert.equal(rowAmount({ Debit: '99.90', Credit: '' }, cols), -99.9)
  assert.equal(rowAmount({ Debit: '', Credit: '99.90' }, cols), 99.9)
  assert.equal(rowAmount({ Debit: '12.00', Credit: '' }, cols), -12)
  assert.ok(Number.isNaN(rowAmount({ Debit: '', Credit: '' }, cols)))
})

test('normalizeDate handles DD/MM/YYYY, D/M/YYYY, 2-digit, ISO', () => {
  assert.equal(normalizeDate('05/03/2026'), '2026-03-05')
  assert.equal(normalizeDate('5/3/2026'), '2026-03-05')
  assert.equal(normalizeDate('05/03/26'), '2026-03-05')
  assert.equal(normalizeDate('2026-03-05'), '2026-03-05')
  assert.equal(normalizeDate('05-03-2026'), '2026-03-05')
  assert.equal(normalizeDate('bad'), null)
  assert.equal(normalizeDate(''), null)
})

test('toMilliunits rounds correctly', () => {
  assert.equal(toMilliunits(-99.9), -99900)
  assert.equal(toMilliunits(1234.56), 1234560)
  assert.equal(toMilliunits(0.1), 100)
})

test('buildTransactions — happy path with dedupe occurrences', () => {
  const cols = detectColumns(['Date', 'Description', 'Amount'])
  const rows = [
    { Date: '01/06/2026', Description: 'Coffee', Amount: '-5.50' },
    { Date: '01/06/2026', Description: 'Coffee', Amount: '-5.50' }, // dup amount+date
    { Date: '02/06/2026', Description: 'Salary', Amount: '2000.00' },
  ]
  const { transactions, preview, skipped } = buildTransactions(rows, cols, {
    accountId: 'acc-1',
    cleared: true,
  })
  assert.equal(transactions.length, 3)
  assert.equal(skipped.length, 0)
  assert.equal(transactions[0].amount, -5500)
  assert.equal(transactions[0].import_id, 'YNAB:-5500:2026-06-01:0')
  assert.equal(transactions[1].import_id, 'YNAB:-5500:2026-06-01:1')
  assert.equal(transactions[2].import_id, 'YNAB:2000000:2026-06-02:0')
  assert.equal(transactions[0].cleared, 'cleared')
  assert.equal(transactions[0].payee_name, 'Coffee')
  assert.equal(preview.length, 3)
})

test('buildTransactions — skips rows with no date or amount', () => {
  const cols = detectColumns(['Date', 'Description', 'Amount'])
  const rows = [
    { Date: '', Description: 'No date', Amount: '-5.50' },
    { Date: '01/06/2026', Description: 'No amount', Amount: '' },
    { Date: '03/06/2026', Description: 'Good', Amount: '10.00' },
  ]
  const { transactions, skipped } = buildTransactions(rows, cols, {
    accountId: 'acc-1',
  })
  assert.equal(transactions.length, 1)
  assert.equal(skipped.length, 2)
  assert.match(skipped[0].reason, /no readable date/)
  assert.match(skipped[1].reason, /no readable amount/)
})

test('buildTransactions — long description goes to memo', () => {
  const longDesc = 'X'.repeat(120)
  const cols = detectColumns(['Date', 'Description', 'Amount'])
  const { transactions } = buildTransactions(
    [{ Date: '01/06/2026', Description: longDesc, Amount: '1.00' }],
    cols,
    { accountId: 'acc-1' }
  )
  assert.equal(transactions[0].payee_name.length, 50)
  assert.equal(transactions[0].memo.length, 120)
})

test('buildTransactions — uncleared when flag off', () => {
  const cols = detectColumns(['Date', 'Amount'])
  const { transactions } = buildTransactions(
    [{ Date: '01/06/2026', Amount: '1.00' }],
    cols,
    { accountId: 'acc-1', cleared: false }
  )
  assert.equal(transactions[0].cleared, 'uncleared')
})

test('summarize totals and date range', () => {
  const preview = [
    { date: '2026-06-01', dollars: -5.5 },
    { date: '2026-06-03', dollars: 2000 },
    { date: '2026-06-02', dollars: -10 },
  ]
  const s = summarize(preview)
  assert.equal(s.count, 3)
  assert.equal(s.inflow, 2000)
  assert.equal(s.outflow, -15.5)
  assert.equal(s.minDate, '2026-06-01')
  assert.equal(s.maxDate, '2026-06-03')
})

test('buildTransactions — exposes import_id on preview rows', () => {
  const cols = detectColumns(['Date', 'Description', 'Amount'])
  const { transactions, preview } = buildTransactions(
    [{ Date: '01/06/2026', Description: 'Coffee', Amount: '-5.50' }],
    cols,
    { accountId: 'acc-1' }
  )
  assert.equal(preview[0].import_id, transactions[0].import_id)
  assert.equal(preview[0].import_id, 'YNAB:-5500:2026-06-01:0')
})

test('dateInRange — inclusive bounds, open-ended when blank', () => {
  assert.equal(dateInRange('2026-06-15', '2026-06-01', '2026-06-30'), true)
  assert.equal(dateInRange('2026-06-01', '2026-06-01', '2026-06-30'), true) // lower edge
  assert.equal(dateInRange('2026-06-30', '2026-06-01', '2026-06-30'), true) // upper edge
  assert.equal(dateInRange('2026-05-31', '2026-06-01', '2026-06-30'), false)
  assert.equal(dateInRange('2026-07-01', '2026-06-01', '2026-06-30'), false)
  assert.equal(dateInRange('2021-01-01', '', '2026-06-30'), true) // no lower bound
  assert.equal(dateInRange('2030-01-01', '2026-06-01', ''), true) // no upper bound
  assert.equal(dateInRange('2026-06-15', '', ''), true) // unbounded
})
