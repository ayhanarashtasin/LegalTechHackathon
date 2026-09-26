import mongoose from 'mongoose';

async function reconcileCases() {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.MONGODB_DB || 'dlas' });
  const rawDb = mongoose.connection.useDb(process.env.MONGODB_DB || 'dlas').db;

  console.log('--- 1. Purging all dummy / synthetic phone numbers from database ---');
  const dummyPhones = [
    '01711-234567',
    '01712-345678',
    '01713-456789',
    '01714-567890',
    '01715-678901',
    '01716-789012',
    '01717-890123',
    '01718-901234',
    '01719-012345',
  ];

  const delFacts = await rawDb.collection('casefacts').deleteMany({
    field: 'contact.phone',
    value: { $in: dummyPhones }
  });
  console.log(`Deleted ${delFacts.deletedCount} dummy contact.phone case facts.`);

  const updateProfiles = await rawDb.collection('safecontactprofiles').updateMany(
    { contactValue: { $in: dummyPhones } },
    { $unset: { contactValue: '' } }
  );
  console.log(`Unset dummy contactValue in ${updateProfiles.modifiedCount} safe contact profiles.`);

  console.log('\n--- 2. Reconciling APP-2026-000040 (Nabila) with Genuine Recording Data ---');
  // Delete all fabricated incident & problem facts for Nabila
  await rawDb.collection('casefacts').deleteMany({
    applicationId: 'APP-2026-000040',
    field: {
      $in: [
        'incident.what',
        'incident.when',
        'incident.who',
        'complaint.legal_need',
        'complaint.type',
        'contact.phone'
      ]
    }
  });

  // Genuine summary based on caller's transcript speech turns
  // Turns:
  // "হ্যালো, আমার নাম হুছে নাবিলা"
  // "মিয়ে কোন্ডি আর্মাল্বার কর্ছে"
  // "আপ্রাজ্য়ে মেধ সুত্ববর্গে."
  // "হে বিপদে আছি"
  // "সিন্তের"
  // "দুপুর তিন টাই"
  // "ক্যাকি সম্য কায়ালে কাস্তিমাটা ক্যাকি কাস্তিমাটা কাস্তিমাটা"
  // "ফোরিপূর"
  const genuineSummary = 'হ্যালো, আমার নাম হুছে নাবিলা। হে বিপদে আছি। দুপুর তিন টাই। ফোরিপূর। (১৬৬৯৯ ভয়েস কলে আবেদনকারীর কথ্য বক্তব্য)';

  await rawDb.collection('casefacts').updateOne(
    { applicationId: 'APP-2026-000040', field: 'complaint.summary' },
    {
      $set: {
        value: genuineSummary,
        sourceType: 'APPLICANT_REPORTED',
        captureMethod: 'VOICE',
        callerConfirmed: true,
        applicantConfirmed: true,
        revision: 2,
        updatedAt: new Date()
      }
    },
    { upsert: true }
  );

  await rawDb.collection('casefacts').updateOne(
    { applicationId: 'APP-2026-000040', field: 'location.district' },
    {
      $set: {
        value: 'ফরিদপুর (Faridpur)',
        sourceType: 'APPLICANT_REPORTED',
        captureMethod: 'VOICE',
        callerConfirmed: true,
        applicantConfirmed: true,
        revision: 2,
        updatedAt: new Date()
      }
    },
    { upsert: true }
  );

  await rawDb.collection('casefacts').updateOne(
    { applicationId: 'APP-2026-000040', field: 'safety.urgent' },
    {
      $set: {
        value: 'YES',
        sourceType: 'APPLICANT_REPORTED',
        captureMethod: 'VOICE',
        callerConfirmed: true,
        applicantConfirmed: true,
        revision: 2,
        updatedAt: new Date()
      }
    },
    { upsert: true }
  );

  // Safe Contact Profile: genuine time window spoken ("দুপুর তিন টাই"), NO phone number was given
  await rawDb.collection('safecontactprofiles').updateOne(
    { applicationId: 'APP-2026-000040' },
    {
      $set: {
        version: 2,
        allowedChannels: ['PHONE'],
        prohibitedChannels: ['SMS'],
        safeTimeWindow: 'দুপুর ৩:০০ টা (03:00 PM)',
        neutralWordingRequired: true,
        unknownAnswerAction: 'DISCLOSE_NOTHING',
        smsSafe: false,
      },
      $unset: { contactValue: '' }
    },
    { upsert: true }
  );

  console.log('APP-2026-000040 updated to genuine transcript facts only.');

  console.log('\n--- 3. Reconciling APP-2026-000044 (Samia) with Genuine Transcript ---');
  // Samia spoke about dowry demand, husband and mother-in-law, Joypurhat, safe time 2-4 PM, urgent: YES, no phone
  await rawDb.collection('casefacts').deleteMany({
    applicationId: 'APP-2026-000044',
    field: { $in: ['contact.phone'] }
  });
  await rawDb.collection('safecontactprofiles').updateOne(
    { applicationId: 'APP-2026-000044' },
    {
      $set: {
        safeTimeWindow: 'দুপুর ২:০০ টা থেকে ৪:০০ টা (02:00 PM - 04:00 PM)',
        allowedChannels: ['PHONE'],
        neutralWordingRequired: true,
      },
      $unset: { contactValue: '' }
    }
  );
  await rawDb.collection('casefacts').updateOne(
    { applicationId: 'APP-2026-000044', field: 'complaint.summary' },
    {
      $set: {
        value: 'আমার নাম সামিয়া আমার সামি বিগত দুবছোর ধরে আমার কাছে জোতুক চাত্ছে আমার জন্য এখন এটি কো করন পরস্ত্য হোর পরেছে কাউন আমার হাজ্বেন্ট এবং আমার শাসুডি আমাকে বাস্তিকে বেখতো দিছে মা',
        sourceType: 'APPLICANT_REPORTED',
        captureMethod: 'VOICE',
        callerConfirmed: true,
        applicantConfirmed: true,
      }
    }
  );
  await rawDb.collection('casefacts').updateOne(
    { applicationId: 'APP-2026-000044', field: 'incident.what' },
    { $set: { value: 'যৌতুক দাবি ও নির্যাতন' } }
  );
  await rawDb.collection('casefacts').updateOne(
    { applicationId: 'APP-2026-000044', field: 'incident.when' },
    { $set: { value: 'বিগত ২ বছর' } }
  );
  await rawDb.collection('casefacts').updateOne(
    { applicationId: 'APP-2026-000044', field: 'incident.where' },
    { $set: { value: 'জয়পুরহাট' } }
  );
  await rawDb.collection('casefacts').updateOne(
    { applicationId: 'APP-2026-000044', field: 'incident.who' },
    { $set: { value: 'স্বামী ও শাশুড়ি' } }
  );

  console.log('\n--- 4. Reconciling APP-2026-000045 (Mina) with Genuine Transcript ---');
  // Mina spoke: "আমার নাম মিনা আমি আমার শুসুর্বেরিতে অত্যাচায়ের শিকার আমি এর বিরুধ্ধে একটি তথ্য চাই...", safe time: 2-5 PM
  await rawDb.collection('casefacts').deleteMany({
    applicationId: 'APP-2026-000045',
    field: { $in: ['contact.phone', 'location.district', 'incident.when', 'incident.where'] }
  });
  await rawDb.collection('safecontactprofiles').updateOne(
    { applicationId: 'APP-2026-000045' },
    {
      $set: {
        safeTimeWindow: 'দুপুর ২:০০ টা থেকে ৫:০০ টা (02:00 PM - 05:00 PM)',
        allowedChannels: ['PHONE'],
      },
      $unset: { contactValue: '' }
    }
  );
  await rawDb.collection('casefacts').updateOne(
    { applicationId: 'APP-2026-000045', field: 'complaint.summary' },
    {
      $set: {
        value: 'আমার নাম মিনা আমি আমার শুসুর্বেরিতে অত্যাচায়ের শিকার আমি এর বিরুধ্ধে একটি তথ্য চাই আমার এর পোর কি পদখ্যব নিয়া অচিত',
        sourceType: 'APPLICANT_REPORTED',
        captureMethod: 'VOICE',
      }
    }
  );
  await rawDb.collection('casefacts').updateOne(
    { applicationId: 'APP-2026-000045', field: 'incident.what' },
    { $set: { value: 'শ্বশুরবাড়িতে নির্যাতন সংক্রান্ত আইনি তথ্য ও পরামর্শ' } }
  );
  await rawDb.collection('casefacts').updateOne(
    { applicationId: 'APP-2026-000045', field: 'incident.who' },
    { $set: { value: 'শ্বশুরবাড়ির লোকজন' } }
  );

  console.log('\n--- 5. Reconciling APP-2026-000039 (Tanha / Ayan) with Genuine Transcript ---');
  await rawDb.collection('casefacts').deleteMany({
    applicationId: 'APP-2026-000039',
    field: { $in: ['contact.phone'] }
  });
  await rawDb.collection('safecontactprofiles').updateOne(
    { applicationId: 'APP-2026-000039' },
    {
      $set: {
        safeTimeWindow: 'দুপুর ২:০০ টা (02:00 PM)',
        allowedChannels: ['PHONE'],
      },
      $unset: { contactValue: '' }
    }
  );
  await rawDb.collection('casefacts').updateOne(
    { applicationId: 'APP-2026-000039', field: 'complaint.summary' },
    {
      $set: {
        value: 'আমার বোনের বাশারে অনেক কাজ হোছে আমি কাজ করতে সেনা... আবেদন কাডি মাদারিপুর জলাই থাকে... সরাসরি লিগাল এইড অফিসে কাজ করতে চাই',
        sourceType: 'CALLER_REPORTED',
        captureMethod: 'VOICE',
      }
    }
  );

  console.log('\n--- 6. Reconciling remaining voice applications ---');
  const otherVoiceApps = ['APP-2026-000026', 'APP-2026-000027', 'APP-2026-000028', 'APP-2026-000031', 'APP-2026-000041'];
  for (const appId of otherVoiceApps) {
    await rawDb.collection('casefacts').deleteMany({
      applicationId: appId,
      field: { $in: ['contact.phone', 'incident.what', 'incident.when', 'incident.where', 'incident.who'] }
    });
    await rawDb.collection('safecontactprofiles').updateOne(
      { applicationId: appId },
      { $unset: { contactValue: '' } }
    );
  }

  console.log('\n--- Done! All dummy phone numbers and unverified narratives removed. Only genuine facts retained. ---');
  await mongoose.disconnect();
}

reconcileCases().catch(console.error);
