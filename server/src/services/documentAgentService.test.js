import assert from 'node:assert/strict'
import { test } from 'node:test'
import { supportedPoints } from './documentAgentService.js'

test('document briefing accepts only exact points from named readable sources', () => {
  const citations = [
    { sourceId: 'S1', excerpt: 'Fictional deed text says the plot is in Khagrachari.' },
    { sourceId: 'S2', excerpt: 'Fictional map note says its location is approximate.' },
  ]
  assert.deepEqual(supportedPoints([{ text: 'the plot is in Khagrachari', sourceId: 'S1' }], citations),
    [{ text: 'the plot is in Khagrachari', sourceId: 'S1' }])
  assert.equal(supportedPoints([{ text: 'the plot is in Khagrachari', sourceId: 'S2' }], citations), null)
  assert.equal(supportedPoints([{ text: 'The officer has confirmed ownership.', sourceId: 'S1' }], citations), null)
  assert.equal(supportedPoints([{ text: 'the plot is in Khagrachari', sourceId: 'S3' }], citations), null)
})
