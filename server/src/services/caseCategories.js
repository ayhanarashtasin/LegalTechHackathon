// The case category the applicant chose on the digital form. Each one only decides what is put in front of the
// officer (a flag, a restricted default, a task); none of them accepts, rejects or routes a case by itself, apart
// from "advice only", which the applicant chose as a request for information rather than a case.
// Demo rules: which categories are sensitive or urgent still await law-team approval.
export const CASE_CATEGORIES = {
  FAMILY_DOMESTIC: { sensitive: true, urgencyReview: true },
  ONLINE_HARASSMENT: { sensitive: true, urgent: true, restricted: true },
  MAINTENANCE: {},
  MARRIAGE_DIVORCE: {},
  INHERITANCE: {},
  LAND_PROPERTY: {},
  LABOUR_WAGE: { groupLinkable: true },
  CRIMINAL_AID: { sensitive: true, restricted: true },
  CHILD_CUSTODY: { sensitive: true },
  FINANCIAL_FRAUD: {},
  ADVICE_ONLY: { advice: true },
  OTHER: { needsCategory: true },
}

// Fixed words, not an AI guess: a description that names non-consensual imagery or online harassment gets the same
// visible flag and restricted evidence as choosing that category. The officer still decides the priority.
// ponytail: demo word list; the law team should own and extend it.
const HARASSMENT_WORDS = [
  /non[- ]?consensual/i, /intimate (image|photo|picture|video)s?/i, /nude|naked/i, /leak(ed)? (my )?(photo|picture|video|image)s?/i,
  /revenge porn/i, /sextortion/i, /morph(ed)? (photo|picture|image)s?/i, /cyber ?(harass|bully|stalk)/i, /online harass/i,
  /আপত্তিকর ছবি|অশ্লীল ছবি|নগ্ন ছবি|গোপন ছবি|গোপন ভিডিও|ছবি ফাঁস|ভিডিও ফাঁস|ছবি ভাইরাল|ভিডিও ভাইরাল|অনলাইনে হয়রানি|সাইবার হয়রানি|ফেসবুকে ছবি/,
]
export const mentionsOnlineHarassment = (text) => HARASSMENT_WORDS.some((word) => word.test(String(text ?? '')))

export const isCaseCategory = (code) => Object.hasOwn(CASE_CATEGORIES, code)
const rules = (code) => (isCaseCategory(code) ? CASE_CATEGORIES[code] : {})

// Joins the existing "why flagged" list, so the officer still makes the priority decision.
export function categoryUrgencyReason(code, keywordMatch = false) {
  const rule = rules(code)
  if (!rule.urgent && keywordMatch) return 'The description mentions non-consensual imagery / online harassment: sensitive and urgent.'
  if (rule.urgent) return 'The applicant chose online harassment / non-consensual imagery: sensitive and urgent.'
  if (rule.urgencyReview) return 'The applicant chose a family / domestic dispute: sensitive, review urgency.'
  return null
}

// Signals shown with the other "weigh first" items on the record and in the DLAO queue.
export function categorySignals(code, keywordMatch = false) {
  const rule = rules(code)
  return [
    (rule.sensitive || keywordMatch) && 'SENSITIVE_CATEGORY',
    (rule.restricted || keywordMatch) && 'RESTRICTED_CATEGORY',
    rule.groupLinkable && 'GROUP_CLAIM_POSSIBLE',
    rule.needsCategory && 'CATEGORY_NEEDED',
  ].filter(Boolean)
}
