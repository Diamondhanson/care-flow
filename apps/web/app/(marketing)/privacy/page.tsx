import { LegalShell, LegalSection, LegalList } from "@/components/legal/legal-shell";

export const metadata = {
  title: "Privacy Policy · CareFlow",
  description:
    "How CareFlow collects, uses, and protects personal data and the patient information hospitals process on the platform.",
};

// Edit these in one place — they flow through the copy below.
const COMPANY = "[Legal Entity Name]";
const CONTACT_EMAIL = "[privacy@your-domain.com]";
const LAST_UPDATED = "10 July 2026";

export default function PrivacyPage() {
  return (
    <LegalShell
      title="Privacy Policy"
      lastUpdated={LAST_UPDATED}
      related={{ href: "/terms", label: "Read the Terms of Service" }}
      intro={
        <>
          CareFlow is a hospital operations platform, operated by {COMPANY}{" "}
          (&ldquo;CareFlow&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;), that
          healthcare facilities use to track patients from registration through
          treatment and follow-up. This policy explains what personal data we
          handle when you use CareFlow: both the account data of the staff who
          sign in, and the patient information hospitals record on the platform.
        </>
      }
    >
      <LegalSection n={1} id="roles" title="Two kinds of data, two roles">
        <p>
          CareFlow handles two distinct categories of information, and our role
          differs for each:
        </p>
        <LegalList
          items={[
            <>
              <strong>Account &amp; usage data</strong>: information about the
              hospital staff and owners who sign in to CareFlow (for example a
              name, email, and role). For this data we act as the{" "}
              <strong>controller</strong>, and this policy governs it.
            </>,
            <>
              <strong>Patient / clinical data</strong>: the health records a
              hospital enters (demographics, notes, vitals, prescriptions, and
              so on). Here the hospital is the <strong>controller</strong> and
              CareFlow is a <strong>processor</strong> acting on the hospital&apos;s
              instructions. How that data may be used is governed by our
              agreement with the hospital and the hospital&apos;s own privacy
              notice, not this page.
            </>,
          ]}
        />
      </LegalSection>

      <LegalSection n={2} id="collect" title="Information we collect">
        <p>
          <strong>Account &amp; authentication data.</strong> When a hospital
          owner creates an account, they verify their identity with{" "}
          <strong>Google sign-in</strong> or a{" "}
          <strong>one-time email code</strong>. When you sign in with Google, we
          receive your name, email address, and basic profile information from
          your Google account, used only to authenticate you and create your
          CareFlow account. Staff members sign in with a username and password;
          passwords are stored only as salted hashes by our authentication
          provider and are never visible to us.
        </p>
        <p>
          <strong>Patient &amp; clinical data (entered by the hospital).</strong>{" "}
          On the hospital&apos;s instruction, CareFlow stores the records staff
          create, such as patient identifiers, dates of birth, contact details,
          visit and consultation notes, diagnoses, orders and results, vital
          signs, allergies, prescriptions and medication administration, care
          plans, and billing entries.
        </p>
        <p>
          <strong>Technical &amp; device data.</strong> Basic log data (such as
          IP address, browser type, and timestamps) needed to run and secure the
          service. Because CareFlow works offline, a copy of your hospital&apos;s
          working data is also cached <strong>locally in your browser</strong> on
          the device you use, and synchronised back to our database when you are
          online.
        </p>
        <p>
          <strong>Notification data.</strong> If you enable push notifications,
          your browser provides a push subscription (an endpoint and keys) that
          we store so we can deliver alerts to that device. You can turn this off
          at any time in your browser or device settings.
        </p>
      </LegalSection>

      <LegalSection n={3} id="use" title="How we use information">
        <LegalList
          items={[
            "Provide, operate, and maintain the CareFlow platform for your hospital.",
            "Authenticate you and keep each hospital's data isolated from every other tenant.",
            "Send transactional messages: sign-in codes and in-app or push notifications you have enabled.",
            "Keep the service secure, diagnose problems, and improve reliability.",
          ]}
        />
        <p>
          We do <strong>not</strong> sell personal data, and we do{" "}
          <strong>not</strong> use patient data or data received from Google for
          advertising or any purpose beyond operating the service.
        </p>
      </LegalSection>

      <LegalSection n={4} id="google" title="Use of Google user data">
        <p>
          CareFlow&apos;s use of information received from Google APIs adheres to
          the{" "}
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            target="_blank"
            rel="noopener noreferrer"
          >
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements. We request only your basic
          profile and email, and we use them solely to sign you in and provision
          your account.
        </p>
      </LegalSection>

      <LegalSection n={5} id="sharing" title="Service providers we rely on">
        <p>
          We share data only with the infrastructure providers needed to run
          CareFlow, under agreements that require them to protect it:
        </p>
        <LegalList
          items={[
            <>
              <strong>Supabase</strong>: hosts our database, authentication, and
              file storage, with per-hospital row-level security.
            </>,
            <>
              <strong>Resend</strong>: delivers transactional email such as
              sign-in codes.
            </>,
            <>
              <strong>Google</strong>: provides optional sign-in for hospital
              owners.
            </>,
            <>
              <strong>Our hosting provider</strong>: serves the application.
            </>,
          ]}
        />
        <p>
          We may also disclose information where required by law, or to protect
          the rights, safety, and security of CareFlow, our customers, and their
          patients.
        </p>
      </LegalSection>

      <LegalSection n={6} id="security" title="Storage &amp; security">
        <p>
          Data is stored in our hosted database and protected by row-level
          security so that one hospital can never read or write another
          hospital&apos;s records. Traffic is encrypted in transit. Access to
          production systems is limited to authorised personnel. Remember that a
          working copy of data is also cached on the device you use for offline
          access, so keep your devices secured and sign out on shared computers.
        </p>
      </LegalSection>

      <LegalSection n={7} id="retention" title="Retention">
        <p>
          We keep account data for as long as your hospital&apos;s account is
          active. Patient records are retained on behalf of the hospital in line
          with its instructions and any applicable medical-records laws. When a
          hospital closes its account, we delete or return its data as described
          in our agreement and this policy, unless we are required to keep it by
          law.
        </p>
      </LegalSection>

      <LegalSection n={8} id="rights" title="Your choices &amp; rights">
        <p>
          Depending on where you live, you may have rights to access, correct,
          export, or delete personal data we hold about you as an account holder.
          Contact us at{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> and we will
          respond as required by applicable law. Requests that concern{" "}
          <strong>patient records</strong> should be directed to the hospital
          that controls those records; we will support the hospital in
          responding.
        </p>
      </LegalSection>

      <LegalSection n={9} id="children" title="Children">
        <p>
          CareFlow is a professional tool for healthcare staff and is not
          directed to children as account users. Patient records may include
          minors; those are entered and managed by the hospital under its own
          lawful basis and consent processes.
        </p>
      </LegalSection>

      <LegalSection n={10} id="transfers" title="International processing">
        <p>
          Your data may be processed and stored in the regions where our service
          providers operate, which may be outside your country. Where required,
          we rely on appropriate safeguards for such transfers.
        </p>
      </LegalSection>

      <LegalSection n={11} id="changes" title="Changes to this policy">
        <p>
          We may update this policy from time to time. When we make material
          changes, we will update the &ldquo;last updated&rdquo; date above and,
          where appropriate, notify hospital account owners.
        </p>
      </LegalSection>

      <LegalSection n={12} id="contact" title="Contact us">
        <p>
          Questions about this policy or your data? Contact {COMPANY} at{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </LegalSection>
    </LegalShell>
  );
}
