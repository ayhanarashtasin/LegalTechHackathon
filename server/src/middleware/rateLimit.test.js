import assert from 'node:assert/strict'
import test from 'node:test'
import { limitPublic } from './rateLimit.js'

test('public limiter bounds per-IP memory and evicts the oldest bucket', () => {
  const limit = limitPublic(1)
  const allowed = (ip) => {
    let passed = false
    try { limit({ ip }, {}, () => { passed = true }) } catch (error) { assert.equal(error.status, 429) }
    return passed
  }

  assert.equal(allowed('first-ip'), true)
  for (let index = 1; index < 4096; index += 1) assert.equal(allowed(`ip-${index}`), true)
  assert.equal(allowed('new-ip'), true)
  assert.equal(allowed('first-ip'), true)
})

test('each public route counts its own requests', () => {
  const answers = limitPublic(2)
  const intakes = limitPublic(1)
  const passes = (limit) => {
    try { let passed = false; limit({ ip: 'caller' }, {}, () => { passed = true }); return passed } catch (error) { assert.equal(error.status, 429); return false }
  }

  assert.equal(passes(answers), true)
  assert.equal(passes(answers), true)
  assert.equal(passes(answers), false)
  assert.equal(passes(intakes), true)
  assert.equal(passes(intakes), false)
})
