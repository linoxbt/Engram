/**
 * The demo story: Northwind, a small software company. Three agents share one
 * space; the customer is Ada Okafor of Kestrel Foods. Everything is fictional.
 * The history is seeded with past timestamps; the README says so.
 */

export interface SeedItem {
  at: string;
  agent: "onboarding-agent" | "billing-agent" | "support-agent";
  text: string;
  subject: string;
  kind?: "fact" | "preference" | "event" | "observation";
  importance?: number;
  /** Scripted relations to earlier story items, by key. Omitted means "let the engine decide". */
  supersedes?: string[];
  contradicts?: string[];
  key?: string;
  /** Run through the real classifier path (the duplicate beat). */
  live?: boolean;
  forget?: string;
  source?: string;
}

export const DEMO_AGENTS = [
  { name: "onboarding-agent", description: "Onboards new customers: account setup, contacts, plans and preferences." },
  { name: "billing-agent", description: "Handles invoices, payments, plan changes and billing questions." },
  { name: "support-agent", description: "Customer support agent for product issues, refunds and account requests." },
] as const;

export const STORY: SeedItem[] = [
  { key: "ada-role", at: "2026-10-19T09:00:00.000Z", agent: "onboarding-agent", subject: "customer:ada", text: "Ada Okafor is the operations lead at Kestrel Foods.", importance: 6 },
  { key: "ada-pro", at: "2026-10-19T09:01:00.000Z", agent: "onboarding-agent", subject: "customer:ada", text: "Ada is on the Pro plan, billed monthly.", importance: 7 },
  { key: "ada-email", at: "2026-10-19T09:02:00.000Z", agent: "onboarding-agent", subject: "customer:ada", kind: "preference", text: "Ada prefers email over phone calls.", importance: 6 },
  { key: "kestrel-inv", at: "2026-10-20T14:10:00.000Z", agent: "billing-agent", subject: "customer:kestrel", text: "Kestrel Foods paid invoice INV-204 on time.", importance: 4, source: "invoice:INV-204" },
  { key: "ada-csv", at: "2026-10-20T16:30:00.000Z", agent: "support-agent", subject: "customer:ada", kind: "event", text: "Ada reported that CSV exports drop the last row.", importance: 6, source: "ticket:4398" },
  { key: "ada-address", at: "2026-10-21T10:00:00.000Z", agent: "support-agent", subject: "customer:ada", text: "Ada shared a delivery address for a hardware token: 14 Palm Close, Lekki.", importance: 5, source: "ticket:4405" },
  { key: "ada-basic", at: "2026-10-22T11:15:00.000Z", agent: "support-agent", subject: "customer:ada", text: "Ada downgraded from the Pro plan to Basic on 22 October.", importance: 8, supersedes: ["ada-pro"], source: "ticket:4412" },
  { key: "ada-pro-again", at: "2026-10-22T15:40:00.000Z", agent: "billing-agent", subject: "customer:ada", text: "Ada's account is on the Pro plan.", importance: 7, contradicts: ["ada-basic"] },
  { key: "ada-pro-dup", at: "2026-10-22T15:41:00.000Z", agent: "billing-agent", subject: "customer:ada", text: "Ada's account is on the Pro plan.", importance: 7, live: true },
];

/** Sandbox extras so every Tamper Lab attacker has something to attack (a forgotten memory). */
export const SANDBOX_EXTRAS: SeedItem[] = [
  { at: "2026-10-23T09:30:00.000Z", agent: "support-agent", subject: "customer:ada", text: "Erasure requested by the customer", forget: "ada-address" },
];

interface Customer { slug: string; company: string; contact: string; role: string; plan: string; city: string; product: string; issue: string; pref: string; renewal: string; seats: number; billing: string }

const CUSTOMERS: Customer[] = [
  { slug: "tunde", company: "Brightline Logistics", contact: "Tunde Bakare", role: "head of finance", plan: "Enterprise", city: "Lagos", product: "route planning API", issue: "webhook retries arrive out of order", pref: "a weekly summary email on Mondays", renewal: "March", seats: 120, billing: "annually by bank transfer" },
  { slug: "mei", company: "Harbor & Pine", contact: "Mei Lin", role: "CTO", plan: "Pro", city: "Singapore", product: "inventory sync", issue: "the dashboard times out on large exports", pref: "Slack over email for urgent issues", renewal: "January", seats: 35, billing: "monthly by card" },
  { slug: "sara", company: "Orbit Clinics", contact: "Dr. Sara Haddad", role: "medical director", plan: "Enterprise", city: "Dubai", product: "appointment reminders", issue: "SMS reminders are sent twice for some patients", pref: "calls scheduled through her assistant", renewal: "June", seats: 80, billing: "annually by invoice" },
  { slug: "jonas", company: "Quillon Labs", contact: "Jonas Weber", role: "engineering manager", plan: "Basic", city: "Berlin", product: "audit log export", issue: "audit logs miss events during deploys", pref: "detailed written incident reports", renewal: "September", seats: 12, billing: "monthly by card" },
  { slug: "amara", company: "Sunfield Retail", contact: "Amara Nwosu", role: "COO", plan: "Pro", city: "Accra", product: "point-of-sale integration", issue: "receipts print the wrong currency symbol", pref: "short answers with screenshots", renewal: "November", seats: 48, billing: "quarterly by invoice" },
  { slug: "carlos", company: "Velo Mobility", contact: "Carlos Ruiz", role: "product lead", plan: "Enterprise", city: "Madrid", product: "fleet telemetry", issue: "map tiles load slowly on Android", pref: "a monthly roadmap call", renewal: "April", seats: 200, billing: "annually by bank transfer" },
];

function customerFacts(c: Customer): Omit<SeedItem, "at">[] {
  const s = `customer:${c.slug}`;
  const first = c.contact.replace(/^Dr\. /, "").split(" ")[0];
  return [
    { agent: "onboarding-agent", subject: s, text: `${c.contact} is the ${c.role} at ${c.company}.` },
    { agent: "onboarding-agent", subject: s, text: `${c.company} is on the ${c.plan} plan with ${c.seats} seats.` },
    { agent: "onboarding-agent", subject: s, text: `${c.company} is based in ${c.city}.` },
    { agent: "onboarding-agent", subject: s, kind: "preference", text: `${first} prefers ${c.pref}.` },
    { agent: "billing-agent", subject: s, text: `${c.company} pays ${c.billing}.` },
    { agent: "billing-agent", subject: s, text: `${c.company}'s contract renews in ${c.renewal}.` },
    { agent: "support-agent", subject: s, text: `${c.company} mainly uses the ${c.product}.` },
    { agent: "support-agent", subject: s, kind: "event", text: `${first} reported that ${c.issue}.` },
    { agent: "support-agent", subject: s, kind: "observation", text: `${first} responds fastest in the morning, ${c.city} time.` },
    { agent: "support-agent", subject: s, kind: "event", text: `Engineering confirmed a fix for ${c.company}: ${c.issue} is scheduled for the next release.` },
    { agent: "billing-agent", subject: s, kind: "event", text: `${c.company} asked for a copy of last quarter's invoices.` },
    { agent: "onboarding-agent", subject: s, kind: "observation", text: `${c.company} completed onboarding and connected single sign-on.` },
    { agent: "support-agent", subject: s, kind: "observation", text: `${first} mentioned that ${c.company} is evaluating more seats next quarter.` },
    { agent: "billing-agent", subject: s, text: `${c.company}'s billing contact is the finance team, not ${first}.` },
    { agent: "support-agent", subject: s, kind: "preference", text: `${first} asked us not to schedule maintenance during ${c.city} business hours.` },
  ];
}

const PROJECTS: Omit<SeedItem, "at">[] = [
  ...[
    "Project Apollo is the rewrite of the reporting pipeline in streaming form.",
    "Apollo's target launch is the second week of December.",
    "Apollo uses a columnar store for intermediate results.",
    "The Apollo team decided to drop support for the legacy CSV v1 format.",
    "Apollo's load test reached 40,000 events per second on staging.",
    "Apollo blocks on the data retention policy review from legal.",
    "Apollo's owner is the data platform team led by Kemi.",
    "Apollo dashboards must keep the current export column order for customers.",
    "Apollo's staging cluster runs in the Frankfurt region.",
    "A bug in Apollo's deduplication step drops the final record of a batch.",
    "Apollo will expose a webhook for completed exports.",
    "Apollo weekly sync is on Wednesdays at 10:00.",
    "Apollo's error budget is 0.5 percent of failed exports per month.",
    "Customer CSV export complaints are tracked under the Apollo epic.",
    "Apollo's beta will start with three customers.",
  ].map((text) => ({ agent: "support-agent" as const, subject: "project:apollo", text })),
  ...[
    "Project Atlas is the migration of customer billing to usage-based plans.",
    "Atlas introduces a Basic plan with metered API calls.",
    "Atlas pricing review is owned by the finance team.",
    "Atlas will keep existing Pro plan prices for current customers until renewal.",
    "Atlas needs the invoice service to support credit notes.",
    "Atlas dry run found 14 accounts with mismatched seat counts.",
    "Atlas launch is gated on the billing-agent handling plan change requests.",
    "Atlas will send plan change confirmations by email only.",
    "Atlas migration window is planned for a weekend in November.",
    "Atlas requires a rollback plan approved by the CFO.",
    "Atlas dashboards show per-customer usage by day.",
    "The Atlas team found that downgrades are not reflected in invoices for one cycle.",
    "Atlas usage meters are sampled every five minutes.",
    "Atlas will deprecate the Starter plan.",
    "Atlas customer communication starts two weeks before migration.",
  ].map((text) => ({ agent: "billing-agent" as const, subject: "project:atlas", text })),
];

/** Deterministic background: spread across 19-23 October, interleaved with the story. */
export function backgroundItems(count: number): SeedItem[] {
  const all = [...CUSTOMERS.flatMap(customerFacts), ...PROJECTS];
  // Deterministic shuffle (LCG) so the seed is identical on every run.
  let x = 42;
  const rand = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
  const shuffled = all.map((it) => ({ it, r: rand() })).sort((a, b) => a.r - b.r).map((o) => o.it).slice(0, count);
  const start = Date.parse("2026-10-19T08:00:00.000Z");
  const end = Date.parse("2026-10-23T18:00:00.000Z");
  const step = (end - start) / Math.max(1, shuffled.length);
  return shuffled.map((it, i) => ({ ...it, at: new Date(start + Math.round(i * step) + 7_000).toISOString(), importance: 3 + Math.floor(rand() * 5) }));
}

export function storyTimeline(variant: "demo" | "sandbox", background = variant === "demo" ? 120 : 36): SeedItem[] {
  const items = [...STORY, ...(variant === "sandbox" ? SANDBOX_EXTRAS : []), ...backgroundItems(background)];
  return items.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}
