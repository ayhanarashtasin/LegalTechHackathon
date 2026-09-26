import { useState, useSyncExternalStore } from 'react'

// Every screen renders in one language, English or Bangla, picked with the switch in the header.
const words = {
  // Application, review, priority, identity
  SUBMITTED: ['Submitted', 'জমা হয়েছে'], ACCEPTED: ['Accepted', 'গৃহীত'],
  CLOSED: ['Completed', 'সমাপ্ত'], JUDGMENT: ['Judgment', 'রায়'], DISMISSED: ['Dismissed', 'খারিজ'],
  PENDING_REVIEW: ['Pending review', 'পর্যালোচনা বাকি'], NEEDS_INFORMATION: ['Needs information', 'আরও তথ্য দরকার'],
  READY_FOR_DECISION: ['Ready for decision', 'সিদ্ধান্তের জন্য প্রস্তুত'],
  URGENT: ['Urgent', 'জরুরি'], ROUTINE: ['Routine', 'সাধারণ'],
  INCOMPLETE: ['Incomplete', 'অসম্পূর্ণ'], VERIFIED: ['Verified', 'যাচাইকৃত'], REVOKED: ['Revoked', 'বাতিল'], PENDING: ['Pending', 'অপেক্ষমাণ'],
  // Channels and contact
  VOICE_SIM: ['16699 voice', '১৬৬৯৯-এ ফোন'], HELPLINE_SIM: ['Helpline', 'হেল্পলাইন'], UDC: ['UDC assisted', 'ইউডিসির সহায়তায়'],
  DLAO: ['DLAO office', 'জেলা লিগ্যাল এইড অফিস'], WEB: ['Web', 'ওয়েব'], PHONE: ['Phone', 'ফোন'], SMS: ['SMS', 'এসএমএস'], IN_PERSON: ['In person', 'সরাসরি'],
  REMOTE: ['Remote', 'অনলাইনে'], HYBRID: ['Hybrid', 'হাইব্রিড (সরাসরি ও অনলাইন)'],
  BLOCKED_UNSAFE: ['Blocked: unsafe', 'নিরাপদ নয়, যোগাযোগ বন্ধ'], NO_ANSWER: ['No answer', 'কেউ ফোন ধরেননি'],
  UNKNOWN_PERSON: ['Someone else answered', 'অন্য ব্যক্তি ধরেছেন'], APPLICANT_REACHED: ['Applicant reached', 'আবেদনকারীর সাথে কথা হয়েছে'], DISCLOSED: ['Yes, disclosed', 'হ্যাঁ, জানানো হয়েছে'],
  DISCLOSE_NOTHING: ['Say nothing about the case', 'মামলার কোনো তথ্য জানাবেন না'], APPROVED_NEUTRAL_ONLY: ['Approved neutral words only', 'শুধু অনুমোদিত সাধারণ কথা বলুন'],
  // Roles
  DLAO_OFFICER: ['DLAO officer', 'জেলা লিগ্যাল এইড কর্মকর্তা'], CASE_SUPPORT: ['Case support', 'মামলা সহায়তা সহকারী'], MEDIATOR: ['Mediator', 'মধ্যস্থতাকারী'],
  RECEIVING_DLAO: ['Receiving DLAO', 'গ্রহণকারী ডিএলএও'], HELPLINE_AGENT: ['Helpline agent', 'হেল্পলাইন কর্মী'], UDC_OPERATOR: ['UDC operator', 'ইউডিসি অপারেটর'],
  PANEL_LAWYER: ['Panel lawyer', 'প্যানেল আইনজীবী'], CLAO: ['CLAO', 'সিএলএও'], SYSTEM: ['System', 'সিস্টেম'],
  // Tasks, documents, access
  OPEN: ['Open', 'চলমান'], DONE: ['Done', 'সম্পন্ন'], READABLE: ['Readable', 'পাঠযোগ্য'], UNREADABLE: ['Unreadable', 'অস্পষ্ট বা অপাঠ্য'],
  STANDARD: ['Standard', 'সাধারণ'], RESTRICTED: ['Restricted', 'সংরক্ষিত/গোপনীয়'], GRANTED: ['Granted', 'অনুমতি দেওয়া হয়েছে'], DENIED: ['Denied', 'অনুমতি নেই'],
  PROPOSED: ['Proposed', 'প্রস্তাবিত'], APPROVED: ['Approved', 'অনুমোদিত'], DECLINED: ['Declined', 'প্রত্যাখ্যাত'], COMPLETED: ['Completed', 'সম্পন্ন'],
  // Facts
  APPLICANT_REPORTED: ['Applicant reported', 'আবেদনকারী জানিয়েছেন'], APPLICANT_CONFIRMED: ['Applicant confirmed', 'আবেদনকারী নিশ্চিত করেছেন'],
  REPRESENTATIVE_REPORTED: ['Representative reported', 'প্রতিনিধি জানিয়েছেন'], INTERMEDIARY_TRANSLATED: ['Translated by helper', 'সহায়তাকারী অনুবাদ করেছেন'],
  INTERMEDIARY_TYPED: ['Typed by helper', 'সহায়তাকারী লিখেছেন'], STAFF_ENTERED: ['Staff entered', 'কর্মী নথিভুক্ত করেছেন'], DOCUMENT_EXTRACTED: ['From document', 'নথি থেকে নেওয়া'],
  AI_INFERRED: ['AI inferred', 'এআইয়ের অনুমান'], UNKNOWN_OR_UNVERIFIED: ['Unverified', 'যাচাই হয়নি'],
  VOICE: ['Voice', 'ভয়েস'], TYPED: ['Typed', 'টাইপ করা'], TRANSLATED: ['Translated', 'অনূদিত'], DOCUMENT: ['Document', 'নথি'], STAFF: ['Staff', 'কর্মী'], AI: ['AI', 'এআই'],
  // Referral and routing
  SENT: ['Sent', 'পাঠানো হয়েছে'], ACKNOWLEDGED: ['Acknowledged', 'প্রাপ্তি স্বীকৃত'], RETURNED: ['Returned', 'ফেরত এসেছে'],
  REFER: ['Refer to another office', 'অন্য অফিসে পাঠান'], RETAIN: ['Keep in this office', 'এই অফিসেই রাখুন'],
  // Lawyer work
  REASSIGNED: ['Reassigned', 'অন্য আইনজীবীকে দেওয়া হয়েছে'], MISSED: ['Missed', 'দেওয়া হয়নি'], SUBMITTED_ON_TIME: ['Sent on time', 'সময়মতো জমা দেওয়া হয়েছে'],
  SUBMITTED_LATE: ['Sent late', ' দেরিতে জমা দেওয়া হয়েছে'], CANCELLED: ['Cancelled', 'বাতিল'], CONTINUED: ['Continued', 'বহাল আছে'], LIFTED: ['Lifted', 'স্থগিতাদেশ প্রত্যাহার করা হয়েছে'],
  CASE_PREPARATION: ['Case preparation', 'মামলার প্রস্তুতি'], HEARING_ATTENDANCE: ['Hearing attendance', 'শুনানিতে উপস্থিতি'],
  CLAIM_REVIEW: ['Claim review', 'বিলের দাবি যাচাই'], RECONCILIATION: ['Reconciliation', 'বিল ও ফি সমন্বয়'],
  NOT_RECORDED: ['Not recorded', 'লেখা নেই'], UNDER_REVIEW: ['Under review', 'যাচাই চলছে'], RECONCILED: ['Reconciled', 'সমন্বয় সম্পন্ন'],
  PAYMENT_RECORDED: ['Payment recorded', 'পেমেন্টের তথ্য নথিভুক্ত হয়েছে'], DISPUTED: ['Disputed', 'আপত্তি আছে'],
  // Triage
  LABOUR: ['Labour', 'শ্রম'], FAMILY: ['Family', 'পারিবারিক'], LAND: ['Land', 'জমি'], CRIMINAL: ['Criminal', 'ফৌজদারি'], OTHER: ['Other', 'অন্যান্য'], UNCERTAIN: ['Uncertain', 'অনিশ্চিত'],
  PRIORITIZE_FOR_HUMAN_REVIEW: ['Review first', 'আগে পর্যালোচনা করুন'], CONTINUE_ROUTINE_REVIEW: ['Routine review', 'সাধারণ পর্যালোচনা'],
  SEEK_MORE_INFORMATION: ['Get more information', 'আরও তথ্য সংগ্রহ করুন'], REQUEST_JURISDICTION_REVIEW: ['Check jurisdiction', 'এখতিয়ার যাচাই করুন'], NO_CHANGE: ['No change', 'পরিবর্তন নেই'],
  CASE_CATEGORIZER: ['Case type', 'মামলার ধরন'], PROCESS_SAFETY: ['Process and safety', 'প্রক্রিয়া ও নিরাপত্তা'], URGENCY_ROUTING: ['Urgency and routing', 'জরুরি অবস্থা ও অফিস নির্বাচন'],
  SAFETY_REVIEW: ['Safety review', 'নিরাপত্তা যাচাই'], ROUTINE_REVIEW: ['Routine review', 'সাধারণ পর্যালোচনা'], URGENT_REVIEW: ['Urgent review', 'জরুরি পর্যালোচনা'],
  ROUTING_REVIEW: ['Routing review', 'কোন অফিসে যাবে তা যাচাই'], SAFE_CONTACT_REVIEW: ['Safe contact review', 'যোগাযোগ নিরাপদ কি না যাচাই'],
  ESCALATION_OPEN: ['Routing escalation open', 'অফিস নির্বাচন নিয়ে ঊর্ধ্বতন পর্যালোচনা চলছে'], RETURNED_REFERRAL_REVIEW: ['Returned referral needs review', 'ফেরত আসা রেফারেল যাচাই দরকার'],
  HUMAN_ROUTE_RECORDED: ['Human route recorded', 'কর্মকর্তার সিদ্ধান্ত নথিভুক্ত'], ROUTE_NOT_RECORDED: ['Route not recorded', 'অফিস নির্বাচনের সিদ্ধান্ত লেখা নেই'],
  MISSING_INFORMATION_REVIEW: ['Missing information', 'তথ্য বাকি'], RESTRICTED_EVIDENCE_REVIEW: ['Restricted evidence review', 'সংরক্ষিত প্রমাণ যাচাই'],
  HIGH: ['High', 'উচ্চ'], LOW: ['Low', 'নিম্ন'], UNKNOWN: ['Unknown', 'অজানা'], PENDING_HUMAN_REVIEW: ['Waiting for officer', 'কর্মকর্তার অপেক্ষায়'], REVIEWED: ['Reviewed', 'পর্যালোচিত'],
  // Duplicates
  MATCH: ['Same', 'হুবহু মিল'], SIMILAR: ['Similar', 'সম্ভাব্য মিল'], DIFFERENT: ['Different', 'ভিন্ন ব্যক্তি'],
  CONFIRMED_DUPLICATE: ['Same person, kept separate', 'একই ব্যক্তি, আলাদা রাখা হয়েছে'], NOT_DUPLICATE: ['Different people', 'ভিন্ন ব্যক্তি'],
  // Mediation
  REGISTRATION: ['Registered', 'নিবন্ধন'], SCHEDULING_NOTICES: ['Schedule and notices', 'সময় ও নোটিশ'], DOCUMENT_REVIEW: ['Documents', 'নথি যাচাই'],
  ATTENDANCE: ['Attendance', 'উপস্থিতি'], MEDIATION: ['Mediation', 'মধ্যস্থতা'], DRAFT_OUTCOME: ['Draft', 'খসড়া'], SIGNATURES: ['Signatures', 'স্বাক্ষর'],
  PENDING_CLAO_CERTIFICATION: ['Pending CLAO certification', 'সিএলএও সনদের অপেক্ষায়'], CERTIFIED_FINAL: ['Certified', 'সনদপ্রাপ্ত'],
  LEGAL_EFFECT_REQUIRES_AUTHORISED_REVIEW: ['Needs authorised legal review', 'অনুমোদিত আইনি পর্যালোচনা দরকার'],
  ATTENDED: ['Attended', 'উপস্থিত'], REPRESENTED: ['Represented', 'প্রতিনিধি উপস্থিত'], ABSENT: ['Absent', 'অনুপস্থিত'],
  AGREEMENT_REACHED: ['Agreement reached', 'সমঝোতা হয়েছে'], NO_AGREEMENT: ['No agreement', 'সমঝোতা হয়নি'],
  DELIVERED: ['Delivered by a person', 'সরাসরি পৌঁছে দেওয়া হয়েছে'], NOT_DELIVERED: ['Not delivered', 'পৌঁছানো হয়নি'],
  PARTY_A: ['Party A', 'প্রথম পক্ষ (পক্ষ ক)'], PARTY_B: ['Party B', 'দ্বিতীয় পক্ষ (পক্ষ খ)'], HUMAN_REVIEW: ['Mediator review', 'মধ্যস্থতাকারীর পর্যালোচনা'],
  MAINTENANCE: ['Maintenance', 'ভরণপোষণ'], PROPERTY: ['Property', 'সম্পত্তি'], UNVERIFIED: ['Unverified', 'যাচাই হয়নি'], APPLICABLE_VERIFIED: ['Applicable, verified', 'প্রযোজ্য, যাচাইকৃত'],
  // History events
  APPLICATION_SUBMITTED: ['Application submitted', 'আবেদন জমা'], APPLICATION_REVIEWED: ['Application reviewed', 'আবেদন পর্যালোচনা হয়েছে'],
  APPLICATION_ACCEPTED: ['Application accepted', 'আবেদন গৃহীত'], OFFICER_ASSIGNED: ['Officer took responsibility', 'কর্মকর্তা দায়িত্ব নিয়েছেন'], APPLICANT_CORRECTION_ATTESTED: ['Applicant correction confirmed', 'আবেদনকারীর সংশোধন নিশ্চিত'],
  APPLICATION_CANCELLED_BY_APPLICANT: ['Application cancelled by applicant', 'আবেদনকারী আবেদন বাতিল করেছেন'], APPLICATION_WITHDRAWN_BY_APPLICANT: ['Withdrawn by the applicant', 'আবেদনকারী নিজে আবেদন প্রত্যাহার করেছেন'], FACT_VERIFIED_BY_APPLICANT: ['Fact verified with the applicant', 'আবেদনকারীর সাথে তথ্য যাচাই সম্পন্ন'], FACT_VERIFICATION_UNDONE: ['Fact verification undone', 'তথ্য যাচাই বাতিল করা হয়েছে'], WITHDRAWN: ['Withdrawn', 'প্রত্যাহার করা হয়েছে'], APPLICANT_CASE_CANCELLATION_REQUESTED: ['Applicant requested case cancellation', 'আবেদনকারী মামলা বাতিলের অনুরোধ করেছেন'],
  CASE_CANCELLATION_DECLINED: ['Cancellation request declined', 'বাতিলের অনুরোধ প্রত্যাখ্যাত'], CASE_CANCELLED: ['Case cancelled', 'মামলা বাতিল'],
  ASSISTANCE_RECORDED: ['Assistance recorded', 'সহায়তার তথ্য নথিভুক্ত হয়েছে'], CALL_RECORDING_STORED: ['Call recording saved', 'কল রেকর্ড সংরক্ষিত'],
  CONSENT_RECORDED: ['Consent recorded', 'সম্মতি নথিভুক্ত হয়েছে'], CONTACT_ATTEMPT_LOGGED: ['Contact attempt logged', 'যোগাযোগের চেষ্টা নথিভুক্ত হয়েছে'],
  DOCUMENT_BRIEFING_APPROVED: ['Document briefing approved', 'নথির সারসংক্ষেপ অনুমোদিত'], DOCUMENT_BRIEFING_PROPOSED: ['Document briefing drafted', 'নথির সারসংক্ষেপের খসড়া তৈরি হয়েছে'],
  DOCUMENT_VERSION_ADDED: ['Document version added', 'নথির নতুন সংস্করণ যোগ হয়েছে'], DOCUMENT_METADATA_CREATED: ['Document added', 'নথি যোগ'],
  DOCUMENT_TEXT_UPLOADED: ['Document text uploaded', 'নথির লেখা আপলোড'], FACT_RECORDED: ['Fact recorded', 'তথ্য নথিভুক্ত হয়েছে'],
  HELPLINE_STATUS_LOOKUP: ['Helpline status lookup', 'হেল্পলাইনে অবস্থা জানা'], HUMAN_PRIORITY_OVERRIDE: ['Priority set by officer', 'কর্মকর্তা অগ্রাধিকার ঠিক করেছেন'],
  HUMAN_ROUTING_DECISION: ['Route decided by officer', 'কোন অফিসে যাবে, কর্মকর্তা তা ঠিক করেছেন'], JURISDICTION_ESCALATED: ['Jurisdiction escalated', 'এখতিয়ারের প্রশ্ন ঊর্ধ্বতন কর্মকর্তার কাছে গেছে'],
  OFFLINE_CONFLICT_DETECTED: ['Offline conflict found', 'এই ডিভাইস ও সার্ভারের তথ্যে অমিল পাওয়া গেছে'], OFFLINE_CONFLICT_RESOLVED: ['Offline conflict resolved', 'এই ডিভাইস ও সার্ভারের তথ্যের অমিল মেটানো হয়েছে'],
  OFFLINE_DRAFT_CREATED: ['Offline draft created', 'অফলাইন খসড়া তৈরি'], OFFLINE_MUTATION_SYNCED: ['Offline change synced', 'এই ডিভাইসের পরিবর্তন সার্ভারে পাঠানো হয়েছে'],
  RECORDING_NOTICE_GIVEN: ['Recording notice given', 'রেকর্ডিংয়ের কথা জানানো'], REFERRAL_ACK_OVERDUE: ['Referral acknowledgement overdue', 'রেফারেলের প্রাপ্তি স্বীকার বাকি'],
  REFERRAL_SENT: ['Referral sent', 'রেফারেল পাঠানো'], REFERRAL_ACKNOWLEDGED: ['Referral acknowledged', 'রেফারেলের প্রাপ্তি স্বীকৃত'],
  REFERRAL_ACCEPTED: ['Referral accepted', 'রেফারেল গৃহীত'], REFERRAL_RETURNED: ['Referral returned', 'রেফারেল ফেরত'],
  REPRESENTATION_RECORDED: ['Representative recorded', 'প্রতিনিধির তথ্য নথিভুক্ত হয়েছে'], SAFE_CONTACT_UPDATED: ['Safe contact updated', 'নিরাপদ যোগাযোগ হালনাগাদ'],
  TASK_COMPLETED: ['Task completed', 'কাজ সম্পন্ন'], TASK_CREATED: ['Task created', 'কাজ তৈরি'], TRANSCRIPT_STORED: ['Transcript saved', 'কথোপকথন সংরক্ষিত'],
  TRIAGE_ASSESSMENT_PROPOSED: ['AI triage suggested', 'এআই পর্যালোচনার পরামর্শ দিয়েছে'], TRIAGE_HUMAN_DECISION_RECORDED: ['Triage decided by officer', 'কর্মকর্তা পর্যালোচনার সিদ্ধান্ত নিয়েছেন'],
  CASE_PLAN_UPDATED: ['Hearing or next step updated', 'শুনানি বা পরবর্তী ধাপ হালনাগাদ'], DUPLICATE_CANDIDATE_REVIEWED: ['Possible duplicate reviewed', 'সম্ভাব্য দ্বৈত আবেদন পর্যালোচনা হয়েছে'],
  RELATED_INCIDENT_GROUP_CREATED: ['Related cases linked', 'সম্পর্কিত মামলা যুক্ত'], RELATED_INCIDENT_EVIDENCE_LINKED: ['Shared evidence linked', 'যৌথ প্রমাণ যুক্ত'],
  PANEL_LAWYER_ASSIGNMENT_OFFERED: ['Lawyer offered the case', 'আইনজীবীকে প্রস্তাব'], PANEL_LAWYER_ACCEPTED: ['Lawyer accepted', 'আইনজীবী গ্রহণ করেছেন'],
  PANEL_LAWYER_DECLINED: ['Lawyer declined', 'আইনজীবী প্রত্যাখ্যান করেছেন'], LAWYER_UPDATE_SCHEDULED: ['Lawyer update scheduled', 'আইনজীবীর আপডেট নির্ধারিত'],
  LAWYER_UPDATE_MISSED: ['Lawyer update missed', 'আইনজীবী আপডেট দেননি'], ON_HOLD: ['On hold', 'স্থগিত'], LAWYER_UPDATE_REMINDER_SENT: ['Lawyer reminded about an overdue update', 'আইনজীবীকে বাকি আপডেটের কথা মনে করানো হয়েছে'], LAWYER_PROGRESS_UPDATE_SUBMITTED: ['Lawyer update received', 'আইনজীবীর আপডেট পাওয়া গেছে'],
  LAWYER_NEW_ASSIGNMENT_HOLD_TRIGGERED: ['Lawyer put on hold', 'আইনজীবীকে নতুন মামলা দেওয়া সাময়িক বন্ধ'], LAWYER_ASSIGNMENT_HOLD_REVIEWED: ['Lawyer hold reviewed', 'নতুন মামলা দেওয়ার স্থগিতাদেশ পর্যালোচনা হয়েছে'],
  LAWYER_CHANGE_REQUEST: ['Lawyer change requested', 'আইনজীবী বদলের অনুরোধ'], LAWYER_CHANGE_REQUEST_REVIEWED: ['Lawyer change request reviewed', 'বদলের অনুরোধ পর্যালোচিত'],
  LAWYER_CHANGE_REVIEW_TASK_CREATED: ['Lawyer change review task', 'বদলের অনুরোধ যাচাইয়ের কাজ'], LAWYER_HOLD_REVIEW_TASK_CREATED: ['Lawyer hold review task', 'স্থগিতাদেশ যাচাইয়ের কাজ'],
  LAWYER_PAYMENT_STATUS_RECORDED: ['Payment status recorded', 'পেমেন্টের অবস্থা নথিভুক্ত হয়েছে'], MEDIATION_REGISTERED: ['Mediation registered', 'মধ্যস্থতা নিবন্ধিত'],
  MEDIATION_CLAIMED: ['Mediator assigned', 'মধ্যস্থতাকারী দায়িত্ব নিয়েছেন'], MEDIATION_SCHEDULED: ['Mediation scheduled', 'মধ্যস্থতার সময় নির্ধারিত'],
  MEDIATION_STAGE_ADVANCED: ['Mediation moved to next stage', 'মধ্যস্থতা পরের ধাপে গেছে'], MEDIATION_DOCUMENTS_REVIEWED: ['Mediation documents reviewed', 'মধ্যস্থতার নথি যাচাই'],
  MEDIATION_ATTENDANCE_RECORDED: ['Attendance recorded', 'উপস্থিতি নথিভুক্ত হয়েছে'], MEDIATION_OUTCOME_RECORDED: ['Mediation outcome recorded', 'মধ্যস্থতার ফল নথিভুক্ত হয়েছে'],
  MEDIATION_SIGNATURE_RECORDED: ['Signature recorded', 'স্বাক্ষর নথিভুক্ত হয়েছে'], MEDIATION_LEGAL_APPLICABILITY_RECORDED: ['Legal applicability recorded', 'আইনটি প্রযোজ্য কি না নথিভুক্ত হয়েছে'],
  SETTLEMENT_DRAFT_PROPOSED: ['Settlement draft prepared', 'মীমাংসার খসড়া তৈরি'], SETTLEMENT_DRAFT_AMENDED: ['Settlement draft edited', 'মীমাংসার খসড়া সম্পাদিত'],
  SETTLEMENT_HUMAN_REVIEW_RECORDED: ['Settlement draft reviewed', 'মীমাংসার খসড়া পর্যালোচিত'], CLAO_CERTIFICATION_RECORDED: ['CLAO certified', 'সিএলএও সনদ দিয়েছেন'],
  SIGNATURE_VERIFICATION_FAILED: ['Signature check failed', 'স্বাক্ষর যাচাই ব্যর্থ'],
  POVERTY_CERTIFICATE_VERIFIED: ['Poverty certificate verified', 'দরিদ্র প্রত্যয়নপত্র যাচাই সম্পন্ন'],
  CASE_INFORMATION_EDITED: ['Case info edited', 'মামলার তথ্য সংশোধিত'],
  PRE_MEDIATION_CALL_VERIFIED: ['Pre-mediation call verified', 'মধ্যস্থতা-পূর্ব কল যাচাই সম্পন্ন'],
  NOTICE_SENT: ['Notice sent', 'নোটিশ জারি'],
  MEDIATION_SESSION_RECORDED: ['Mediation session recorded', 'মধ্যস্থতা অধিবেশন নথিভুক্ত'],
  UP_CHAIRMAN: ['UP Chairman', 'ইউনিয়ন পরিষদ চেয়ারম্যান'],
  WARD_COUNCILLOR: ['Ward Councillor', 'পৌরসভা / ওয়ার্ড কাউন্সিলর'],
  CITY_CORPORATION: ['City Corporation', 'সিটি কর্পোরেশন'],
  OTHER_LOCAL_GOV: ['Other Local Authority', 'অন্যান্য স্থানীয় কর্তৃপক্ষ'],
  FAMILY_LAW: ['Family Law', 'পারিবারিক আইন'],
  CHILD_RIGHTS: ['Child Rights', 'শিশু অধিকার'],
  CRIMINAL_LAW: ['Criminal Law', 'ফৌজদারি আইন'],
  GENDER_BASED_VIOLENCE: ['Women & GBV', 'নারী ও জেন্ডারভিত্তিক সহিংসতা'],
  CIVIL_LAW: ['Civil Law', 'দেওয়ানি আইন'],
  LAND_PROPERTY: ['Land & Property', 'ভূমি ও সম্পত্তি বিরোধ'],
  LABOUR_LAW: ['Labour Law', 'শ্রম আইন'],
  HUMAN_RIGHTS: ['Human Rights', 'মানবাধিকার'],
  // Queue flags and local drafts
  NEW: ['New', 'নতুন'], URGENT_RECOMMENDATION: ['Urgent recommendation', 'জরুরি সুপারিশ'], OVERDUE: ['Overdue', 'সময় পেরিয়েছে'],
  HEARING_TODAY: ['Hearing today', 'আজ শুনানি'],
  REFERRAL_WAITING: ['Referral waiting', 'রেফারেলের জবাবের অপেক্ষায়'], LAWYER_UPDATE_OVERDUE: ['Lawyer update overdue', 'আইনজীবীর আপডেট বাকি'],
  CASE_CANCELLATION_REQUESTED: ['Cancellation requested', 'বাতিলের অনুরোধ'],
  DRAFT: ['Draft', 'খসড়া'], QUEUED: ['Queued', 'পাঠানোর অপেক্ষায়'], CONFLICT: ['Conflict', 'দুই সংস্করণে অমিল'], SERVER: ['Server', 'সার্ভারে থাকা'], LOCAL: ['Local', 'এই ডিভাইসে থাকা'],
  // Fact values
  YES: ['Yes', 'হ্যাঁ'], NO: ['No', 'না'], AVAILABLE: ['Available', 'আছে'], UNAVAILABLE: ['Not available', 'নেই'],
  URGENT_HANDOFF: ['Urgent callback', 'জরুরি ভিত্তিতে আবার ফোন করা'],
  // 16699 call: service, contact route, advice outcome, what an officer weighs first, and how far a fact is verified
  COMPLAINT: ['Complaint', 'অভিযোগ'], ADVICE: ['Information or advice', 'তথ্য বা পরামর্শ'], TRUSTED_PERSON: ['Through a trusted person', 'বিশ্বস্ত ব্যক্তির মাধ্যমে'],
  INFORMATION_PROVIDED: ['Information given', 'তথ্য দেওয়া হয়েছে'], FORMAL_ASSISTANCE: ['Formal legal aid needed', 'আনুষ্ঠানিক আইনি সহায়তা দরকার'],
  SAFETY_RISK: ['Safety risk reported', 'নিরাপত্তা ঝুঁকির কথা জানানো হয়েছে'], REPRESENTATIVE_CALLER: ['Reported by a representative', 'প্রতিনিধি জানিয়েছেন'],
  SAFETY_UNVERIFIED: ['Safety answer needs human verification', 'নিরাপত্তার উত্তর কর্মকর্তা যাচাই করবেন'],
  NID_UNKNOWN: ['NID unknown: verify at a UDC', 'এনআইডি জানা নেই: ইউডিসিতে যাচাই'], AI_FLAGGED_DANGER: ['AI flagged possible danger', 'এআই সম্ভাব্য বিপদ চিহ্নিত করেছে'],
  FAMILY_DOMESTIC: ['Family / domestic dispute', 'পারিবারিক / গৃহস্থালি বিরোধ'], ONLINE_HARASSMENT: ['Online harassment / non-consensual imagery', 'অনলাইন হয়রানি / সম্মতি ছাড়া ছবি-ভিডিও'],
  MARRIAGE_DIVORCE: ['Marriage & divorce', 'বিবাহ ও তালাক'], INHERITANCE: ['Inheritance / succession', 'উত্তরাধিকার / ওয়ারিশ'],
  LABOUR_WAGE: ['Labour / wage / compensation', 'শ্রম / মজুরি / ক্ষতিপূরণ'], CRIMINAL_AID: ['Criminal legal aid', 'ফৌজদারি আইনি সহায়তা'],
  CHILD_CUSTODY: ['Child custody / guardianship', 'সন্তানের হেফাজত / অভিভাবকত্ব'], FINANCIAL_FRAUD: ['Financial fraud / loan dispute', 'আর্থিক প্রতারণা / ঋণ বিরোধ'],
  ADVICE_ONLY: ['General legal information / advice only', 'শুধু আইনি তথ্য / পরামর্শ'],
  SENSITIVE_CATEGORY: ['Sensitive category', 'সংবেদনশীল বিষয়'], RESTRICTED_CATEGORY: ['Restricted evidence: assigned officer only', 'সংরক্ষিত প্রমাণ: শুধু দায়িত্বপ্রাপ্ত কর্মকর্তা'],
  GROUP_CLAIM_POSSIBLE: ['May belong to a group claim: check related incidents', 'দলগত দাবির অংশ হতে পারে: সম্পর্কিত ঘটনা দেখুন'], CATEGORY_NEEDED: ['Officer must choose the category', 'কর্মকর্তাকে বিষয়ের ধরন নির্ধারণ করতে হবে'],
  VICTIM_CONFIRMED: ['Victim confirmed', 'ভুক্তভোগী নিশ্চিত করেছেন'], VERIFICATION_REQUIRED: ['Verification required', 'যাচাই দরকার'],
  ADVICE_OUTCOME_RECORDED: ['Advice call outcome recorded', 'পরামর্শ কলের ফল নথিভুক্ত'],
  // Server wording: task titles, fact fields, comparison rows
  'Review new application': ['Review new application', 'নতুন আবেদন পর্যালোচনা করুন'], 'Decide reviewed application': ['Decide reviewed application', 'পর্যালোচিত আবেদনে সিদ্ধান্ত দিন'],
  'Repeat application review': ['Repeat application review', 'আবেদন আবার পর্যালোচনা করুন'], 'Request missing information': ['Request missing information', 'বাকি তথ্য চেয়ে নিন'],
  'Plan next service step': ['Plan next service step', 'পরবর্তী সেবার ধাপ ঠিক করুন'], 'Plan safer follow-up': ['Plan safer follow-up', 'আবার কীভাবে নিরাপদে যোগাযোগ করবেন, তা ঠিক করুন'],
  'Try the applicant again': ['Try the applicant again', 'আবেদনকারীকে আবার চেষ্টা করুন'], 'Review a disclosure': ['Review a disclosure', 'তথ্য প্রকাশের বিষয়টি পর্যালোচনা করুন'],
  'Urgent human callback requested': ['Urgent human callback requested', 'জরুরি ফোন ফেরত দিতে হবে'],
  'Call back with legal information': ['Call back with legal information', 'ফোন করে আইনগত তথ্য দিন'], 'Review translated assisted intake': ['Review translated assisted intake', 'অনূদিত সহায়তা-আবেদন পর্যালোচনা করুন'],
  'Referral not acknowledged: follow up': ['Referral not acknowledged: follow up', 'রেফারেলের প্রাপ্তি স্বীকার হয়নি: খোঁজ নিন'],
  'Referral returned: review the reason': ['Referral returned: review the reason', 'রেফারেল ফেরত: কারণ দেখুন'],
  'Review applicant lawyer-change request': ['Review applicant lawyer-change request', 'আইনজীবী বদলের অনুরোধ দেখুন'],
  'Jurisdiction escalation: authorised routing decision required': ['Jurisdiction escalation: authorised routing decision required', 'এখতিয়ারের প্রশ্ন: কোন অফিসে যাবে, অনুমোদিত কর্মকর্তাকে তা ঠিক করতে হবে'],
  'safety.urgent': ['Urgent danger', 'জরুরি বিপদ'], 'location.district': ['District', 'জেলা'], 'intake.callback_reason': ['Callback reason', 'ফোন ফেরতের কারণ'],
  'complaint.summary': ['Problem', 'সমস্যা'], 'complaint.original': ['Original statement', 'মূল বক্তব্য'], 'complaint.translation': ['Translation', 'অনুবাদ'],
  'identity.document_access': ['ID document', 'পরিচয়পত্র'], 'contact.phone': ['Contact number', 'যোগাযোগের নম্বর'], 'person.date_of_birth': ['Date of birth', 'জন্মতারিখ'],
  'triage.case_category': ['Case type', 'মামলার ধরন'], 'identity.nid_known': ['NID known', 'এনআইডি নম্বর জানা'], 'identity.nid': ['NID number', 'এনআইডি নম্বর'],
  'contact.preference': ['Contact route', 'যোগাযোগের মাধ্যম'], 'advice.topic': ['Advice question', 'পরামর্শের প্রশ্ন'], 'advice.guidance': ['Information given', 'দেওয়া তথ্য'],
  'incident.what': ['What happened', 'কী ঘটেছে'], 'incident.when': ['When', 'কখন'], 'incident.where': ['Where', 'কোথায়'], 'incident.who': ['Who was involved', 'কারা জড়িত'],
  'complaint.type': ['Complaint type', 'অভিযোগের ধরন'], 'complaint.legal_need': ['Legal need', 'আইনি প্রয়োজন'], Name: ['Name', 'নাম'], 'Contact number': ['Contact number', 'যোগাযোগের নম্বর'],
  'Date of birth': ['Date of birth', 'জন্মতারিখ'], District: ['District', 'জেলা'],
}

const humanize = (code) => /^[A-Z0-9_]+$/.test(code) ? code.charAt(0) + code.slice(1).toLowerCase().replaceAll('_', ' ') : code

// The chosen language lives here. The header switch sets it, App subscribes, and a change re-renders the whole tree,
// so every helper below reads the new value. The choice is remembered on this device.
const storageKey = 'dlas-language'
const listeners = new Set()
let language = (() => {
  try { const saved = localStorage.getItem(storageKey); if (saved === 'bn' || saved === 'en') return saved } catch { /* storage blocked */ }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('bn') ? 'bn' : 'en'
})()
const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener) }
export const getLang = () => language
export const useLang = () => useSyncExternalStore(subscribe, getLang, getLang)
export function setLang(next) {
  language = next
  try { localStorage.setItem(storageKey, next) } catch { /* the choice just won't persist */ }
  listeners.forEach((listener) => listener())
}

export const bi = (en, bn) => language === 'bn' ? bn : en
export const num = (value) => language === 'bn' ? String(value).replace(/[0-9]/g, (digit) => '০১২৩৪৫৬৭৮৯'[digit]) : String(value)
export const say = (code) => code == null || code === '' ? '' : words[code] ? bi(...words[code]) : humanize(String(code))
// "5 days overdue", or "overdue today" before a whole day has passed; empty before the deadline.
export function overdueText(dueAt, now = Date.now()) {
  const late = now - new Date(dueAt).getTime()
  if (!(late > 0)) return ''
  const days = Math.floor(late / 86400000)
  return days < 1 ? bi('overdue today', 'আজ সময় পেরিয়েছে') : bi(`${days} day${days === 1 ? '' : 's'} overdue`, `${num(days)} দিন দেরি`)
}
export const when = (value) => value ? new Intl.DateTimeFormat(language === 'bn' ? 'bn-BD' : 'en-BD', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : bi('Not set', 'নির্ধারিত নয়')

// Fixed sentences the server writes into records (task steps, queue flags, triage reasons, system audit reasons).
const phrases = {
  'Not collected (callback request)': 'কলব্যাকের অনুরোধ হওয়ায় তথ্যটি নেওয়া হয়নি',
  'Not collected (advice request)': 'পরামর্শের অনুরোধ হওয়ায় তথ্যটি নেওয়া হয়নি',
  'NID number given by the caller; verify it before relying on it.': 'যোগাযোগকারী এনআইডি নম্বর দিয়েছেন; ব্যবহারের আগে যাচাই করুন।',
  'NID not known: the caller was advised to verify identity at the nearest UDC.': 'এনআইডি নম্বর জানা নেই: কলারকে নিকটস্থ ইউডিসিতে পরিচয় নিশ্চিত করতে বলা হয়েছে।',
  'The caller reported a current threat, violence, or safety risk; decide priority first.': 'কলার তাৎক্ষণিক হুমকি, সহিংসতা বা নিরাপত্তা ঝুঁকির কথা জানিয়েছেন; আগে অগ্রাধিকার নির্ধারণ করুন।',
  'No SMS or voicemail.': 'এসএমএস বা ভয়েসমেইল পাঠাবেন না।',
  'Call back only on the recorded safe number at the safe time.': 'নথিতে থাকা নিরাপদ নম্বরে নির্ধারিত নিরাপদ সময়েই ফোন করুন।',
  'Give legal information; if formal legal aid is needed, record the applicant details for DLAO review.': 'আইনগত তথ্য দিন; আনুষ্ঠানিক আইনি সহায়তা দরকার হলে জেলা লিগ্যাল এইড অফিসের পর্যালোচনার জন্য আবেদনকারীর তথ্য নথিভুক্ত করুন।',
  'Helpline officer found that formal legal aid is needed; the request now waits for DLAO review.': 'হেল্পলাইন কর্মকর্তা দেখেছেন আনুষ্ঠানিক আইনি সহায়তা দরকার; অনুরোধটি এখন জেলা লিগ্যাল এইড কর্মকর্তার পর্যালোচনার অপেক্ষায়।',
  'Helpline officer gave legal information on the callback; no application follows.': 'হেল্পলাইন কর্মকর্তা ফোনে আইনগত তথ্য দিয়েছেন; নতুন কোনো আবেদনের প্রয়োজন নেই।',
  'Assign the appropriate human-led service or follow-up.': 'উপযুক্ত সেবা বা পরবর্তী যোগাযোগের দায়িত্ব একজন কর্মীকে দিন।',
  'Authorised officer to accept or request more information.': 'অনুমোদিত কর্মকর্তা আবেদনটি গ্রহণ করবেন, অথবা আরও তথ্য চাইবেন।',
  'Collect missing information using an approved safe route.': 'যোগাযোগের অনুমোদিত নিরাপদ উপায়ে বাকি তথ্য জেনে নিন।',
  'Recheck identity gaps, provenance, and safe contact.': 'পরিচয়ের ঘাটতি, তথ্যের উৎস ও নিরাপদ যোগাযোগ আবার দেখুন।',
  'Review intake, identity gaps, provenance, and safe contact before deciding.': 'সিদ্ধান্তের আগে আবেদন, পরিচয়ের ঘাটতি, তথ্যের উৎস ও নিরাপদ যোগাযোগ দেখুন।',
  'Check oral consent, original versus translated account, confirmation, identity, safe contact, and document checklist.': 'মৌখিক সম্মতি, মূল ও অনূদিত বক্তব্য, নিশ্চিতকরণ, পরিচয়, নিরাপদ যোগাযোগ ও নথির তালিকা দেখুন।',
  'Read the return reason and decide the next human step.': 'ফেরতের কারণ পড়ে পরবর্তী ধাপ ঠিক করুন।',
  'An unknown person answered and nothing was disclosed. Choose a safer route or time before trying again.': 'অন্য কেউ ফোন ধরেছিলেন; মামলার কোনো তথ্য জানানো হয়নি। আবার যোগাযোগের আগে নিরাপদ উপায় বা সময় ঠিক করুন।',
  'An unknown person answered and case details were disclosed. Choose a safer route or time before trying again.': 'অন্য কেউ ফোন ধরেছিলেন এবং মামলার তথ্য জানানো হয়ে গেছে। আবার যোগাযোগের আগে নিরাপদ উপায় বা সময় ঠিক করুন।',
  'Nobody answered. Try again at the planned time, within the safe-contact window.': 'কেউ ফোন ধরেননি। ঠিক করা সময়ে, নিরাপদ সময়ের মধ্যে আবার চেষ্টা করুন।',
  'Case details reached someone other than the applicant. Assess the risk to the applicant and update the safe-contact plan before any further contact.': 'আবেদনকারী ছাড়া অন্য কেউ মামলার তথ্য জেনে গেছেন। আবেদনকারীর ঝুঁকি যাচাই করুন এবং আবার যোগাযোগের আগে নিরাপদ যোগাযোগের পরিকল্পনা হালনাগাদ করুন।',
  'Call back only on the recorded safe number at the safe time. Use neutral wording; disclose nothing if someone else answers.': 'নথিতে থাকা নিরাপদ নম্বরে নির্ধারিত সময়েই ফোন করুন। সাধারণ কথা বলুন; অন্য কেউ ধরলে মামলার কোনো তথ্য জানাবেন না।',
  'Review the missed mandatory updates and decide whether to continue or lift the temporary hold. This is not a misconduct finding; reviewer authority is pending policy verification.': 'অনুপস্থিত বাধ্যতামূলক আপডেটগুলো পর্যালোচনা করে সাময়িক স্থগিতাদেশ বহাল থাকবে কি না সিদ্ধান্ত নিন। এটি অসদাচরণের রায় নয়; পর্যালোচনাকারীর কর্তৃত্ব নীতিগত অনুমোদনের অপেক্ষায়।',
  'Review the overdue update and the safe-contact profile before any follow-up or travel. Do not use an unsafe number.': 'আবার যোগাযোগ বা যাতায়াতের ব্যবস্থা করার আগে বাকি থাকা অগ্রগতির তথ্য ও নিরাপদ যোগাযোগের নিয়ম দেখুন। অনিরাপদ নম্বরে ফোন করবেন না।',
  'Review the recorded request, case status, and safe-contact profile; decide separately whether a reassignment is appropriate.': 'অনুরোধ, মামলার অবস্থা ও নিরাপদ যোগাযোগ দেখুন; আইনজীবী বদল দরকার কি না আলাদাভাবে ঠিক করুন।',
  'Reported by a representative: authority and applicant confirmation are pending.': 'প্রতিনিধি জানিয়েছেন: অনুমতি ও আবেদনকারীর নিশ্চিতকরণ বাকি।',
  'Reported by the applicant by voice.': 'আবেদনকারী নিজে ফোনে জানিয়েছেন।',
  'Identity is incomplete.': 'পরিচয় অসম্পূর্ণ।',
  'Contact only through the active safe-contact profile with neutral wording.': 'নথিতে অনুমোদিত নিরাপদ উপায়েই যোগাযোগ করুন; মামলার বিস্তারিত বলবেন না।',
  'AI flagged possible violence or danger in the caller’s words; a human must judge it.': 'কথোপকথনে সম্ভাব্য সহিংসতা বা বিপদের আশঙ্কার কথা এআই চিহ্নিত করেছে; দায়িত্বপ্রাপ্ত কর্মকর্তা কর্তৃক তা মূল্যায়ন প্রয়োজন।',
  'AI flagged possible violence or danger in the intake words.': 'আবেদনের বক্তব্যে এআই সম্ভাব্য সহিংসতা বা বিপদের আশঙ্কা চিহ্নিত করেছে।',
  'Submitted; first human review has not been recorded.': 'জমা হয়েছে; প্রথম পর্যালোচনা এখনো হয়নি।',
  'A court hearing is listed for today; confirm attendance and the applicant-safe next step before travel.': 'আজ শুনানি আছে; যাতায়াতের আগে উপস্থিতি ও আবেদনকারীর নিরাপদ পরবর্তী ধাপ নিশ্চিত করুন।',
  'Officer requested more information.': 'কর্মকর্তা আরও তথ্য চেয়েছেন।',
  'Identity is still recorded as incomplete.': 'পরিচয় এখনো অসম্পূর্ণ।',
  'The applicant requested cancellation of this case; approve or decline.': 'আবেদনকারী এই মামলা বাতিলের অনুরোধ করেছেন; অনুমোদন বা প্রত্যাখ্যান করুন।',
  'Repeated referral returns were escalated; an authorised routing decision is required.': 'রেফারেল বারবার ফেরত এসেছে। বিষয়টি ঊর্ধ্বতন কর্মকর্তার কাছে গেছে; কোন অফিসে পাঠানো হবে, অনুমোদিত কর্মকর্তাকে তা ঠিক করতে হবে।',
  'An open task passed its explicit due date.': 'একটি চলমান কাজের নির্ধারিত সময় পেরিয়ে গেছে।',
  'The application is awaiting an officer decision. No decision has been made here.': 'আবেদনটি কর্মকর্তার সিদ্ধান্তের অপেক্ষায়। এখানে কোনো সিদ্ধান্ত হয়নি।',
  'An officer is handling the case. Use the agreed safe channel for further details.': 'একজন কর্মকর্তা মামলাটি দেখছেন। আরও জানতে আগে ঠিক করা নিরাপদ উপায়ে যোগাযোগ করুন।',
  'More information is needed. Arrange a safe follow-up with the office.': 'আরও তথ্য দরকার। অফিসের সঙ্গে নিরাপদে আবার যোগাযোগের ব্যবস্থা করুন।',
  'A DLAO officer will review the request. This did not change the lawyer assignment.': 'একজন ডিএলএও কর্মকর্তা অনুরোধটি দেখবেন। এতে আইনজীবী বদলায়নি।',
  'Caller confirmed the read-back and submitted through the 16699 voice simulation.': 'কলার পড়ে শোনানো তথ্য নিশ্চিত করে ১৬৬৯৯ ভয়েস সিমুলেশনে জমা দিয়েছেন।',
  'Initial report through the 16699 voice simulation; authority not verified.': '১৬৬৯৯ ভয়েস সিমুলেশনে প্রথম তথ্য; অনুমতি যাচাই হয়নি।',
  'Applicant request recorded by a helpline agent. No reassignment or outbound contact occurred.': 'হেল্পলাইন কর্মী আবেদনকারীর অনুরোধ লিখেছেন। আইনজীবী বদল বা বাইরে যোগাযোগ হয়নি।',
  'Helpline agent attested caller verification and used the caller-provided lookup code on an allowed safe channel; generic status only.': 'হেল্পলাইন কর্মী পরিচয় যাচাই করেছেন বলে নথিভুক্ত করেছেন। কলারের দেওয়া কোড ব্যবহার করে অনুমোদিত নিরাপদ পথে শুধু সাধারণ অবস্থা জানিয়েছেন।',
  'Repeated transfer/return threshold reached; a human routing decision is required.': 'রেফারেল পাঠানো ও ফেরতের নির্ধারিত সীমা পৌঁছেছে; কোন অফিসে যাবে, তা একজন কর্মকর্তাকে ঠিক করতে হবে।',
  'The acknowledgement deadline passed without acknowledgement.': 'নির্ধারিত সময় পেরিয়ে গেছে, কিন্তু প্রাপ্তি স্বীকার করা হয়নি।',
  'No structured case category is recorded.': 'মামলার ধরন লেখা নেই।',
  'A DLAO officer must record or confirm the category.': 'একজন ডিএলএও কর্মকর্তাকে ধরন লিখতে বা নিশ্চিত করতে হবে।',
  'Category is a structured staff-entered suggestion, not a legal conclusion.': 'ধরনটি কর্মীর দেওয়া পরামর্শ, আইনি সিদ্ধান্ত নয়।',
  'No recorded high-level process flag requires escalation.': 'নথিতে এমন কোনো প্রক্রিয়াগত সমস্যা নেই, যা ঊর্ধ্বতন কর্মকর্তার কাছে পাঠাতে হবে।',
  'No safe-contact profile is recorded; do not initiate contact until a human reviews contact safety.': 'নিরাপদ যোগাযোগের তথ্য নেই; দায়িত্বপ্রাপ্ত কর্মকর্তা যাচাই না করা পর্যন্ত যোগাযোগ করবেন না।',
  'Review state or identity status indicates that human review may need more information.': 'পর্যালোচনা বা পরিচয়ের অবস্থা বলছে আরও তথ্য লাগতে পারে।',
  'Restricted evidence exists; confirm that only authorised staff handle it.': 'সংরক্ষিত প্রমাণ আছে; শুধু অনুমোদিত কর্মীরা দেখছেন কি না নিশ্চিত করুন।',
  'Flags are prompts for human review, not a finding or decision.': 'সংকেতগুলো পর্যালোচনার জন্য, কোনো সিদ্ধান্ত নয়।',
  'No human priority is recorded; a DLAO officer must decide the next review level.': 'অগ্রাধিকার নির্ধারণ করা নেই; জেলা লিগ্যাল এইড কর্মকর্তাকে পরবর্তী স্তর নির্ধারণ করতে হবে।',
  'Current recorded priority is URGENT; confirm it against the current evidence.': 'নথিতে আবেদনটি জরুরি হিসেবে চিহ্নিত। এখনকার তথ্যপ্রমাণ দেখে এটি ঠিক আছে কি না নিশ্চিত করুন।',
  'Current recorded priority is ROUTINE; confirm it against the current evidence.': 'নথিতে আবেদনটি সাধারণ হিসেবে চিহ্নিত। এখনকার তথ্যপ্রমাণ দেখে এটি ঠিক আছে কি না নিশ্চিত করুন।',
  'The applicant chose online harassment / non-consensual imagery: sensitive and urgent.': 'আবেদনকারী অনলাইন হয়রানি / সম্মতি ছাড়া ছবি-ভিডিও বেছে নিয়েছেন: সংবেদনশীল ও জরুরি।',
  'The description mentions non-consensual imagery / online harassment: sensitive and urgent.': 'বিবরণে সম্মতি ছাড়া ছবি-ভিডিও / অনলাইন হয়রানির কথা আছে: সংবেদনশীল ও জরুরি।',
  'A safety urgency flag is recorded; human priority review is needed.': 'নিরাপত্তার জরুরি সংকেত রয়েছে; কর্মকর্তা কর্তৃক অগ্রাধিকার পর্যালোচনা প্রয়োজন।',
  'This suggestion does not set priority or choose a receiving office.': 'এই পরামর্শ অগ্রাধিকার ঠিক করে না, গ্রহণকারী অফিসও বাছাই করে না।',
  'No human routing decision is recorded. An authorised officer must check jurisdiction under approved policy.': 'অফিস নির্বাচনের কোনো সিদ্ধান্ত লেখা নেই। অনুমোদিত নীতি অনুযায়ী উপযুক্ত কর্মকর্তাকে এখতিয়ার যাচাই করতে হবে।',
  'A routing escalation task is open after returned referrals. An authorised officer must decide the route.': 'রেফারেল ফেরত আসার পর অফিস নির্বাচন নিয়ে পর্যালোচনার কাজ খোলা আছে। অনুমোদিত কর্মকর্তাকে সিদ্ধান্ত নিতে হবে।',
  'A returned referral needs a human routing review. Review its reason before deciding the next route.': 'ফেরত আসা রেফারেল নিয়ে কর্মকর্তার পর্যালোচনা দরকার। পরবর্তী অফিস নির্বাচনের আগে এর কারণ দেখুন।',
  'A human route is recorded. Verify it against current referral evidence and approved policy.': 'একজন কর্মকর্তার অফিস নির্বাচনের সিদ্ধান্ত লেখা আছে। বর্তমান রেফারেলের তথ্য ও অনুমোদিত নীতি অনুযায়ী তা যাচাই করুন।',
  'The process/safety and urgency/routing components signal different urgency levels; a DLAO officer must resolve the conflict.': 'নিরাপত্তা ও অফিস নির্বাচনের যাচাইয়ে জরুরিতার মাত্রা আলাদা এসেছে। একজন ডিএলএও কর্মকর্তাকে তা পর্যালোচনা করে সিদ্ধান্ত নিতে হবে।',
}
const templates = [
  [/^An urgent fact is recorded \(safety\.urgent revision (\d+), (.+)\)\.$/, (rev, source) => `জরুরি পরিস্থিতির তথ্য নথিভুক্ত আছে (নিরাপত্তা ঝুঁকি সংশোধন ${num(rev)}, ${say(source.toUpperCase().replaceAll(' ', '_'))})।`],
  [/^(\d+) restricted sensitive-evidence items? (?:is|are) on file\.$/, (count) => `${num(count)}টি সংরক্ষিত গোপনীয় প্রমাণ নথিভুক্ত আছে।`],
  [/^Human decision: (.+)\.$/, (value) => `কর্মকর্তার সিদ্ধান্ত: ${value === 'not recorded' ? 'এখনো নথিভুক্ত হয়নি' : say(value)}।`],
  [/^(\d+) open tasks? need a human next action\.$/, (count) => `${num(count)}টি চলমান কাজে পরবর্তী পদক্ষেপ দরকার।`],
  [/^(\d+) mandatory panel-lawyer updates? (?:is|are) overdue \(the oldest by (\d+) days?\); review a safe next step before asking the applicant to travel\.$/, (count, days) => `আইনজীবীর ${num(count)}টি বাধ্যতামূলক আপডেট বাকি (সবচেয়ে পুরোনোটি ${num(days)} দিন দেরিতে); আবেদনকারীকে আসতে বলার আগে নিরাপদ পরবর্তী ধাপ দেখুন।`],
  [/^Oldest open task is (\d+) days old; demo reminder threshold reached\.$/, (days) => `সবচেয়ে পুরোনো অসমাপ্ত কাজটি ${num(days)} দিন ধরে অপেক্ষমাণ; স্মারক নোটিশের সময়সীমা অতিক্রান্ত।`],
  [/^Awaiting acknowledgement from (\S+?)(; the deadline has passed)?\.$/, (office, late) => `${office} অফিস থেকে প্রাপ্তি স্বীকারের অপেক্ষায়${late ? '; সময় পেরিয়ে গেছে' : ''}।`],
  [/^Acknowledged by (\S+); awaiting accept or return\.$/, (office) => `${office} অফিস রেফারেলটি পেয়েছে। এখন তারা গ্রহণ করবে, নাকি ফেরত পাঠাবে, সেই সিদ্ধান্তের অপেক্ষায়।`],
  [/^(\S+) did not acknowledge by the deadline\. Contact that office, or escalate for an authorised routing decision\.$/, (office) => `${office} নির্ধারিত সময়ে প্রাপ্তি স্বীকার করেনি। ওই অফিসে খোঁজ নিন, অথবা কোন অফিসে পাঠানো হবে তা ঠিক করতে অনুমোদিত কর্মকর্তার কাছে বিষয়টি পাঠান।`],
  [/^(\d+) referrals were returned\. An authorised human must decide the route; the system does not decide jurisdiction\.$/, (count) => `${num(count)}টি রেফারেল ফেরত এসেছে। এরপর কোন অফিসে যাবে, তা দায়িত্বপ্রাপ্ত কর্মকর্তা নির্ধারণ করবেন; সিস্টেম এখতিয়ার নির্ধারণ করে না।`],
  [/^(\S+) to acknowledge referral$/, (office) => `${office}-কে রেফারেলের প্রাপ্তি স্বীকার করতে হবে`],
  [/^Recorded case category: (\w+) \((\w+)\)\.$/, (category, source) => `লেখা মামলার ধরন: ${say(category)} (${say(source)})।`],
  [/^A current safety\.urgent fact is marked YES \((\w+)\); a human must assess it\.$/, (source) => `জরুরি নিরাপত্তা বিপদের তথ্য "হ্যাঁ" (${say(source)}); দায়িত্বপ্রাপ্ত কর্মকর্তা কর্তৃক মূল্যায়ন প্রয়োজন।`],
  [/^(.+) \((Hello, .+)\)$/, (bn, en) => bi(en, bn)],
]
const translateOne = (text) => {
  if (phrases[text]) return phrases[text]
  for (const [pattern, render] of templates) { const match = text.match(pattern); if (match) return render(...match.slice(1)) }
  return null
}
// In Bangla, known server sentences are translated one sentence at a time; anything unknown (typed by a person) stays as written.
export function tr(text) {
  if (typeof text !== 'string' || language !== 'bn') return text
  return translateOne(text) ?? text.split(/(?<=\.)\s+(?=[A-Z])/).map((part) => translateOne(part) ?? part).join(' ')
}

export function Bi({ en, bn }) {
  return bi(en, bn)
}

export function Term({ code }) {
  return say(code)
}

const good = new Set(['VICTIM_CONFIRMED', 'ACCEPTED', 'DONE', 'APPROVED', 'READABLE', 'GRANTED', 'VERIFIED', 'APPLICANT_REACHED', 'SUBMITTED_ON_TIME', 'RECONCILED', 'PAYMENT_RECORDED', 'CERTIFIED_FINAL', 'COMPLETED', 'REVIEWED', 'LIFTED', 'AGREEMENT_REACHED', 'NOT_DUPLICATE'])
const bad = new Set(['DISCLOSED', 'ON_HOLD', 'VERIFICATION_REQUIRED', 'UNREADABLE', 'DENIED', 'MISSED', 'RETURNED', 'DISPUTED', 'URGENT', 'BLOCKED_UNSAFE', 'UNKNOWN_PERSON', 'RESTRICTED', 'DIFFERENT', 'DECLINED', 'SUBMITTED_LATE', 'NO_AGREEMENT', 'ABSENT', 'HIGH', 'SAFETY_REVIEW', 'URGENT_REVIEW'])
export function Badge({ code }) {
  return <span className={`badge${good.has(code) ? '' : bad.has(code) ? ' warn-badge' : ' wait-badge'}`}><Term code={code} /></span>
}

// One collapsible case section. It opens itself the first time it needs attention, then never snaps shut after an action.
export function Panel({ id, en, bn, hint, open = false, children }) {
  const [opened, setOpened] = useState(open)
  if (open && !opened) setOpened(true)
  return <section className="panel" aria-labelledby={id}>
    <details open={opened}>
      <summary><h2 id={id}><Bi en={en} bn={bn} /></h2>{hint ? <span className="panel-hint">{hint}</span> : null}</summary>
      <div className="panel-body">{children}</div>
    </details>
  </section>
}

// A creation form stays folded until the officer asks for it.
// `open` lets a page open the form for the user (for example, a simulated call that pre-fills it).
export function AddForm({ en, bn, children, open }) {
  return <details className="add-form" open={open}><summary><Bi en={en} bn={bn} /></summary>{children}</details>
}
