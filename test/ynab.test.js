import { test } from 'node:test'
import assert from 'node:assert/strict'
import { flattenCategories } from '../src/lib/ynab.js'

test('flattenCategories — keeps visible groups/categories, drops the rest', () => {
  const groups = [
    {
      name: 'Everyday Expenses',
      deleted: false,
      hidden: false,
      categories: [
        { id: 'c1', name: 'Groceries', hidden: false, deleted: false },
        { id: 'c2', name: 'Old Cat', hidden: true, deleted: false },
        { id: 'c3', name: 'Removed', hidden: false, deleted: true },
      ],
    },
    {
      name: 'Hidden Group',
      hidden: true,
      categories: [{ id: 'c4', name: 'Nope', hidden: false, deleted: false }],
    },
    {
      name: 'Internal Master Category',
      categories: [
        { id: 'c5', name: 'Inflow: Ready to Assign', hidden: false, deleted: false },
      ],
    },
  ]
  const out = flattenCategories(groups)
  assert.equal(out.length, 1)
  assert.equal(out[0].name, 'Everyday Expenses')
  assert.deepEqual(out[0].categories, [{ id: 'c1', name: 'Groceries' }])
})

test('flattenCategories — drops groups left with no visible categories', () => {
  const out = flattenCategories([
    { name: 'Empty', categories: [{ id: 'x', name: 'Gone', deleted: true }] },
  ])
  assert.equal(out.length, 0)
})

test('flattenCategories — handles missing/empty input', () => {
  assert.deepEqual(flattenCategories(undefined), [])
  assert.deepEqual(flattenCategories([]), [])
})
