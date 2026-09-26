import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, test } from 'vitest'
import { setLang } from './Bi.jsx'
import DigitalApplicationModal from './DigitalApplicationModal.jsx'

describe('DigitalApplicationModal component', () => {
  afterEach(() => setLang('en'))

  test('does not render when isOpen is false', () => {
    const html = renderToStaticMarkup(
      <DigitalApplicationModal
        isOpen={false}
        onClose={() => {}}
        onSubmit={() => {}}
      />
    )
    expect(html).toBe('')
  })

  test('renders all core fields when isOpen is true in English', () => {
    const profile = {
      displayName: 'Fatema Begum',
      phone: '01711223344',
      district: 'Chattogram',
      nid: '19901234567890123',
    }

    const html = renderToStaticMarkup(
      <DigitalApplicationModal
        isOpen={true}
        onClose={() => {}}
        onSubmit={() => {}}
        profile={profile}
      />
    )

    // Modal Header
    expect(html).toContain('Submit Digital Legal Aid Application')

    // Section 1: Applicant & Safe Contact
    expect(html).toContain('Applicant &amp; Safe Contact Details')
    expect(html).toContain('Applicant Name')
    expect(html).toContain('Safe Contact Phone')
    expect(html).toContain('District Jurisdiction')
    expect(html).toContain('Fatema Begum')
    expect(html).toContain('01711223344')

    // Section 2: Legal Matter
    expect(html).toContain('Describe Your Legal Matter / Incident')
    expect(html).toContain('Statement of Incident or Legal Dispute')
    expect(html).toContain('Immediate danger or urgent protection requested')

    // Section 3: Identity Document (NID selected by default)
    expect(html).toContain('Identity Document Available')
    expect(html).toContain('National ID (NID)')
    expect(html).toContain('Birth Certificate')
    expect(html).toContain('None / Not Available')
    expect(html).toContain('National ID (NID) Number')
    expect(html).toContain('Take Photo or Upload NID Card')

    // Prottayonpotro must NOT show when NID is selected
    expect(html).not.toContain('Prottayonpotro / Local Authority Certificate')

    // Extra Documents Picture Upload
    expect(html).toContain('Extra Supporting Documents &amp; Evidence Photos')
    expect(html).toContain('Take Photo or Upload Supporting Documents')

    // Footer actions
    expect(html).toContain('Cancel')
    expect(html).toContain('Submit Legal Aid Application')
  })

  test('shows Prottayonpotro directly without Applied/Not Available tabs when identity is NONE', () => {
    const html = renderToStaticMarkup(
      <DigitalApplicationModal
        isOpen={true}
        onClose={() => {}}
        onSubmit={() => {}}
        defaultIdentityDoc="NONE"
      />
    )

    // Legal protection notice
    expect(html).toContain('Legal Protection')
    expect(html).toContain('No identity document required')

    // Prottayonpotro section is displayed
    expect(html).toContain('Prottayonpotro / Local Authority Certificate')
    expect(html).toContain('Issuing Authority')
    expect(html).toContain('Union Parishad Chairman')
    expect(html).toContain('Office / Union / Ward Name')
    expect(html).toContain('Take Photo or Upload Prottayonpotro')

    // Confirms "Applied / In Progress" and "Not Available" tabs are removed
    expect(html).not.toContain('Have Prottayonpotro')
    expect(html).not.toContain('Applied / In Progress')
  })

  test('renders in Bangla when language is set to bn and NONE is selected', () => {
    setLang('bn')
    const html = renderToStaticMarkup(
      <DigitalApplicationModal
        isOpen={true}
        onClose={() => {}}
        onSubmit={() => {}}
        defaultIdentityDoc="NONE"
      />
    )

    expect(html).toContain('আইনি সহায়তার ডিজিটাল আবেদনপত্র')
    expect(html).toContain('আবেদনকারীর নাম')
    expect(html).toContain('জরুরি যোগাযোগের ফোন নম্বর')
    expect(html).toContain('কোনোটি নেই / সংযুক্ত নেই')
    expect(html).toContain('প্রত্যয়নপত্র (ইউপি চেয়ারম্যান / কাউন্সিলর সনদ)')
    expect(html).toContain('ইউনিয়ন পরিষদ চেয়ারম্যান')
    expect(html).toContain('অতিরিক্ত প্রমাণক ও সহায়ক নথিপত্রের ছবি')
    expect(html).toContain('আবেদন দাখিল করুন')
  })
})
