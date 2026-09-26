// Intake script: one approved question at a time, each played as a recorded clip like an IVR line. The caller
// answers by voice (voiceAgent.js) or by choosing/typing; both build the same payload the server re-validates.
// Two paths follow the first choice: a complaint (full intake for DLAO review) or information/advice (a callback).
const yesNo = [[true, 'হ্যাঁ', 'Yes'], [false, 'না', 'No']]
// What a number must look like once typed on the keypad or said and read back.
export const PHONE_DIGITS = /^\+?[0-9]{6,20}$/
export const NID_DIGITS = /^(?:[0-9]{10}|[0-9]{13}|[0-9]{17})$/

export const steps = {
  service: { labelEn: 'Service', label: 'সেবা', prompt: 'আপনি কি আইনগত কোনো অভিযোগ জানাতে চান, নাকি আইনগত তথ্য ও পরামর্শ নিতে চান?', en: 'Do you want to make a legal complaint, or get legal information and advice?', choices: [['COMPLAINT', 'অভিযোগ', 'Complaint'], ['ADVICE', 'তথ্য বা পরামর্শ', 'Information or advice']] },
  adviceTopic: { labelEn: 'Question', label: 'প্রশ্ন', prompt: 'আপনি কোন বিষয়ে আইনগত তথ্য বা পরামর্শ চান?', en: 'What do you need legal information or advice about?', min: 5, max: 2000, long: true },
  callerRole: { labelEn: 'Complaining for', label: 'কার জন্য অভিযোগ', prompt: 'আপনি কি নিজের জন্য অভিযোগ করছেন, নাকি অন্য কারও প্রতিনিধি হিসেবে যোগাযোগ করছেন?', en: 'Are you complaining for yourself, or contacting us on someone else’s behalf?', choices: [['SELF', 'নিজের জন্য', 'For myself'], ['REPRESENTATIVE', 'প্রতিনিধি হিসেবে', 'As a representative']] },
  callerName: { labelEn: 'Your full name', label: 'আপনার পূর্ণ নাম', prompt: 'আপনার পূর্ণ নাম কী?', en: 'What is your full name?', max: 120 },
  relationship: { labelEn: 'Relationship', label: 'সম্পর্ক', prompt: 'যাঁর পক্ষে যোগাযোগ করছেন, তিনি আপনার কী হন?', en: 'How are you related to the person you are contacting us for?', max: 80 },
  applicantName: { labelEn: 'Victim’s full name', label: 'ভুক্তভোগীর পূর্ণ নাম', prompt: 'যাঁর পক্ষে যোগাযোগ করছেন, সেই ভুক্তভোগীর পূর্ণ নাম কী?', en: 'What is the full name of the person you are contacting us for?', max: 120 },
  district: { labelEn: 'District', label: 'জেলা', prompt: 'আপনার জেলার নাম কী? প্রতিনিধি হলে ভুক্তভোগীর জেলা বলুন।', en: 'Which district do you live in? For someone else, give their district.', max: 60 },
  nidKnown: { labelEn: 'NID known', label: 'এনআইডি নম্বর জানা', prompt: 'জাতীয় পরিচয়পত্র বা NID নম্বর কি জানা আছে?', en: 'Do you know the national ID (NID) number?', choices: yesNo },
  nid: { labelEn: 'NID number', label: 'এনআইডি নম্বর', prompt: 'NID নম্বরটি কত?', en: 'What is the NID number?', digits: NID_DIGITS },
  problem: { labelEn: 'Complaint', label: 'অভিযোগ', prompt: 'অভিযোগটি সংক্ষেপে বলুন: কী ঘটেছে, কখন, কোথায় এবং কারা জড়িত?', en: 'Briefly describe the complaint: what happened, when, where, and who was involved?', min: 5, max: 2000, long: true },
  urgent: { labelEn: 'Safety risk', label: 'নিরাপত্তা ঝুঁকি', prompt: 'আপনি বা ভুক্তভোগী কি এখন কোনো হুমকি, সহিংসতা বা নিরাপত্তা ঝুঁকির মধ্যে আছেন?', en: 'Are you, or the person you are calling for, under any threat, violence, or safety risk right now?', choices: [...yesNo, ['UNKNOWN', 'নিশ্চিত নই—কর্মকর্তা যাচাই করবেন', 'Not sure—an officer will check']] },
  contactChannel: { labelEn: 'Contact route', label: 'যোগাযোগের মাধ্যম', prompt: 'কোন মাধ্যমে যোগাযোগ করা নিরাপদ ও সুবিধাজনক?', en: 'Which way of contacting you is safe and convenient?', choices: [['PHONE', 'ফোন', 'Phone call'], ['UDC', 'ইউডিসি', 'Through a UDC office'], ['TRUSTED_PERSON', 'বিশ্বস্ত ব্যক্তি', 'Through a trusted person']] },
  contactValue: { labelEn: 'Safe number', label: 'নিরাপদ নম্বর', prompt: 'কোন ফোন নম্বরে ফোন করা নিরাপদ?', en: 'Which phone number is safe to call?', digits: PHONE_DIGITS },
  trustedPerson: { labelEn: 'Trusted person', label: 'বিশ্বস্ত ব্যক্তি', prompt: 'যাঁর মাধ্যমে যোগাযোগ করব, তাঁর নাম কী এবং তিনি আপনার কী হন?', en: 'Who should we contact you through, and how are they related to you?', max: 160 },
  trustedPhone: { labelEn: 'Trusted person’s number', label: 'বিশ্বস্ত ব্যক্তির নম্বর', prompt: 'তাঁর ফোন নম্বর কত?', en: 'What is their phone number?', digits: PHONE_DIGITS },
  safeTime: { labelEn: 'Safe time', label: 'নিরাপদ সময়', prompt: 'কোন সময়ে যোগাযোগ করা নিরাপদ?', en: 'When is it safe to make contact?', max: 100 },
}

const advice = (answers) => answers.service === 'ADVICE'
const complaint = (answers) => answers.service === 'COMPLAINT'
const representative = (answers) => complaint(answers) && answers.callerRole === 'REPRESENTATIVE'
const trusted = (answers) => complaint(answers) && answers.contactChannel === 'TRUSTED_PERSON'
// One ordered list for both paths; each question asks only when its condition holds.
const flow = [['service'], ['adviceTopic', advice],
  ['callerRole', complaint], ['callerName', complaint], ['relationship', representative], ['applicantName', representative],
  ['district', complaint], ['nidKnown', complaint], ['nid', (answers) => complaint(answers) && answers.nidKnown === true],
  ['problem', complaint], ['urgent', complaint], ['contactChannel', complaint],
  ['contactValue', (answers) => advice(answers) || (complaint(answers) && answers.contactChannel === 'PHONE') || Boolean(answers.contactValue)],
  ['trustedPerson', trusted], ['trustedPhone', trusted], ['safeTime', (answers) => answers.service !== undefined]]

export const startCall = () => ({ answers: {}, previous: {}, corrected: [], aiFields: [], safetyNoPending: false })
export const modeOf = (call) => (advice(call.answers) ? 'ADVICE' : 'INTAKE')
export const activeFields = (call) => flow.filter(([, applies]) => !applies || applies(call.answers)).map(([field]) => field)
export const nextField = (call) => activeFields(call).find((field) => call.answers[field] === undefined)
export const displayValue = (call, field) => steps[field].choices?.find(([value]) => value === call.answers[field])?.[1] ?? call.answers[field]

// Recorded messages that play once, before whatever is asked next: the greeting, the advice notice once advice is
// chosen, the UDC advice once the NID is unknown, and the 999 safety message once a current risk is reported.
export const notices = (call) => ['greeting',
  advice(call.answers) && 'adviceIntro', call.answers.nidKnown === false && 'nidUnknown', (call.answers.urgent === true || call.answers.urgent === 'UNKNOWN') && 'safetyAlert',
].filter(Boolean)

// `via` keeps provenance honest: answers the live model extracted are listed in aiFields for the server to flag.
export function answer(call, field, value, via = 'CALLER') {
  const changed = call.answers[field] !== undefined && call.answers[field] !== value
  return {
    ...call,
    answers: { ...call.answers, [field]: value },
    corrected: changed ? [...new Set([...call.corrected, field])] : call.corrected,
    aiFields: via === 'AI' ? [...new Set([...call.aiFields, field])] : call.aiFields.filter((item) => item !== field),
    safetyNoPending: field === 'urgent' ? false : call.safetyNoPending,
  }
}

export function correct(call, field) {
  const { [field]: previous, ...answers } = call.answers
  return { ...call, answers, previous: { ...call.previous, [field]: previous }, corrected: [...new Set([...call.corrected, field])], safetyNoPending: field === 'urgent' ? false : call.safetyNoPending }
}

// The first choice travels as `mode`; every other active answer is sent for the server to validate again.
export function payload(call, { confirmation = 'BUTTON', transcript = [] } = {}) {
  const fields = activeFields(call).filter((field) => field !== 'service')
  const answers = Object.fromEntries(fields.map((field) => [field, call.answers[field]]))
  if (call.answers.contactValue && !answers.contactValue) {
    answers.contactValue = call.answers.contactValue
  }
  return {
    mode: modeOf(call),
    confirmation,
    // The model may flag possible danger in the caller's words; only a human acts on it.
    ...(call.aiSensitive ? { aiSensitive: true } : {}),
    answers,
    correctedFields: call.corrected.filter((field) => fields.includes(field)),
    aiFields: call.aiFields.filter((field) => fields.includes(field)),
    // The whole call is recorded under the greeting's notice, so its transcript is kept with it.
    ...(transcript.length ? { transcript } : {}),
  }
}
