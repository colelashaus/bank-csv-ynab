import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeDesc,
  descriptionLike,
  daysApart,
  findDuplicates,
  dedupeSummary,
} from '../src/lib/dedupe.js'

// Helpers to build transaction-shaped objects.
const nt = (date, amount, payee = '', memo = '', import_id = '') => ({
  date,
  amount,
  payee_name: payee,
  memo,
  import_id,
})

test('normalizeDesc lowercases and strips punctuation', () => {
  assert.equal(normalizeDesc('  WOOLWORTHS  Metro #123! '), 'woolworths metro 123')
  assert.equal(normalizeDesc(null), '')
})

test('descriptionLike — substring either direction', () => {
  assert.ok(descriptionLike('Woolworths', 'WOOLWORTHS METRO SYDNEY 1234'))
  assert.ok(descriptionLike('Coffee Supreme Pty Ltd', 'coffee supreme'))
})

test('descriptionLike — token overlap fallback', () => {
  assert.ok(descriptionLike('ACME Pty Ltd Salary', 'Salary ACME Limited'))
})

test('descriptionLike — unrelated text is not alike', () => {
  assert.equal(descriptionLike('Woolworths Metro', 'Shell Petrol Station'), false)
  assert.equal(descriptionLike('', 'anything'), false)
})

test('daysApart counts whole days', () => {
  assert.equal(daysApart('2026-06-01', '2026-06-01'), 0)
  assert.equal(daysApart('2026-06-01', '2026-06-04'), 3)
  assert.equal(daysApart('2026-06-04', '2026-06-01'), 3)
})

test('findDuplicates — exact import_id is a definite duplicate', () => {
  const existing = [nt('2026-06-01', -4530, 'Woolworths', '', 'YNAB:-4530:2026-06-01:0')]
  const incoming = [nt('2026-06-01', -4530, 'Woolworths', '', 'YNAB:-4530:2026-06-01:0')]
  const r = findDuplicates(incoming, existing, { windowDays: 3 })
  assert.equal(r[0].status, 'duplicate')
  assert.equal(r[0].confidence, 'exact')
})

test('findDuplicates — same amount+date+desc = high confidence', () => {
  const existing = [nt('2026-06-01', -4530, 'Woolworths Metro')]
  const incoming = [nt('2026-06-01', -4530, 'WOOLWORTHS METRO SYDNEY 1234')]
  const r = findDuplicates(incoming, existing)
  assert.equal(r[0].status, 'duplicate')
  assert.equal(r[0].confidence, 'high')
})

test('findDuplicates — amount+date within window, different desc = low', () => {
  const existing = [nt('2026-06-02', -2000, 'Shell Petrol')]
  const incoming = [nt('2026-06-01', -2000, 'Random Cafe')]
  const r = findDuplicates(incoming, existing, { windowDays: 3 })
  assert.equal(r[0].status, 'duplicate')
  assert.equal(r[0].confidence, 'low') // matched on amount+date only, date differs
})

test('findDuplicates — outside the date window is new', () => {
  const existing = [nt('2026-06-01', -2000, 'Shell Petrol')]
  const incoming = [nt('2026-06-20', -2000, 'Shell Petrol')]
  const r = findDuplicates(incoming, existing, { windowDays: 3 })
  assert.equal(r[0].status, 'new')
})

test('findDuplicates — one-to-one: 1 existing absorbs only 1 of 2 identicals', () => {
  const existing = [nt('2026-06-01', -550, 'Coffee')]
  const incoming = [
    nt('2026-06-01', -550, 'Coffee'),
    nt('2026-06-01', -550, 'Coffee'),
  ]
  const r = findDuplicates(incoming, existing, { windowDays: 3 })
  const dups = r.filter((x) => x.status === 'duplicate').length
  const fresh = r.filter((x) => x.status === 'new').length
  assert.equal(dups, 1)
  assert.equal(fresh, 1)
})

test('findDuplicates — deleted existing transactions are ignored', () => {
  const existing = [{ ...nt('2026-06-01', -550, 'Coffee'), deleted: true }]
  const incoming = [nt('2026-06-01', -550, 'Coffee')]
  const r = findDuplicates(incoming, existing)
  assert.equal(r[0].status, 'new')
})

test('findDuplicates — different amount is never a duplicate', () => {
  const existing = [nt('2026-06-01', -550, 'Coffee')]
  const incoming = [nt('2026-06-01', -560, 'Coffee')]
  const r = findDuplicates(incoming, existing)
  assert.equal(r[0].status, 'new')
})

test('dedupeSummary counts correctly', () => {
  const results = [
    { status: 'duplicate' },
    { status: 'new' },
    { status: 'duplicate' },
  ]
  const s = dedupeSummary(results)
  assert.deepEqual(s, { total: 3, duplicates: 2, fresh: 1 })
})
