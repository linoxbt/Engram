/**
 * Quality fixtures (build spec, document 5): 30 labelled memory pairs for relation accuracy, balanced across the
 * five relations, and a 40-memory support-desk corpus with 15 recall queries. Used by scripts/quality.ts against the
 * live classifier and embeddings, and offline by scripts/test/quality.test.ts.
 *
 * Every pair shares a subject, so the classifier itself decides (the "different subjects" fast path never fires).
 * Supersedes pairs are written days apart with an explicit change; contradicts pairs are close in time, by
 * different agents, with nothing saying which one is right.
 */
import type { RelationKind } from "@engram/server";

export interface PairSide { text: string; at: string; agent: string }
export interface RelationPair { id: string; subject: string; kind: string; existing: PairSide; next: PairSide; expected: RelationKind }

const p = (id: string, subject: string, expected: RelationKind, existing: [string, string, string], next: [string, string, string], kind = "fact"): RelationPair =>
  ({ id, subject, kind, expected, existing: { text: existing[0], at: existing[1], agent: existing[2] }, next: { text: next[0], at: next[1], agent: next[2] } });

const D = (day: number, h = 10) => `2026-10-${String(day).padStart(2, "0")}T${String(h).padStart(2, "0")}:00:00.000Z`;

export const RELATION_PAIRS: RelationPair[] = [
  // duplicate: the same statement in other words
  p("dup-1", "customer:ada", "duplicate", ["Ada Lovelace is on the Pro plan, billed monthly.", D(10), "billing-agent"], ["Ada's account is on the Pro plan with monthly billing.", D(10, 14), "support-agent"]),
  p("dup-2", "customer:kestrel", "duplicate", ["Kestrel Foods prefers to be contacted by email, not phone.", D(8), "support-agent"], ["Kestrel Foods wants email rather than phone calls.", D(9), "sales-agent"], "preference"),
  p("dup-3", "customer:ada", "duplicate", ["Ticket #4821: the CSV export drops the last row for Ada.", D(12), "support-agent"], ["Ada reported in ticket #4821 that the CSV export loses the final row.", D(12, 15), "triage-agent"], "event"),
  p("dup-4", "customer:brightline", "duplicate", ["Brightline's renewal date is 1 March 2027.", D(5), "sales-agent"], ["Brightline renews on March 1, 2027.", D(6), "billing-agent"]),
  p("dup-5", "customer:kestrel", "duplicate", ["Omar Haddad is the billing contact at Kestrel Foods.", D(3), "billing-agent"], ["Kestrel Foods' billing contact is Omar Haddad.", D(4), "support-agent"]),
  p("dup-6", "customer:northwind", "duplicate", ["Northwind's support SLA is a 4-hour first response.", D(2), "sales-agent"], ["Northwind has a four-hour first-response SLA.", D(2, 16), "support-agent"]),

  // supersedes: the world changed, and the new memory says so
  p("sup-1", "customer:ada", "supersedes", ["Ada is on the Pro plan.", D(1), "billing-agent"], ["Ada downgraded from the Pro plan to the Starter plan today.", D(20), "billing-agent"]),
  p("sup-2", "customer:kestrel", "supersedes", ["Kestrel Foods' billing contact is Omar Haddad.", D(3), "billing-agent"], ["Kestrel Foods changed their billing contact to Priya Raman; Omar Haddad has left the company.", D(18), "billing-agent"]),
  p("sup-3", "customer:brightline", "supersedes", ["Brightline's office is in Leeds.", D(2), "sales-agent"], ["Brightline relocated its office from Leeds to Manchester this month.", D(21), "sales-agent"]),
  p("sup-4", "customer:ada", "supersedes", ["Ada's invoices go to ada@lovelace.dev.", D(4), "billing-agent"], ["Ada switched her invoice email from ada@lovelace.dev to billing@lovelace.dev.", D(19), "billing-agent"]),
  p("sup-5", "customer:ada", "supersedes", ["Ticket #4821 is open and waiting on engineering.", D(12), "support-agent"], ["Ticket #4821 is now closed: the CSV export fix shipped in v2.14 and Ada confirmed it works.", D(22), "support-agent"], "event"),
  p("sup-6", "customer:northwind", "supersedes", ["Northwind pays 49 EUR per seat per month.", D(1), "billing-agent"], ["Northwind's price changed from 49 EUR to 59 EUR per seat per month at the November renewal.", D(23), "billing-agent"]),

  // contradicts: they disagree and nothing shows which one is right
  p("con-1", "customer:ada", "contradicts", ["Ada is on the Pro plan.", D(15, 9), "billing-agent"], ["Ada is on the Enterprise plan.", D(15, 11), "support-agent"]),
  p("con-2", "customer:kestrel", "contradicts", ["Kestrel Foods works in the CET timezone.", D(14, 9), "support-agent"], ["Kestrel Foods works in the US Eastern timezone.", D(14, 13), "sales-agent"]),
  p("con-3", "customer:brightline", "contradicts", ["Brightline's contract ends on 31 December 2026.", D(13, 9), "sales-agent"], ["Brightline's contract runs until 30 June 2027.", D(13, 10), "billing-agent"]),
  p("con-4", "customer:kestrel", "contradicts", ["Omar Haddad prefers phone calls over email.", D(16, 9), "sales-agent"], ["Omar Haddad does not take phone calls and only answers email.", D(16, 12), "support-agent"], "preference"),
  p("con-5", "customer:northwind", "contradicts", ["Northwind has 25 paid seats.", D(17, 9), "billing-agent"], ["Northwind has 40 paid seats.", D(17, 10), "sales-agent"]),
  p("con-6", "customer:ada", "contradicts", ["The CSV export bug Ada hit happens only in Safari.", D(12, 16), "support-agent"], ["The CSV export bug Ada hit reproduces in Chrome and Firefox but not in Safari.", D(12, 17), "qa-agent"]),

  // refines: more detail, nothing made wrong
  p("ref-1", "customer:ada", "refines", ["Ada reported that CSV exports drop the last row.", D(12), "support-agent"], ["The CSV export bug Ada reported only happens when an export has more than 10,000 rows.", D(13), "qa-agent"], "event"),
  p("ref-2", "customer:kestrel", "refines", ["Kestrel Foods prefers email.", D(8), "support-agent"], ["Kestrel Foods prefers email and replies fastest to messages sent before 10am CET.", D(11), "support-agent"], "preference"),
  p("ref-3", "customer:brightline", "refines", ["Brightline is on the Enterprise plan.", D(5), "sales-agent"], ["Brightline's Enterprise plan includes SSO and a dedicated success manager.", D(7), "sales-agent"]),
  p("ref-4", "customer:kestrel", "refines", ["Omar Haddad is the billing contact at Kestrel Foods.", D(3), "billing-agent"], ["Omar Haddad, the billing contact at Kestrel Foods, needs a PO number on every invoice.", D(9), "billing-agent"]),
  p("ref-5", "customer:northwind", "refines", ["Northwind's SLA is a 4-hour first response.", D(2), "sales-agent"], ["Northwind's 4-hour first-response SLA applies on business days only.", D(6), "support-agent"]),
  p("ref-6", "customer:ada", "refines", ["Ada is on the Pro plan.", D(1), "billing-agent"], ["Ada's Pro plan includes three seats and priority support.", D(5), "sales-agent"]),

  // unrelated: same customer, different facts
  p("unr-1", "customer:ada", "unrelated", ["Ada is on the Pro plan.", D(1), "billing-agent"], ["Ada reported that dark mode resets after she logs out.", D(14), "support-agent"]),
  p("unr-2", "customer:kestrel", "unrelated", ["Kestrel Foods paid invoice INV-204 on time.", D(6), "billing-agent"], ["Kestrel Foods' warehouse team uses the mobile app for stock counts.", D(10), "support-agent"]),
  p("unr-3", "customer:brightline", "unrelated", ["Brightline's office is in Leeds.", D(2), "sales-agent"], ["Brightline asked for a training session on the reporting API.", D(9), "support-agent"]),
  p("unr-4", "customer:kestrel", "unrelated", ["Omar Haddad is the billing contact at Kestrel Foods.", D(3), "billing-agent"], ["Kestrel Foods' head chef asked for allergen fields in the product catalogue.", D(15), "sales-agent"]),
  p("unr-5", "customer:northwind", "unrelated", ["Northwind's SLA is a 4-hour first response.", D(2), "sales-agent"], ["Northwind uses Okta for single sign-on.", D(8), "support-agent"]),
  p("unr-6", "customer:ada", "unrelated", ["Ticket #4821: the CSV export drops the last row.", D(12), "support-agent"], ["Ticket #4907: password reset emails reach Ada twenty minutes late.", D(18), "support-agent"], "event"),
];

export interface RecallMemory { id: string; text: string }
export interface RecallQuery { query: string; expected: string[] }

export const RECALL_CORPUS: RecallMemory[] = [
  { id: "r01", text: "Ada Lovelace is on the Starter plan after downgrading from Pro in October." },
  { id: "r02", text: "Ada prefers email over phone calls and reads messages in the evening." },
  { id: "r03", text: "Ada's invoices go to billing@lovelace.dev." },
  { id: "r04", text: "Ada reported that CSV exports drop the last row when the file has more than 10,000 rows." },
  { id: "r05", text: "Ada's dark mode setting resets every time she logs out." },
  { id: "r06", text: "Ada is based in London and works in the GMT timezone." },
  { id: "r07", text: "Ada asked whether the API supports webhooks for new invoices." },
  { id: "r08", text: "Ada's company Lovelace Analytics has three seats." },
  { id: "r09", text: "Kestrel Foods paid invoice INV-204 on time." },
  { id: "r10", text: "Kestrel Foods' billing contact is Priya Raman; Omar Haddad left in October." },
  { id: "r11", text: "Kestrel Foods needs a purchase order number on every invoice." },
  { id: "r12", text: "Kestrel Foods' warehouse team uses the mobile app for stock counts." },
  { id: "r13", text: "Kestrel Foods' head chef wants allergen fields in the product catalogue." },
  { id: "r14", text: "Kestrel Foods works in the CET timezone and prefers morning calls." },
  { id: "r15", text: "Kestrel Foods is evaluating a move to the Enterprise plan next quarter." },
  { id: "r16", text: "Kestrel Foods reported duplicate orders when the mobile app goes offline." },
  { id: "r17", text: "Brightline relocated its office from Leeds to Manchester." },
  { id: "r18", text: "Brightline's Enterprise plan includes SSO and a dedicated success manager." },
  { id: "r19", text: "Brightline renews its contract on 1 March 2027." },
  { id: "r20", text: "Brightline asked for a training session on the reporting API." },
  { id: "r21", text: "Brightline's security team requires SOC 2 reports before every renewal." },
  { id: "r22", text: "Brightline's admin, Tom Reyes, manages user provisioning through SCIM." },
  { id: "r23", text: "Brightline saw slow dashboard loads during their quarter-end reporting." },
  { id: "r24", text: "Brightline pays by bank transfer, never by card." },
  { id: "r25", text: "Northwind's support SLA is a 4-hour first response on business days." },
  { id: "r26", text: "Northwind pays 59 EUR per seat per month since the November renewal." },
  { id: "r27", text: "Northwind uses Okta for single sign-on." },
  { id: "r28", text: "Northwind has 40 paid seats across two teams." },
  { id: "r29", text: "Northwind's data must stay in the EU region for compliance." },
  { id: "r30", text: "Northwind requested an audit log export for their annual review." },
  { id: "r31", text: "Northwind's main contact, Lena Fischer, is on parental leave until January." },
  { id: "r32", text: "Northwind reported that scheduled reports arrive in the wrong timezone." },
  { id: "r33", text: "Release v2.14 fixed the CSV export bug that dropped the last row." },
  { id: "r34", text: "Password reset emails were delayed by twenty minutes because of a mail provider outage." },
  { id: "r35", text: "The public status page is updated by the on-call engineer within 15 minutes of an incident." },
  { id: "r36", text: "Refunds over 500 EUR need approval from the finance lead." },
  { id: "r37", text: "Support hours are 8am to 6pm CET, Monday to Friday." },
  { id: "r38", text: "Enterprise customers get a quarterly business review with their success manager." },
  { id: "r39", text: "The mobile app's offline mode syncs changes when the connection returns." },
  { id: "r40", text: "Discount codes cannot be combined with annual billing." },
];

export const RECALL_QUERIES: RecallQuery[] = [
  { query: "What plan is Ada on now?", expected: ["r01"] },
  { query: "How should we contact Ada?", expected: ["r02"] },
  { query: "Where do Ada's invoices get sent?", expected: ["r03"] },
  { query: "Who handles billing at Kestrel Foods?", expected: ["r10"] },
  { query: "Does Kestrel require PO numbers on invoices?", expected: ["r11"] },
  { query: "Which city is Brightline's office in?", expected: ["r17"] },
  { query: "When does Brightline's contract renew?", expected: ["r19"] },
  { query: "How does Brightline pay us?", expected: ["r24"] },
  { query: "What is Northwind's response time commitment?", expected: ["r25"] },
  { query: "How much does Northwind pay per seat?", expected: ["r26"] },
  { query: "Which identity provider does Northwind use for SSO?", expected: ["r27"] },
  { query: "Where must Northwind's data be stored?", expected: ["r29"] },
  { query: "Was the CSV export bug fixed, and in which release?", expected: ["r33", "r04"] },
  { query: "Who approves large refunds?", expected: ["r36"] },
  { query: "What are the support desk's opening hours?", expected: ["r37"] },
];
