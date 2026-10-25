import Link from "next/link";
import type { Metadata } from "next";
import { CookieSettingsLink } from "@/components/cookie-settings-link";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = { title: "Cookie Policy", description: "The cookies and browser storage Engram uses, and how to change your choice." };

export default function CookiesPage() {
  return (
    <>
      <h1>Cookie Policy</h1>
      <p>Last updated {LEGAL.effective}.</p>
      <p>
        Cookies are small text files a website stores in your browser. Engram uses a small number of first-party cookies and browser
        storage entries, all needed to run the Service or to remember your choices. We do not use advertising, analytics or
        cross-site tracking cookies, and no third party sets cookies through Engram.
      </p>

      <h2>Cookies we use</h2>
      <table>
        <thead><tr><th>Name</th><th>Purpose</th><th>Type</th><th>Duration</th></tr></thead>
        <tbody>
          <tr><td><code>__Host-engram_session</code></td><td>Keeps you signed in. HTTP-only, so page scripts cannot read it; sent only over HTTPS, and only to this site.</td><td>Strictly necessary</td><td>Until you sign out, or up to 30 days</td></tr>
          <tr><td><code>engram_consent</code></td><td>Remembers whether you accepted or declined cookies, so we do not ask on every visit.</td><td>Strictly necessary</td><td>One year</td></tr>
        </tbody>
      </table>

      <h2>Browser storage</h2>
      <table>
        <thead><tr><th>Key</th><th>Purpose</th><th>When</th></tr></thead>
        <tbody>
          <tr><td><code>engram.sidebar.mini</code>, <code>engram.spacebar.mini</code></td><td>Remember whether you folded the app&rsquo;s sidebars.</td><td>Only after you accept cookies</td></tr>
          <tr><td><code>engram.trusted.&lt;space&gt;</code></td><td>The size and Merkle root of the newest checkpoint your browser verified for a space, so a later check can tell if history was rolled back. Contains no memory content.</td><td>Only after you accept cookies</td></tr>
        </tbody>
      </table>

      <h2>Your choice</h2>
      <p>
        When you first visit, Engram asks whether you accept cookies. Signing in needs the session cookie, so if you decline you can still
        read the website, the documentation and public verification pages, but signing in and creating an account stay off until you
        accept. Declining also signs you out on that browser.
      </p>
      <p>You can change your choice at any time: <CookieSettingsLink className="font-medium text-text underline underline-offset-2" />. You can also delete cookies in your browser&rsquo;s settings; you will be asked again on your next visit.</p>

      <h2>Third-party resources</h2>
      <p>
        The site loads typefaces from Google Fonts. Google receives your IP address and browser details when fonts load but does not set
        cookies through Engram. See the <Link href="/legal/privacy">Privacy Policy</Link> for every provider that processes data for us.
      </p>

      <h2>Changes</h2>
      <p>If we add a cookie, we will update this page before it is used and, if it is not strictly necessary, ask for your consent first.</p>
    </>
  );
}
