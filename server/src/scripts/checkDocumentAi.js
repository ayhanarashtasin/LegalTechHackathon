import { summarizeDocuments } from '../services/ai/groq.js'
import { supportedPoints } from '../services/documentAgentService.js'

const citations = [
  { sourceId: 'S1', label: 'Fictional identity note', version: 1, line: 1, excerpt: 'Fictional identity note for Nuching Marma.' },
  { sourceId: 'S2', label: 'Fictional plot note', version: 1, line: 1, excerpt: 'Fictional plot location is a village in Khagrachari.' },
]

try {
  const points = await summarizeDocuments(citations)
  if (!supportedPoints(points, citations)) throw new Error('The provider returned unsupported points or source IDs.')
  console.log(`Document AI check passed: ${points.length} exact cited point${points.length === 1 ? '' : 's'}.`)
} catch (error) {
  console.error(`Document AI check failed: ${error.message}`)
  process.exitCode = 1
}
