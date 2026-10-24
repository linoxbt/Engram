import Link from "next/link";
import { currentUser } from "@/lib/server/session";
import { IconLogo, Wordmark } from "@/components/icons";
import { CopyCommand } from "@/components/landing/copy-command";
import { WaveMesh } from "@/components/landing/wave-mesh";
import { CookieSettingsLink } from "@/components/cookie-settings-link";
import { ProofPlayground } from "@/components/landing/proof-playground";
import { Reveal } from "@/components/landing/reveal";
import { TimeScrubber } from "@/components/landing/time-scrubber";

export const dynamic = "force-dynamic";

const PROMISES = [
  { n: "01", title: "Meaning-addressed", body: "Memories are found by what they mean. Appwrite's built-in embeddings and cosine search, re-ranked by recency, importance and use." },
  { n: "02", title: "Tamper-evident", body: "Every write extends a hash chain. Signed Merkle checkpoints make any later edit, deletion or reordering detectable." },
  { n: "03", title: "Time-travelling", body: "Any question can be asked as of any moment, and the answer is exactly what was valid then. Replayable from entry zero." },
  { n: "04", title: "Self-reconciling", body: "New facts meet their neighbours. Duplicates merge, outdated facts retire, real disagreements wait for a decision." },
  { n: "05", title: "Provably forgettable", body: "Forgetting erases the text, the salt and the vector, and keeps a receipt. The record still verifies. The secret does not survive." },
];

const FLOW = [
  { k: "Remember", d: "An agent calls remember over MCP. The text is embedded and compared with its closest neighbours." },
  { k: "Reconcile", d: "A small model classifies each pair: duplicate, supersedes, contradicts, refines. Conflicts go to an inbox." },
  { k: "Chain", d: "The entry's ID is its sequence number. Two writers race; the database accepts one. No locks, no queue." },
  { k: "Seal", d: "Every few minutes a Function signs the Merkle root with a key the database never sees." },
  { k: "Verify", d: "Anyone recomputes every hash, link, root and signature in their own browser. Trust nobody." },
  { k: "Travel", d: "Drag time backwards and ask again. The past answers, provably, except what was deliberately erased." },
];

const APPWRITE = [
  ["VectorsDB", "memories · concepts · agents · recalls, HNSW cosine"],
  ["Embeddings", "nomic-embed-text 768 · all-minilm 384, built in"],
  ["Unique IDs", "the chain's lock-free concurrency control"],
  ["Transactions", "atomic, conditional derived updates"],
  ["Permissions", "every memory readable only by its space's team"],
  ["Realtime", "new memories arrive in the console as they're written"],
  ["Storage + Functions", "signed checkpoints, scheduled sealing, sentinel"],
  ["Auth + Teams", "one team per space; settings in team preferences"],
];

export default async function Landing() {
  const user = await currentUser();
  const url = process.env.NEXT_PUBLIC_APP_URL ?? "https://engram.example";
  const demo = process.env.NEXT_PUBLIC_DEMO_SPACE ?? null;
  return (
    <div className="prose-sans relative min-h-screen overflow-x-clip bg-bg">
      {/* Floating navigation */}
      <header className="fixed inset-x-0 top-4 z-40 flex justify-center px-4">
        <nav className="l-glass flex h-14 w-full max-w-5xl items-center justify-between !rounded-full !bg-bg/90 px-4 sm:px-6" aria-label="Main">
          <Link href="/" aria-label="Engram home"><Wordmark /></Link>
          <div className="flex items-center gap-1 text-[13px] sm:gap-2">
            <a href="#proof" className="hidden rounded-full px-3 py-1.5 text-muted hover:text-text md:inline">Proof</a>
            <a href="#time" className="hidden rounded-full px-3 py-1.5 text-muted hover:text-text md:inline">Time</a>
            <Link href="/docs" className="hidden rounded-full px-3 py-1.5 text-muted hover:text-text sm:inline">Docs</Link>
            <Link href="/verify" className="hidden rounded-full px-3 py-1.5 text-muted hover:text-text sm:inline">Verify</Link>
            <Link href={user ? "/app" : "/signup"} className="l-btn l-btn-primary !h-9 !px-4 !text-[13px]">{user ? "Console" : "Begin"}</Link>
          </div>
        </nav>
      </header>

      {/* Hero */}
      <section className="relative flex min-h-[100svh] items-center overflow-hidden">
        <div className="l-aurora" />
        {/* Desktop: the memory network rolls through the right of the hero and fades out toward the headline. */}
        <WaveMesh className="absolute right-0 top-24 hidden h-[calc(100%-6rem)] w-[52%] [mask-image:linear-gradient(to_right,transparent,black_40%)] md:block" />
        <div className="l-grain" />
        <div className="relative mx-auto w-full max-w-6xl px-5 pb-20 pt-32 sm:px-8">
          <p className="l-eyebrow">Verifiable memory for artificial minds</p>
          <h1 className="l-display mt-6 max-w-4xl text-[56px] sm:text-[88px] lg:text-[112px]">
            Memory you<br />can <span className="l-serif l-glow-text pr-2">prove.</span>
          </h1>
          <p className="prose-sans mt-8 max-w-xl text-lg font-light leading-relaxed text-text/75">
            Engram is where AI agents keep what they know. Every memory is stored by meaning, chained by hash and replayable in time, so you can always answer the question that matters after a mistake: <em className="text-text">what did it know, and when?</em>
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <Link href={user ? "/app" : "/signup"} className="l-btn l-btn-primary">{user ? "Open the console" : "Create a memory space"} <span aria-hidden>→</span></Link>
            <a href="#proof" className="l-btn l-btn-ghost">Try to break it</a>
            {demo && <Link href={`/verify/${demo}`} className="l-btn l-btn-ghost">Verify the live chain</Link>}
          </div>
          {/* Phones: the network gets its own stage, clear of any text. */}
          <div className="relative -mx-5 mt-10 h-[440px] [mask-image:linear-gradient(to_bottom,transparent,black_12%,black_88%,transparent)] md:hidden">
            <WaveMesh className="absolute inset-0 h-full w-full" />
          </div>
          <dl className="mt-8 grid max-w-2xl md:mt-16 grid-cols-3 gap-6 border-t l-hairline pt-6 font-mono text-[11px] text-muted">
            <div><dt className="tracking-[0.2em]">INTEGRITY</dt><dd className="mt-1 text-sm text-valid">SHA-256 · Ed25519</dd></div>
            <div><dt className="tracking-[0.2em]">PROTOCOL</dt><dd className="mt-1 text-sm text-text">MCP · REST · SDK</dd></div>
            <div><dt className="tracking-[0.2em]">SUBSTRATE</dt><dd className="mt-1 text-sm text-text">Appwrite VectorsDB</dd></div>
          </dl>
        </div>
        <a href="#problem" className="absolute bottom-6 left-1/2 -translate-x-1/2 font-mono text-[10px] tracking-[0.3em] text-muted hover:text-text" aria-label="Scroll">SCROLL ↓</a>
      </section>

      {/* The problem */}
      <section id="problem" className="relative mx-auto max-w-6xl px-5 py-28 sm:px-8 sm:py-36">
        <Reveal><p className="l-eyebrow">The quiet failure of machine memory</p></Reveal>
        <Reveal delay={80}><h2 className="l-display mt-5 max-w-3xl text-4xl sm:text-6xl">Agents remember. Nobody can <span className="l-serif text-accent">prove</span> what they remembered.</h2></Reveal>
        <div className="mt-16 grid gap-10 md:grid-cols-3">
          {[
            ["No witness", "When an agent makes a bad call, its memory has already been overwritten, re-embedded, silently changed. The moment is gone."],
            ["No defence", "One poisoned tool result or one person with database access can change a fact, and every later decision inherits the lie."],
            ["No reconciliation", "Old and new facts come back side by side. And “forget me” means losing the audit trail, or breaking the promise."],
          ].map(([t, d], i) => (
            <Reveal key={t} delay={i * 90}>
              <div className="border-t l-hairline pt-6">
                <span className="font-mono text-xs text-muted">0{i + 1}</span>
                <h3 className="mt-3 text-xl">{t}</h3>
                <p className="prose-sans mt-3 text-[15px] leading-relaxed text-muted">{d}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Proof playground */}
      <section id="proof" className="relative py-24 sm:py-32">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_50%_at_50%_40%,rgba(10,10,10,.035),transparent_70%)]" />
        <div className="relative mx-auto max-w-6xl px-5 sm:px-8">
          <Reveal className="max-w-3xl">
            <p className="l-eyebrow">Don&apos;t trust us. Try it.</p>
            <h2 className="l-display mt-5 text-4xl sm:text-6xl">Change one word.<br /><span className="l-serif text-text">Watch the seal break.</span></h2>
            <p className="prose-sans mt-6 text-lg font-light text-text/70">This is the real verifier, the same code that guards every space, running on your device. Edit a memory, or play the attacker who covers their tracks. Each layer of defence catches a smarter lie.</p>
          </Reveal>
          <Reveal delay={120} className="mt-12"><ProofPlayground /></Reveal>
        </div>
      </section>

      {/* Time */}
      <section id="time" className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 py-24 sm:px-8 sm:py-32 lg:grid-cols-[1fr_1.15fr]">
        <Reveal>
          <p className="l-eyebrow">Time is a dimension of memory</p>
          <h2 className="l-display mt-5 text-4xl sm:text-6xl">Ask the past.<br /><span className="l-serif text-text">It answers honestly.</span></h2>
          <p className="prose-sans mt-6 max-w-md text-lg font-light text-text/70">Every recall can run as of any moment. On Tuesday the agent believed Pro; today it knows Basic. A fact deliberately erased stays erased, and the erasure itself is on the record.</p>
          <p className="prose-sans mt-4 max-w-md text-sm text-muted">Drag the gold handle.</p>
        </Reveal>
        <Reveal delay={120}><TimeScrubber /></Reveal>
      </section>

      {/* Five promises */}
      <section className="relative mx-auto max-w-6xl px-5 py-24 sm:px-8 sm:py-32">
        <Reveal><p className="l-eyebrow">Five promises</p></Reveal>
        <Reveal delay={60}><h2 className="l-display mt-5 max-w-3xl text-4xl sm:text-6xl">What memory should have been from the start.</h2></Reveal>
        <div className="mt-14 grid gap-px overflow-hidden rounded-3xl border l-hairline bg-[rgba(10,10,10,0.08)] sm:grid-cols-2 lg:grid-cols-3">
          {PROMISES.map((p, i) => (
            <Reveal key={p.n} delay={i * 70} className="group bg-bg p-7 transition-colors hover:bg-panel sm:p-9">
              <div className="flex items-baseline justify-between"><span className="font-mono text-xs text-accent">{p.n}</span><span className="size-1.5 rounded-full bg-accent/40 transition-all group-hover:bg-accent group-hover:shadow-[0_0_0_4px_rgba(10,10,10,.08)]" /></div>
              <h3 className="mt-10 text-2xl tracking-tight">{p.title}</h3>
              <p className="prose-sans mt-3 text-[15px] leading-relaxed text-muted">{p.body}</p>
            </Reveal>
          ))}
          <Reveal delay={360} className="relative flex flex-col justify-between overflow-hidden bg-bg p-7 sm:p-9">
            <div className="l-orbit pointer-events-none absolute -right-16 -top-16 size-64 rounded-full border border-dashed border-gold/20" />
            <span className="font-mono text-xs text-gold">∞</span>
            <p className="l-serif mt-10 text-3xl leading-tight text-text/90">&ldquo;The chain is the truth. Everything else is derived.&rdquo;</p>
          </Reveal>
        </div>
      </section>

      {/* Flow */}
      <section className="relative mx-auto max-w-6xl px-5 py-24 sm:px-8 sm:py-32">
        <Reveal><p className="l-eyebrow">How a memory lives</p></Reveal>
        <ol className="relative mt-14 space-y-0">
          <span aria-hidden className="absolute bottom-6 left-[19px] top-6 w-px bg-gradient-to-b from-accent/60 via-violet/40 to-gold/50 sm:left-[23px]" />
          {FLOW.map((f, i) => (
            <Reveal as="li" key={f.k} delay={i * 60} className="relative grid grid-cols-[40px_1fr] gap-5 py-6 sm:grid-cols-[48px_200px_1fr] sm:gap-8">
              <span className="relative z-10 flex size-10 items-center justify-center rounded-full border border-accent/40 bg-bg font-mono text-xs text-accent sm:size-12">{String(i + 1).padStart(2, "0")}</span>
              <h3 className="self-center text-2xl tracking-tight">{f.k}</h3>
              <p className="prose-sans col-start-2 self-center text-[15px] leading-relaxed text-muted sm:col-start-3">{f.d}</p>
            </Reveal>
          ))}
        </ol>
      </section>

      {/* Appwrite */}
      <section className="relative overflow-hidden border-y l-hairline py-24 sm:py-32">
        <div className="l-aurora !opacity-25" />
        <div className="relative mx-auto max-w-6xl px-5 sm:px-8">
          <Reveal className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="l-eyebrow">Substrate</p>
              <h2 className="l-display mt-5 text-4xl sm:text-6xl">Built on <span className="l-serif l-glow-text">Appwrite VectorsDB.</span></h2>
            </div>
            <p className="prose-sans max-w-sm text-sm text-muted">One database, used deeply. Every structured record lives in VectorsDB; every feature below is load-bearing.</p>
          </Reveal>
          <div className="mt-14 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {APPWRITE.map(([t, d], i) => (
              <Reveal key={t} delay={i * 50} className="l-glass !rounded-2xl p-5">
                <div className="font-mono text-xs text-accent">{t}</div>
                <p className="prose-sans mt-3 text-sm leading-relaxed text-text/70">{d}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Connect */}
      <section className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 py-24 sm:px-8 sm:py-32 lg:grid-cols-2">
        <Reveal>
          <p className="l-eyebrow">Sixty seconds</p>
          <h2 className="l-display mt-5 text-4xl sm:text-6xl">Give your agent<br /><span className="l-serif text-accent">a memory it can stand behind.</span></h2>
          <p className="prose-sans mt-6 max-w-md text-lg font-light text-text/70">Create a space, mint an agent key, add one line to any MCP client. Six tools: remember, recall, forget, timeline, verify, resolve.</p>
        </Reveal>
        <Reveal delay={120} className="space-y-3">
          <CopyCommand command={`claude mcp add --transport http engram ${url}/api/mcp --header "Authorization: Bearer eng_…"`} />
          <div className="grid grid-cols-3 gap-3 font-mono text-[11px] text-muted">
            {["remember", "recall", "forget", "timeline", "verify", "resolve"].map((t) => <div key={t} className="rounded-xl border l-hairline px-3 py-2 text-center">{t}()</div>)}
          </div>
        </Reveal>
      </section>

      {/* Closing */}
      <section className="relative overflow-hidden py-32 sm:py-44">
        <div className="l-aurora" />
        <div className="l-grain" />
        <Reveal className="relative mx-auto max-w-4xl px-5 text-center sm:px-8">
          <h2 className="l-display text-5xl sm:text-7xl lg:text-8xl">The past,<br /><span className="l-serif l-glow-text">provable.</span></h2>
          <div className="mt-12 flex flex-wrap justify-center gap-3">
            <Link href={user ? "/app" : "/signup"} className="l-btn l-btn-primary">{user ? "Open the console" : "Start free"} <span aria-hidden>→</span></Link>
            <Link href="/docs" className="l-btn l-btn-ghost">Read the docs</Link>
          </div>
        </Reveal>
      </section>

      <footer className="border-t l-hairline">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-8 font-mono text-[11px] text-muted sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <span className="flex items-center gap-2"><IconLogo size={16} /> engram · memory you can prove</span>
          <span>Built solo for the Appwrite Databases Hackathon · October 2026</span>
          <span className="flex flex-wrap gap-x-4 gap-y-1"><Link href="/docs" className="hover:text-text">Docs</Link><Link href="/verify" className="hover:text-text">Verify</Link><a href="https://github.com/linoxbt/Engram" className="hover:text-text">GitHub</a><Link href="/legal/terms" className="hover:text-text">Terms</Link><Link href="/legal/privacy" className="hover:text-text">Privacy</Link><Link href="/legal/cookies" className="hover:text-text">Cookies</Link><CookieSettingsLink className="hover:text-text" /></span>
        </div>
      </footer>
    </div>
  );
}
