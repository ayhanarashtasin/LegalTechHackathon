// Controlled fictional references for the T7 demonstration. These are not approved legal clauses.
export const settlementTemplates = Object.freeze({
  MAINTENANCE: {
    revision: 'demo-1',
    title: 'Maintenance settlement draft',
    example: 'Party A and Party B record the maintenance arrangement, the amount and interval, the first due date, the payment method, and a review date. A mediator must complete every missing fact.',
    exampleBn: 'পক্ষ ক ও পক্ষ খ (প্রথম পক্ষ ও দ্বিতীয় পক্ষ) ভরণপোষণের বিবরণ, অর্থের পরিমাণ ও কিস্তির সময়সূচি, প্রথম পরিশোধের তারিখ, পরিশোধের মাধ্যম এবং পরবর্তী পর্যালোচনার তারিখ লিপিবদ্ধ করেন। বাকি কোনো তথ্য থাকলে তা মধ্যস্থতাকারী পূরণ ও নিশ্চিত করবেন।',
    fields: [
      ['arrangement', 'Maintenance arrangement'], ['amount', 'Amount and interval'],
      ['firstDueDate', 'First due date'], ['paymentMethod', 'Payment method'], ['reviewDate', 'Review date'],
    ],
    dateOrder: ['firstDueDate', 'reviewDate'],
  },
  PROPERTY: {
    revision: 'demo-1',
    title: 'Property settlement draft',
    example: 'Party A and Party B record the property in dispute, each proposed step, who will perform it, its completion date, and the follow-up date. A mediator must complete every missing fact.',
    exampleBn: 'পক্ষ ক ও পক্ষ খ (প্রথম পক্ষ ও দ্বিতীয় পক্ষ) বিরোধপূর্ণ সম্পত্তি, প্রস্তাবিত পদক্ষেপসমূহ, বাস্তবায়নে দায়িত্বপ্রাপ্ত পক্ষ, সম্পন্নের নির্ধারিত তারিখ এবং পরবর্তী পর্যালোচনার তারিখ লিপিবদ্ধ করেন। বাকি কোনো তথ্য থাকলে তা মধ্যস্থতাকারী পূরণ ও নিশ্চিত করবেন।',
    fields: [
      ['propertyDescription', 'Property description'], ['proposedSteps', 'Proposed steps'],
      ['responsibleParty', 'Responsible party for each step'], ['completionDate', 'Completion date'], ['followUpDate', 'Follow-up date'],
    ],
    dateOrder: ['completionDate', 'followUpDate'],
  },
  LABOUR: {
    revision: 'demo-1',
    title: 'Labour settlement draft',
    example: 'Party A and Party B record the work or wage issue, any amount agreed, the payment schedule, the due date, and the follow-up date. A mediator must complete every missing fact.',
    exampleBn: 'পক্ষ ক ও পক্ষ খ (প্রথম পক্ষ ও দ্বিতীয় পক্ষ) কাজ বা বকেয়া মজুরি-সংক্রান্ত বিরোধ, সম্মত অর্থের পরিমাণ (যদি থাকে), পরিশোধের সময়সূচি, পরিশোধের শেষ তারিখ এবং পরবর্তী পর্যালোচনার তারিখ লিপিবদ্ধ করেন। বাকি কোনো তথ্য থাকলে তা মধ্যস্থতাকারী পূরণ ও নিশ্চিত করবেন।',
    fields: [
      ['workDescription', 'Work or wage issue recorded'], ['amount', 'Amount, if recorded'],
      ['paymentSchedule', 'Payment schedule, if recorded'], ['dueDate', 'Due date'], ['followUpDate', 'Follow-up date'],
    ],
    dateOrder: ['dueDate', 'followUpDate'],
  },
})

export const missingSettlementFact = 'Not recorded in the mediator notes; mediator completion required.'

export function isMissingSettlementFact(value) {
  return typeof value === 'string' && value.trim().toLowerCase().startsWith('not recorded in the mediator notes')
}

function oneValidDate(value) {
  const matches = String(value ?? '').match(/\b\d{4}-\d{2}-\d{2}\b/g)
  if (matches?.length !== 1) return null
  const candidate = matches[0]
  const timestamp = Date.parse(`${candidate}T00:00:00Z`)
  return !Number.isNaN(timestamp) && new Date(timestamp).toISOString().startsWith(candidate) ? candidate : null
}

export function settlementInconsistencies(template, sections, aiWarnings = []) {
  if (!Object.hasOwn(settlementTemplates, template)) return []
  const definition = settlementTemplates[template]
  const values = new Map(sections.map(({ key, text }) => [key, text]))
  const warnings = aiWarnings.filter((warning) => typeof warning === 'string' && warning.trim()).map((warning) => warning.trim())
  for (const [key, label] of definition.fields) {
    if (isMissingSettlementFact(values.get(key))) warnings.push(`${label} is missing; the mediator must complete and confirm it.`)
  }
  const [firstKey, laterKey] = definition.dateOrder
  const first = oneValidDate(values.get(firstKey))
  const later = oneValidDate(values.get(laterKey))
  if (first && later && later < first) {
    const firstLabel = definition.fields.find(([key]) => key === firstKey)[1]
    const laterLabel = definition.fields.find(([key]) => key === laterKey)[1]
    warnings.push(`${laterLabel} (${later}) comes before ${firstLabel} (${first}); the mediator must confirm both dates.`)
  }
  return [...new Set(warnings)].slice(0, 12)
}
