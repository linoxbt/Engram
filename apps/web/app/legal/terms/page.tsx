import Link from "next/link";
import type { Metadata } from "next";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = { title: "Terms of Service", description: "The terms that govern your use of Engram." };

export default function TermsPage() {
  return (
    <>
      <h1>Terms of Service</h1>
      <p>Last updated {LEGAL.effective}.</p>
      <p>
        These Terms of Service (the &ldquo;Terms&rdquo;) govern your access to and use of Engram, including the website, the dashboard, the
        REST API, the Model Context Protocol (MCP) server, the SDK and any related services (together, the &ldquo;Service&rdquo;). By creating an
        account, connecting an agent or otherwise using the Service, you agree to these Terms. If you use the Service on behalf of an
        organisation, you confirm that you are authorised to accept these Terms for it, and &ldquo;you&rdquo; includes that organisation.
      </p>

      <h2>1. The Service</h2>
      <p>
        Engram stores memories written by AI agents, chains every entry by cryptographic hash, signs periodic checkpoints and lets you
        verify, search and replay that history. Engram is currently offered free of charge as an early-stage product built for the
        Appwrite Databases Hackathon. Features may change, and the Service may be interrupted, limited or discontinued at any time.
      </p>

      <h2>2. Eligibility and accounts</h2>
      <ul>
        <li>You must be at least 16 years old, or the age of digital consent where you live if that is higher, to use the Service.</li>
        <li>You must give accurate account information and keep your password confidential. You are responsible for all activity under your account.</li>
        <li>Agent keys act on your behalf. Keep them secret, give each agent only the scopes it needs, and revoke any key you believe is exposed. You are responsible for every write and recall made with your keys.</li>
        <li>Tell us promptly if you suspect unauthorised use of your account.</li>
      </ul>

      <h2>3. Your content</h2>
      <p>
        &ldquo;Your Content&rdquo; means everything you or your agents submit to the Service, including memory text, metadata, subjects, queries and
        settings. You keep all rights in Your Content. You grant us a worldwide, non-exclusive, royalty-free licence to host, store,
        copy, process, transmit and display Your Content only as needed to operate, secure and improve the Service for you, including
        generating embeddings and, where enabled, sending memory text to a language model to classify relationships between memories.
      </p>
      <p>You are responsible for Your Content and confirm that you have all rights and permissions needed to submit it, including any lawful basis required to store personal data about other people.</p>

      <h2>4. How the integrity record works</h2>
      <p>
        Engram is append-only by design. Corrections and deletions are recorded as new entries rather than by rewriting history. When you
        or an agent &ldquo;forget&rdquo; a memory, its content is erased from storage, while a record that an erasure happened, and a salted hash of the
        original entry, remains in the chain so the chain can still be verified. Signed checkpoints and verification results prove that
        stored data has not been altered since it was recorded. They do not prove that the content of a memory is true, accurate or
        lawful.
      </p>

      <h2>5. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>use the Service for anything unlawful, or to store content that infringes others&rsquo; rights, is defamatory, harassing or exploitative, or that you have no right to process;</li>
        <li>store special categories of personal data (such as health, biometric or financial account data) unless you have a lawful basis and appropriate safeguards;</li>
        <li>probe, scan, attack or overload the Service, circumvent rate limits or access controls, or access data or spaces that are not yours;</li>
        <li>tamper with entries outside the sandboxes provided for that purpose in the Tamper Lab;</li>
        <li>reverse engineer the Service except where the law allows it, or resell the Service without our written permission;</li>
        <li>use the Service to build a competing dataset by scraping other users&rsquo; public verification pages.</li>
      </ul>

      <h2>6. Public verification</h2>
      <p>
        If you turn on public verification for a space, anyone with its key can download its entry headers, hashes, Merkle roots and
        signed checkpoints. Memory text is never included. Turn this on only if you are comfortable with that metadata being public.
      </p>

      <h2>7. Third-party services</h2>
      <p>
        The Service runs on third-party infrastructure, including Appwrite (database, authentication, storage, functions and embeddings)
        and Netlify (hosting), and may use Anthropic (relationship classification) and GitHub (optional public anchoring of checkpoint
        roots). Your use of the Service is also subject to the availability of those providers. See the <Link href="/legal/privacy">Privacy Policy</Link> for what each one receives.
      </p>

      <h2>8. Intellectual property and feedback</h2>
      <p>
        The Service, including its software, design and branding, belongs to its operator and licensors, except where its source code is
        published under an open-source licence, in which case that licence governs the code. If you send feedback or suggestions, we may
        use them without obligation to you.
      </p>

      <h2>9. Suspension and termination</h2>
      <p>
        You may stop using the Service and delete your account at any time from the Account page; deleting your account also deletes the
        spaces you own. We may suspend or terminate access if you breach these Terms, if required by law, or to protect the Service or
        other users. Where reasonable, we will give notice and a chance to export your data first. Sections 3 (licence ending when Your
        Content is deleted), 4, 10, 11, 12 and 14 survive termination.
      </p>

      <h2>10. Disclaimers</h2>
      <p>
        The Service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;. To the fullest extent permitted by law, we disclaim all warranties, express or
        implied, including merchantability, fitness for a particular purpose, non-infringement and uninterrupted or error-free operation.
        You are responsible for keeping your own exports of anything you cannot afford to lose.
      </p>

      <h2>11. Limitation of liability</h2>
      <p>
        To the fullest extent permitted by law, the operator of Engram will not be liable for any indirect, incidental, special,
        consequential or punitive damages, or for any loss of data, profits, revenue or goodwill, arising from your use of or inability to
        use the Service. Our total liability for any claim relating to the Service is limited to the greater of the amount you paid us in
        the twelve months before the claim and fifty US dollars. Nothing in these Terms limits liability that cannot be limited by law,
        such as liability for fraud or for death or personal injury caused by negligence.
      </p>

      <h2>12. Indemnity</h2>
      <p>You agree to indemnify and hold harmless the operator of Engram against claims, losses and costs arising from Your Content, your agents&rsquo; activity or your breach of these Terms.</p>

      <h2>13. Changes to these Terms</h2>
      <p>
        We may update these Terms. If a change is material, we will tell you through the Service or by email at least 14 days before it
        takes effect. Continuing to use the Service after the effective date means you accept the updated Terms.
      </p>

      <h2>14. Governing law and disputes</h2>
      <p>
        These Terms are governed by the laws of the place where Engram&rsquo;s operator is established, without regard to conflict-of-law
        rules, and disputes will be heard by the courts there. If you are a consumer, you also keep the protection of the mandatory laws
        of the country where you live and may bring proceedings there.
      </p>

      <h2>15. Contact</h2>
      <p>
        Questions about these Terms: {LEGAL.contactEmail ? <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a> : <a href={`${LEGAL.repo}/issues`}>open an issue on the Engram GitHub repository</a>}.
      </p>
    </>
  );
}
