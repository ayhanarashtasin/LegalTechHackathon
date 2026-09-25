import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canonicalSettlement as clientCanonicalSettlement } from '../../../client/src/utils/settlementCrypto.js'
import { canonicalSettlement as serverCanonicalSettlement } from './settlementCrypto.js'
import { isMissingSettlementFact, settlementInconsistencies, settlementTemplates } from './settlementTemplates.js'

test('fictional settlement references define all three controlled draft shapes', () => {
  assert.deepEqual(Object.keys(settlementTemplates), ['MAINTENANCE', 'PROPERTY', 'LABOUR'])
  for (const definition of Object.values(settlementTemplates)) {
    assert.equal(definition.revision, 'demo-1')
    assert.ok(definition.example.includes('Party A and Party B'))
    assert.ok(definition.exampleBn.includes('পক্ষ ক ও পক্ষ খ'))
    assert.equal(definition.fields.length, 5)
    assert.equal(new Set(definition.fields.map(([key]) => key)).size, 5)
  }
})

test('date contradictions and missing facts are flagged without relying on AI warnings', () => {
  const examples = [
    ['MAINTENANCE', 'firstDueDate', 'reviewDate'],
    ['PROPERTY', 'completionDate', 'followUpDate'],
    ['LABOUR', 'dueDate', 'followUpDate'],
  ]
  for (const [template, firstKey, laterKey] of examples) {
    const sections = settlementTemplates[template].fields.map(([key]) => ({ key, text: key === firstKey ? '2026-10-20' : key === laterKey ? '2026-10-10' : 'Fictional agreed detail' }))
    assert.match(settlementInconsistencies(template, sections)[0], /comes before/)
    sections.find(({ key }) => key === laterKey).text = '2026-10-30'
    assert.deepEqual(settlementInconsistencies(template, sections), [])
    sections.find(({ key }) => key === firstKey).text = 'Not recorded in the mediator notes; mediator completion required.'
    assert.equal(isMissingSettlementFact(sections.find(({ key }) => key === firstKey).text), true)
    assert.match(settlementInconsistencies(template, sections)[0], /missing/)
  }
})

test('the browser and server sign the same template revision and draft sections', () => {
  const draft = {
    id: 'fictional-draft-id', version: 2, template: 'PROPERTY', templateRevision: 'demo-1',
    sections: settlementTemplates.PROPERTY.fields.map(([key, label]) => ({ key, label, text: 'Fictional reviewed value', aiFilled: false })),
  }
  assert.equal(clientCanonicalSettlement(draft), serverCanonicalSettlement(draft))
  assert.match(clientCanonicalSettlement(draft), /"templateRevision":"demo-1"/)
})
