import { Lock } from "lucide-react";

export default function PrivacyPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 lg:px-6 py-10 space-y-6">
      <header className="space-y-2">
        <div className="flex items-center gap-2 text-primary">
          <Lock className="h-5 w-5" />
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Privacy Notice</h1>
        </div>
        <p className="text-sm text-muted-foreground">Last updated: 05 May 2026</p>
      </header>

      <section className="space-y-3 text-sm leading-relaxed">
        <h2 className="text-base font-semibold text-foreground">What we store</h2>
        <ul className="list-disc list-inside space-y-1.5 text-muted-foreground">
          <li>
            <strong className="text-foreground">Session cookie</strong> — an HMAC-SHA256
            signed, HttpOnly cookie that records whether you've authenticated as
            owner / subscriber and when the session expires.
          </li>
          <li>
            <strong className="text-foreground">Subscriber profile</strong> (if you
            have a granted account) — name, email, the set of tabs you can see, and
            audit timestamps. Stored in our PostgreSQL database.
          </li>
          <li>
            <strong className="text-foreground">Watchlist &amp; paper-trade history</strong>{" "}
            (owner only) — the symbols you save and the simulated trades you log,
            stored against your account.
          </li>
          <li>
            <strong className="text-foreground">Server logs</strong> — request URL,
            HTTP status, response time and IP, retained for ~14 days for debugging
            and abuse-prevention. We do not log request bodies or query parameters
            that contain credentials.
          </li>
        </ul>
      </section>

      <section className="space-y-3 text-sm leading-relaxed">
        <h2 className="text-base font-semibold text-foreground">What we don't do</h2>
        <ul className="list-disc list-inside space-y-1.5 text-muted-foreground">
          <li>No third-party advertising or marketing trackers.</li>
          <li>No analytics SDKs (no Google Analytics, no Mixpanel, no Hotjar).</li>
          <li>No selling, renting or sharing of personal data with anyone.</li>
          <li>No transmission of broker credentials beyond what Kite Connect's official OAuth flow requires.</li>
        </ul>
      </section>

      <section className="space-y-3 text-sm leading-relaxed">
        <h2 className="text-base font-semibold text-foreground">Cookies</h2>
        <p>
          We use exactly one cookie: the session cookie described above. It is
          essential for the site to function and is not used for tracking across
          other sites. Clearing the cookie signs you out.
        </p>
      </section>

      <section className="space-y-3 text-sm leading-relaxed">
        <h2 className="text-base font-semibold text-foreground">Data retention &amp; your rights</h2>
        <p>
          Subscriber profiles persist until the owner removes them. Server logs roll
          off after ~14 days. To request deletion of your profile or any personal
          data, contact the site owner directly. We will action verifiable requests
          within a reasonable period.
        </p>
      </section>

      <section className="space-y-3 text-sm leading-relaxed">
        <h2 className="text-base font-semibold text-foreground">Hosting</h2>
        <p>
          The Service is hosted on Replit Deployments. The hosting provider may
          collect standard infrastructure-level network metadata (TLS handshake,
          aggregate traffic) per its own privacy policy.
        </p>
      </section>
    </div>
  );
}
