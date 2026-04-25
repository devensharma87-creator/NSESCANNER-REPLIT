import { Link } from "wouter";
import { Sparkles, Zap, Sun, ShieldCheck, BarChart3, Database, ArrowLeft } from "lucide-react";

interface Affirmation {
  text: string;
  icon: typeof Sparkles;
  from: string;
  via: string;
  to: string;
  glow: string;
  borderTone: string;
}

const AFFIRMATIONS: Affirmation[] = [
  {
    text: "You are unique, courageous, and intelligent enough to make it happen.",
    icon: Sparkles,
    from: "from-violet-500",
    via: "via-fuchsia-500",
    to: "to-purple-600",
    glow: "shadow-violet-500/30",
    borderTone: "border-violet-400/40",
  },
  {
    text: "Don't just think — execute and make it happen.",
    icon: Zap,
    from: "from-orange-500",
    via: "via-rose-500",
    to: "to-red-600",
    glow: "shadow-orange-500/30",
    borderTone: "border-orange-400/40",
  },
  {
    text: "Fortune, divine energy, and every force are aligned in your favor.",
    icon: Sun,
    from: "from-amber-400",
    via: "via-yellow-500",
    to: "to-orange-500",
    glow: "shadow-amber-400/30",
    borderTone: "border-amber-300/40",
  },
  {
    text: "Trade with discipline. Act without attachment.",
    icon: ShieldCheck,
    from: "from-emerald-500",
    via: "via-teal-500",
    to: "to-cyan-600",
    glow: "shadow-emerald-500/30",
    borderTone: "border-emerald-400/40",
  },
  {
    text: "Process over profit. Execution over emotion.",
    icon: BarChart3,
    from: "from-sky-500",
    via: "via-blue-500",
    to: "to-indigo-600",
    glow: "shadow-sky-500/30",
    borderTone: "border-sky-400/40",
  },
  {
    text: "Data guides. Discipline decides.",
    icon: Database,
    from: "from-pink-500",
    via: "via-rose-500",
    to: "to-fuchsia-600",
    glow: "shadow-pink-500/30",
    borderTone: "border-pink-400/40",
  },
];

export default function Manifesto() {
  return (
    <div className="relative min-h-[calc(100dvh-12rem)] overflow-hidden">
      {/* Animated background */}
      <style>{`
        @keyframes manifesto-blob {
          0%, 100% { transform: translate(0,0) scale(1); }
          33% { transform: translate(30px,-50px) scale(1.1); }
          66% { transform: translate(-20px,20px) scale(0.95); }
        }
        @keyframes manifesto-shloka-glow {
          0%, 100% { text-shadow: 0 0 24px rgba(251,191,36,0.35), 0 0 4px rgba(251,191,36,0.55); }
          50% { text-shadow: 0 0 32px rgba(251,191,36,0.55), 0 0 8px rgba(251,191,36,0.7); }
        }
        @keyframes manifesto-fade-up {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes manifesto-spin-slow {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .blob { position: absolute; border-radius: 9999px; filter: blur(80px); opacity: 0.35; will-change: transform; pointer-events: none; }
        .blob-a { width: 480px; height: 480px; top: -120px; left: -120px; background: radial-gradient(circle, rgba(251,146,60,0.7), transparent 65%); animation: manifesto-blob 18s ease-in-out infinite; }
        .blob-b { width: 520px; height: 520px; top: 30%; right: -160px; background: radial-gradient(circle, rgba(34,211,238,0.6), transparent 65%); animation: manifesto-blob 22s ease-in-out infinite reverse; }
        .blob-c { width: 460px; height: 460px; bottom: -160px; left: 30%; background: radial-gradient(circle, rgba(168,85,247,0.55), transparent 65%); animation: manifesto-blob 26s ease-in-out infinite; }
        .shloka-line { animation: manifesto-shloka-glow 4s ease-in-out infinite; }
        .fade-up { animation: manifesto-fade-up 0.6s ease-out both; }
        .om-symbol { animation: manifesto-spin-slow 80s linear infinite; }
      `}</style>

      <div className="absolute inset-0 bg-gradient-to-br from-background via-background to-background" />
      <div className="blob blob-a" />
      <div className="blob blob-b" />
      <div className="blob blob-c" />

      {/* Content */}
      <div className="relative max-w-5xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        {/* Back link */}
        <div className="mb-6">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Dashboard
          </Link>
        </div>

        {/* Hero — shloka */}
        <section className="text-center fade-up" style={{ animationDelay: "60ms" }}>
          <div className="om-symbol mx-auto mb-4 text-amber-400/80 select-none" style={{ width: 56, height: 56, fontSize: 56, lineHeight: 1, fontFamily: '"Noto Serif Devanagari", serif' }}>
            ॐ
          </div>

          <div
            className="mx-auto max-w-3xl space-y-2 text-amber-100"
            style={{ fontFamily: '"Noto Serif Devanagari", serif' }}
          >
            <p className="shloka-line text-2xl sm:text-3xl md:text-4xl font-semibold leading-[1.6] text-amber-200">
              कर्मण्येवाधिकारस्ते <span className="text-amber-300">मा</span> फलेषु कदाचन॥
            </p>
            <p className="shloka-line text-2xl sm:text-3xl md:text-4xl font-semibold leading-[1.6] text-amber-200" style={{ animationDelay: "1s" }}>
              मा कर्मफलहेतुर्भूर्मा ते सङ्गोऽस्त्वकर्मणि॥
            </p>
          </div>

          <div className="mt-5 inline-flex items-center gap-3 text-[11px] font-mono uppercase tracking-[0.3em] text-amber-300/80">
            <span className="h-px w-10 bg-amber-300/40" />
            <span>Bhagavad Gītā · 2.47</span>
            <span className="h-px w-10 bg-amber-300/40" />
          </div>

          <p className="mt-4 max-w-2xl mx-auto text-sm sm:text-base italic text-foreground/75 leading-relaxed">
            "You have the right to perform your duties, but you are not entitled to the fruits of your actions.
            Never consider yourself the cause of the results, and never be attached to not doing your duty."
          </p>
        </section>

        {/* Brand banner */}
        <section className="mt-12 sm:mt-14 text-center fade-up" style={{ animationDelay: "180ms" }}>
          <h1
            className="text-4xl sm:text-5xl md:text-6xl font-extrabold italic tracking-tight bg-gradient-to-r from-amber-400 via-orange-500 via-rose-500 to-cyan-500 bg-clip-text text-transparent drop-shadow-sm"
            style={{ fontFamily: '"Playfair Display", Georgia, serif' }}
          >
            Hrishi Associates
          </h1>
          <p className="mt-3 text-[12px] font-mono uppercase tracking-[0.35em] text-foreground/70">
            Market Scanner <span className="text-foreground/35">·</span> by Dev
          </p>
          <p className="mt-2 italic text-sm sm:text-base text-foreground/80">
            Learn Smarter <span className="text-amber-500">·</span> Trade Smarter <span className="text-cyan-500">·</span> Grow Faster
          </p>
        </section>

        {/* Affirmations grid */}
        <section className="mt-14">
          <h2 className="text-center text-xs font-mono uppercase tracking-[0.4em] text-muted-foreground mb-6">
            — The Trader's Code —
          </h2>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {AFFIRMATIONS.map((a, i) => {
              const Icon = a.icon;
              return (
                <div
                  key={i}
                  className="fade-up group relative"
                  style={{ animationDelay: `${260 + i * 80}ms` }}
                >
                  {/* Glow border */}
                  <div className={`absolute -inset-0.5 rounded-2xl bg-gradient-to-br ${a.from} ${a.via} ${a.to} opacity-60 blur-md group-hover:opacity-90 transition-opacity`} />

                  {/* Card body */}
                  <div className={`relative rounded-2xl border ${a.borderTone} bg-card/85 backdrop-blur-md p-5 sm:p-6 h-full flex flex-col gap-3 shadow-lg ${a.glow} transition-transform group-hover:-translate-y-1`}>
                    <div className={`inline-flex items-center justify-center h-10 w-10 rounded-xl bg-gradient-to-br ${a.from} ${a.via} ${a.to} text-white shadow-md`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <p className="text-[15px] sm:text-[16px] leading-snug font-semibold text-foreground">
                      {a.text}
                    </p>
                    <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/70 mt-auto">
                      Verse {String(i + 1).padStart(2, "0")}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Closing */}
        <section className="mt-14 text-center fade-up" style={{ animationDelay: "780ms" }}>
          <div className="inline-flex items-center gap-3 text-xs font-mono uppercase tracking-[0.3em] text-muted-foreground">
            <span className="h-px w-12 bg-border" />
            <span>Trade as Karma. Detach from Phala.</span>
            <span className="h-px w-12 bg-border" />
          </div>
        </section>
      </div>
    </div>
  );
}
