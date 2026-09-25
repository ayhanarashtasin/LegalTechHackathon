import { getLang } from '../components/Bi.jsx'

export const apiUrl = (path) => `${(import.meta.env.VITE_API_ORIGIN || '').replace(/\/$/, '')}${path}`

// The server explains errors in English; in Bangla each error code gets a plain Bangla sentence.
const errorsBn = {
  INVALID_CREDENTIALS: 'ইউজারনেম বা পাসওয়ার্ড সঠিক নয়।',
  UNAUTHENTICATED: 'আবার সাইন ইন করুন।',
  LOGIN_RATE_LIMITED: 'অনেকবার চেষ্টা হয়েছে। কিছুক্ষণ পরে আবার চেষ্টা করুন।',
  RATE_LIMITED: 'এখন অনেক অনুরোধ আসছে। একটু পরে আবার চেষ্টা করুন।',
  FORBIDDEN: 'এই কাজের অনুমতি আপনার নেই।',
  NOT_FOUND: 'খুঁজে পাওয়া যায়নি। নম্বরটি দেখে আবার চেষ্টা করুন।',
  DEMO_ACCOUNT_NOT_FOUND: 'ডেমো অ্যাকাউন্ট পাওয়া যায়নি।',
  DEMO_AUTH_DISABLED: 'ডেমো সাইন ইন বন্ধ আছে।',
  DEMO_ACCOUNTS_NOT_SEEDED: 'ডেমো অ্যাকাউন্ট এখনো তৈরি হয়নি।',
  VALIDATION_ERROR: 'কিছু তথ্য সঠিক নয়। ঘরগুলো দেখে আবার চেষ্টা করুন।',
  BAD_REQUEST: 'দেওয়া তথ্য সঠিক নয়, অথবা অনুরোধটি খুব বড়। তথ্য দেখে আবার চেষ্টা করুন।',
  INVALID_SOURCE: 'তথ্যের উৎস সঠিক নয়।',
  INVALID_RECEIVER: 'গ্রহণকারী সঠিক নয়।',
  INVALID_OWNER: 'দায়িত্বপ্রাপ্ত ব্যক্তি এই অফিস বা ভূমিকায় সক্রিয় নন।',
  INVALID_OFFICE: 'অফিস সঠিক নয়।',
  INVALID_MEMBERS: 'মামলার তালিকা সঠিক নয়।',
  INVALID_LAWYER: 'এই অফিসের একজন সক্রিয় প্যানেল আইনজীবী বাছাই করুন।',
  INVALID_DOCUMENT: 'নথিটি সঠিক নয়।',
  INVALID_CANDIDATE: 'তুলনার রেকর্ডটি সঠিক নয়।',
  CONFLICT: 'রেকর্ডটি বদলে গেছে। রিফ্রেশ করে আবার চেষ্টা করুন।',
  IDEMPOTENCY_CONFLICT: 'একই অনুরোধ আগে ভিন্ন তথ্যে পাঠানো হয়েছে।',
  CASE_REQUIRED: 'আগে আবেদন গ্রহণ করে মামলা নম্বর তৈরি করুন।',
  CASE_TYPE_REQUIRED: 'আগে মামলার ধরন লিখুন।',
  ACCEPTED_CASES_REQUIRED: 'শুধু গৃহীত মামলা যুক্ত করা যায়।',
  STALE_BRIEFING: 'নথি বদলে গেছে। সারসংক্ষেপ আবার তৈরি করুন।',
  STALE_TRIAGE: 'আবেদনের তথ্য বদলেছে। নতুন তথ্য দিয়ে প্রাথমিক পর্যালোচনা আবার করুন।',
  STALE_TRIAGE_INPUT: 'আবেদনের তথ্য বদলেছে। নতুন তথ্য দিয়ে প্রাথমিক পর্যালোচনা আবার করুন।',
  REVIEW_REQUIRED: 'গ্রহণের আগে পর্যালোচনা সম্পন্ন করুন।',
  OVERRIDE_REQUIRED: 'সিদ্ধান্ত বদলাতে কারণ লিখুন।',
  NO_CHANGE: 'ভিন্ন একটি সিদ্ধান্ত বাছাই করুন।',
  INVALID_TRANSITION: 'এই ধাপে এই কাজ করা যায় না।',
  CHANGE_REVIEW_REQUIRED: 'আগে বদলের অনুরোধ পর্যালোচনা করুন।',
  CHANGE_REQUEST_STALE: 'অনুমোদিত বদলের অনুরোধটি আর নেই।',
  REQUEST_ALREADY_OPEN: 'আগের অনুরোধটির সিদ্ধান্ত এখনো বাকি।',
  ASSIGNMENT_REQUIRED: 'আগে একজন আইনজীবী নিযুক্ত করুন।',
  ASSIGNMENT_PENDING: 'আইনজীবীর উত্তরের অপেক্ষা চলছে।',
  NO_ACTIVE_LAWYER: 'এই মামলায় সক্রিয় আইনজীবী নেই।',
  LAWYER_ON_HOLD: 'এই আইনজীবীকে আপাতত নতুন মামলা দেওয়া যাচ্ছে না।',
  HOLD_CLOSED: 'পর্যালোচনার মতো কোনো স্থগিতাদেশ নেই।',
  UPDATE_CLOSED: 'এই অগ্রগতির তথ্য জমা দেওয়ার সুযোগ এখন বন্ধ।',
  UPDATE_NOT_OVERDUE: 'শুধু সময় পেরিয়ে যাওয়া, এখনো জমা না পড়া আপডেটের জন্য অনুরোধ করা যায়।',
  REMINDER_RECENT: 'গত ২৪ ঘণ্টার মধ্যে এই আপডেটের জন্য আইনজীবীকে একবার মনে করানো হয়েছে।',
  ALREADY_REVIEWED: 'এটি আগেই পর্যালোচনা হয়েছে।',
  ALREADY_ACCEPTED: 'এটি আগেই গৃহীত হয়েছে।',
  ALREADY_STORED: 'এটি আগেই সংরক্ষিত।',
  ALREADY_SHARED: 'এটি আগেই ভাগ করা হয়েছে।',
  UNSAFE_CONTACT: 'এই যোগাযোগ পথ নিরাপদ নয়।',
  EVIDENCE_NOT_SHAREABLE: 'এই প্রমাণ ভাগ করা যায় না।',
  READABLE_EVIDENCE_REQUIRED: 'শুধু পাঠযোগ্য সাধারণ নথি ভাগ করা যায়।',
  ROUTING_DECISION_REQUIRED: 'কোন অফিসে যাবে, আগে সেই সিদ্ধান্ত নথিভুক্ত করুন।',
  ROUTING_DECISION_NOT_DUE: 'দুইবার ফেরত আসার পর খোলা এসকেলেশন থাকলেই নতুন রুটিং সিদ্ধান্ত নেওয়া যাবে।',
  ROUTE_RETAINED: 'সিদ্ধান্ত অনুযায়ী মামলাটি এই অফিসেই থাকবে।',
  ROUTE_MISMATCH: 'যে অফিস নির্বাচন করা হয়েছে, রেফারেলটি সেখানেই পাঠাতে হবে।',
  REFERRAL_ACTIVE: 'আগে পাঠানো রেফারেলটির জবাব এখনো আসেনি।',
  NOT_A_CANDIDATE: 'এটি তুলনার তালিকায় নেই।',
  NO_PROPOSAL: 'আগে একটি প্রস্তাব তৈরি করুন।',
  CONFLICT_NOT_OPEN: 'এই বিরোধ আর খোলা নেই।',
  VOICE_AI_UNAVAILABLE: 'এখন বলা উত্তরটি বোঝার সেবা পাওয়া যাচ্ছে না। লিখে উত্তর দিন।',
  INTERNAL_ERROR: 'অনুরোধটি সম্পন্ন হয়নি। আবার চেষ্টা করুন।',
}

export async function api(path, { token, body, audio, headers, signal, method = 'GET' } = {}) {
  const response = await fetch(apiUrl(path), {
    method,
    signal,
    cache: 'no-store',
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(audio ? { 'content-type': audio.type } : {}),
      ...headers,
    },
    body: audio ?? (body ? JSON.stringify(body) : undefined),
  })
  if (response.status === 204) return null
  const data = await response.json()
  if (!response.ok) {
    const english = data.error?.message || 'The request failed. Please try again.'
    const error = new Error(getLang() === 'bn' ? errorsBn[data.error?.code] || 'অনুরোধটি সম্পন্ন হয়নি। আবার চেষ্টা করুন।' : english)
    error.status = response.status
    error.code = data.error?.code
    error.data = data
    throw error
  }
  return data
}
