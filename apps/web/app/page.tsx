import Link from "next/link";
import { currentUser } from "@/lib/server/session";
import { HeroChain } from "@/components/hero-chain";
import { IconClock, IconSeal, IconShield, IconForget, IconInbox, IconBolt } from "@/components/icons";
import { SiteFooter, SiteHeader } from "@/components/site-header";

export const dynamic = "force-dynamic";

const DEMO_KEY = process.env.NEXT_PUBLIC_DEMO_SPACE ?? null;

export default async function Landing() {
  const user = await currentUser();
  const url = process.env.NEXT_PUBLIC_APP_URL ?? "https://your-engram.app";
  return (
    <div className="min-h-screen">
      <SiteHeader signedIn={!!user} />
      <main>
        <section className="grid-bg relative border-b border-line">
          <div className="absolute inset-0 bg-gradient-to-b from-bg/40 via-bg/80 to-bg" />
          <div className="relative mx-auto grid max-w-6xl gap-10 px-4 py-16 md:grid-cols-2 md:py-24">
            <div>
              <p className="label text-cyan">Verifiable memory for AI agents</p>
              <h1 className="mt-4 text-2xl leading-tight sm:text-[40px]">Memory you can prove.</h1>
              <p className="prose-sans mt-5 max-w-lg text-base text-muted">
                Engram is a memory layer for AI agents where every memory is stored by meaning, chained by hash, and replayable in time.
                Ask what an agent knew on any past date, catch contradictions as they arrive, and prove that nothing was changed after it was written.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                {DEMO_KEY ? <Link href={`/verify/${DEMO_KEY}`} className="rounded-[2px] border border-gold px-4 py-2.5 text-sm text-gold hover:bg-gold/10">Verify the live demo space</Link> : null}
                <Link href={user ? "/app" : "/signup"} className="rounded-[2px] bg-cyan px-4 py-2.5 text-sm text-bg hover:bg-cyan/85">{user ? "Open dashboard" : "Create your own"}</Link>
                <Link href="/docs" className="rounded-[2px] border border-line-2 px-4 py-2.5 text-sm hover:border-cyan hover:text-cyan">Read the docs</Link>
              </div>
            </div>
            <div className="flex items-center"><HeroChain /></div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16">
          <div className="grid gap-4 md:grid-cols-3">
            {[
              { icon: IconBolt, title: "Remember", text: "Agents call remember over MCP. Engram embeds the text in VectorsDB, checks close neighbours, and marks duplicates, supersessions and conflicts." },
              { icon: IconClock, title: "Travel back", text: "Any recall can run as of a past moment and returns exactly what was valid then. On Tuesday, Pro. Today, Basic. And it can prove it." },
              { icon: IconShield, title: "Prove", text: "Every write extends a hash chain. Signed Merkle checkpoints make any edit, deletion or reordering detectable, and the verifier runs in your browser." },
            ].map((f) => (
              <div key={f.title} className="card p-5">
                <f.icon size={18} className="text-cyan" />
                <h2 className="mt-3 text-sm">{f.title}</h2>
                <p className="prose-sans mt-2 text-sm text-muted">{f.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-y border-line bg-panel/50">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 md:grid-cols-2">
            <div>
              <h2 className="text-lg">Connect in 60 seconds</h2>
              <p className="prose-sans mt-3 text-sm text-muted">Create a space, make an agent key, and add Engram to any MCP client. Tools: remember, recall, forget, timeline, verify and resolve.</p>
              <pre className="mt-5 overflow-x-auto rounded-[2px] border border-line bg-bg p-4 text-xs leading-relaxed"><code>{`claude mcp add --transport http engram ${url}/api/mcp \\
  --header "Authorization: Bearer eng_..."`}</code></pre>
            </div>
            <ul className="space-y-4 text-sm">
              {[
                { icon: IconInbox, t: "Self-reconciling", d: "A later change supersedes an earlier state. Real disagreements land in a review inbox, and every resolution is written into the chain." },
                { icon: IconForget, t: "Provably forgettable", d: "Forgetting erases the text, salt and vector but keeps a salted receipt, so history still verifies and the erasure itself is on record." },
                { icon: IconSeal, t: "Trust nobody", d: "The verifier needs only public header data and a public key. It never sees memory text, and it does not trust the server." },
              ].map((x) => (
                <li key={x.t} className="flex gap-3">
                  <x.icon size={18} className="mt-0.5 shrink-0 text-gold" />
                  <div><div>{x.t}</div><p className="prose-sans mt-1 text-muted">{x.d}</p></div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16">
          <h2 className="text-lg">Built on Appwrite VectorsDB</h2>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Built-in embeddings", "nomic-embed-text for memories, all-minilm for agent capabilities. No outside embedding service."],
              ["HNSW cosine + filters", "Meaning-addressed recall filtered by space, status, kind, subject and time."],
              ["Unique IDs as the lock", "Entry IDs encode the sequence number. Two writers race; the database accepts one; the other retries."],
              ["Transactions", "Derived updates on neighbours commit atomically, with conflict detection."],
              ["Document permissions", "Every entry is readable only by its space's team."],
              ["Realtime", "New memories animate into the dashboard the moment they are written."],
              ["Storage + Functions", "Signed checkpoints are files; a scheduled Function signs them with a key the database never sees."],
              ["Backups", "Daily backup policy on the engram database."],
            ].map(([t, d]) => (
              <div key={t} className="panel p-4"><div className="text-xs text-cyan">{t}</div><p className="prose-sans mt-1.5 text-xs text-muted">{d}</p></div>
            ))}
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
