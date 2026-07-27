import { LegalShell, LegalSection, LegalList } from "@/components/legal/legal-shell";

export const metadata = {
  title: "Terms of Service · CareFlow",
  description:
    "The terms governing use of the CareFlow hospital operations platform.",
};

// Edit these in one place — they flow through the copy below.
const COMPANY = "[Legal Entity Name]";
const CONTACT_EMAIL = "[legal@your-domain.com]";
const GOVERNING_LAW = "[Country / Region]";
const LAST_UPDATED = "10 July 2026";

export default function TermsPage() {
  return (
    <LegalShell
      title="Terms of Service"
      lastUpdated={LAST_UPDATED}
      related={{ href: "/privacy", label: "Read the Privacy Policy" }}
      intro={
        <>
          These Terms of Service (&ldquo;Terms&rdquo;) govern your access to and
          use of CareFlow, a hospital operations platform operated by {COMPANY}{" "}
          (&ldquo;CareFlow&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;). By
          creating an account or using the service, you agree to these Terms on
          behalf of your hospital.
        </>
      }
    >
      <LegalSection n={1} id="service" title="The service">
        <p>
          CareFlow is software that helps a hospital run its day-to-day
          operations: registering patients, tracking them through triage,
          consultation, diagnostics, treatment, admission, and discharge, and
          producing operational records and reports. Each hospital account is a
          separate tenant, and data is isolated per hospital.
        </p>
      </LegalSection>

      <LegalSection n={2} id="accounts" title="Accounts &amp; eligibility">
        <p>
          A hospital owner creates an account by verifying their identity and
          providing hospital details. You must be authorised to act for the
          hospital, be of legal age, and provide accurate information. The
          account owner is responsible for the staff accounts they create, and
          everyone is responsible for keeping their credentials confidential and
          for activity under their login.
        </p>
      </LegalSection>

      <LegalSection n={3} id="customer-data" title="Your data &amp; patient information">
        <p>
          Your hospital owns and is responsible for the data it enters into
          CareFlow, including patient information. As a condition of using the
          service, your hospital represents that it:
        </p>
        <LegalList
          items={[
            "has a lawful basis and any required consent to collect and process the patient information it records;",
            "will keep that information accurate and up to date;",
            "will use CareFlow in compliance with all laws that apply to it, including medical-records, privacy, and data-protection laws.",
          ]}
        />
        <p>
          We process patient data only to provide the service, as described in
          our <a href="/privacy">Privacy Policy</a>.
        </p>
      </LegalSection>

      <LegalSection n={4} id="medical" title="Not a medical device or medical advice">
        <p>
          <strong>
            CareFlow is an operational and record-keeping tool, not a medical
            device, and it does not provide medical advice or make clinical
            decisions.
          </strong>{" "}
          Any alerts, worklists, flags, or summaries the software surfaces, such
          as &ldquo;vitals need a look&rdquo; or an overdue-dose indicator, are
          workflow aids, not clinical alarms or diagnoses. Licensed
          clinicians remain fully responsible for all clinical judgement, care
          decisions, and patient safety. Do not rely on CareFlow as a substitute
          for professional medical assessment.
        </p>
      </LegalSection>

      <LegalSection n={5} id="acceptable-use" title="Acceptable use">
        <p>You agree not to:</p>
        <LegalList
          items={[
            "use CareFlow for any unlawful purpose or to store data you are not authorised to hold;",
            "attempt to access another hospital's data or bypass the platform's security or tenant isolation;",
            "probe, scan, overload, or disrupt the service, or reverse-engineer it except as permitted by law;",
            "upload malicious code or misuse notifications, email, or other features.",
          ]}
        />
      </LegalSection>

      <LegalSection n={6} id="availability" title="Availability &amp; offline sync">
        <p>
          We work to keep CareFlow available and reliable, but the service is
          provided on an &ldquo;as is&rdquo; and &ldquo;as available&rdquo; basis
          without warranties of any kind. CareFlow is offline-capable: changes
          you make can be saved on your device and synced when connectivity
          returns. You are responsible for the devices you use and for signing
          out on shared computers.
        </p>
      </LegalSection>

      <LegalSection n={7} id="fees" title="Plans &amp; fees">
        <p>
          CareFlow may be offered on a free trial and on paid subscription plans.
          Applicable fees, billing cycles, and any trial terms are described at
          sign-up or in a separate order. Unless stated otherwise, fees are
          non-refundable except where required by law. {"["}Replace this section
          with your actual pricing and billing terms.{"]"}
        </p>
      </LegalSection>

      <LegalSection n={8} id="ip" title="Intellectual property">
        <p>
          CareFlow, including its software, design, and content, is owned by{" "}
          {COMPANY} and its licensors and is protected by intellectual-property
          laws. We grant your hospital a limited, non-exclusive,
          non-transferable right to use the service during your subscription. You
          retain all rights to the data your hospital enters.
        </p>
      </LegalSection>

      <LegalSection n={9} id="termination" title="Termination &amp; data return">
        <p>
          You may stop using CareFlow and close your account at any time. We may
          suspend or terminate access if these Terms are breached or if required
          to protect the service or others. On termination, we will make your
          hospital&apos;s data available for export and then delete it as
          described in our <a href="/privacy">Privacy Policy</a> and any separate
          agreement, unless the law requires us to retain it.
        </p>
      </LegalSection>

      <LegalSection n={10} id="liability" title="Limitation of liability">
        <p>
          To the maximum extent permitted by law, CareFlow and {COMPANY} will not
          be liable for any indirect, incidental, special, or consequential
          damages, or for loss of data, revenue, or profits, arising from your
          use of the service. Nothing in these Terms limits liability that cannot
          be limited by law. {"["}Have counsel set the appropriate liability cap
          and carve-outs for your jurisdiction.{"]"}
        </p>
      </LegalSection>

      <LegalSection n={11} id="law" title="Governing law">
        <p>
          These Terms are governed by the laws of {GOVERNING_LAW}, without regard
          to conflict-of-laws rules, and disputes will be resolved in the courts
          of {GOVERNING_LAW}.
        </p>
      </LegalSection>

      <LegalSection n={12} id="changes" title="Changes to these Terms">
        <p>
          We may update these Terms from time to time. When we make material
          changes, we will update the &ldquo;last updated&rdquo; date above and,
          where appropriate, notify hospital account owners. Continued use after
          changes take effect means you accept the updated Terms.
        </p>
      </LegalSection>

      <LegalSection n={13} id="contact" title="Contact us">
        <p>
          Questions about these Terms? Contact {COMPANY} at{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </LegalSection>
    </LegalShell>
  );
}
