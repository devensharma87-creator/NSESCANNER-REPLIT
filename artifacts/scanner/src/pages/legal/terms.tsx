import { FileText } from "lucide-react";
import { Seo } from "@/components/seo";

export default function TermsPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 lg:px-6 py-10 space-y-6">
      <Seo
        path="/legal/terms"
        title="Terms of Use"
        description="Terms of Use for Market Scanner by Dev. Educational and research-only platform; not investment advice or a SEBI-registered advisory."
      />
      <header className="space-y-2">
        <div className="flex items-center gap-2 text-primary">
          <FileText className="h-5 w-5" />
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Terms of Use</h1>
        </div>
        <p className="text-sm text-muted-foreground">Last updated: 05 May 2026</p>
      </header>

      <section className="space-y-3 text-sm leading-relaxed">
        <h2 className="text-base font-semibold text-foreground">1. Acceptance</h2>
        <p>
          By accessing or using Hrishi Associates Market Scanner (the "Service"),
          you agree to these Terms of Use, the linked <a className="underline hover:text-foreground" href="/legal/disclaimer">Disclaimer</a>{" "}
          and the linked <a className="underline hover:text-foreground" href="/legal/privacy">Privacy Notice</a>. If you do not agree, do
          not use the Service.
        </p>
      </section>

      <section className="space-y-3 text-sm leading-relaxed">
        <h2 className="text-base font-semibold text-foreground">2. Educational purpose only</h2>
        <p>
          The Service is provided strictly for education, research, and personal
          analysis. It is not a brokerage, not an investment-advisory service, not a
          research-analyst service, and not a portfolio-management service. See the
          full <a className="underline hover:text-foreground" href="/legal/disclaimer">Disclaimer</a> for the precise scope.
        </p>
      </section>

      <section className="space-y-3 text-sm leading-relaxed">
        <h2 className="text-base font-semibold text-foreground">3. No warranty</h2>
        <p>
          The Service is provided <strong>"as is"</strong> and <strong>"as available"</strong>{" "}
          without warranties of any kind, express or implied — including merchantability,
          fitness for a particular purpose, accuracy, completeness, timeliness, or
          non-infringement. Market data is best-effort and may be delayed, incorrect
          or unavailable due to upstream issues outside our control.
        </p>
      </section>

      <section className="space-y-3 text-sm leading-relaxed">
        <h2 className="text-base font-semibold text-foreground">4. Limitation of liability</h2>
        <p>
          To the maximum extent permitted by law, Hrishi Associates and its
          contributors shall not be liable for any direct, indirect, incidental,
          special, consequential or exemplary damages — including loss of profits,
          trading losses, data loss, or business interruption — arising out of or in
          connection with your use of, or inability to use, the Service.
        </p>
      </section>

      <section className="space-y-3 text-sm leading-relaxed">
        <h2 className="text-base font-semibold text-foreground">5. Account &amp; access</h2>
        <p>
          You are responsible for safeguarding any password or session cookie you
          receive. Do not share credentials. The owner may, at their sole discretion,
          enable or disable public-access mode, suspend access, or terminate accounts
          for any reason without notice.
        </p>
      </section>

      <section className="space-y-3 text-sm leading-relaxed">
        <h2 className="text-base font-semibold text-foreground">6. Acceptable use</h2>
        <p>
          You agree not to: scrape or automate the Service beyond ordinary browser
          use, attempt to circumvent authentication or rate limits, redistribute the
          underlying data to third parties in violation of upstream licences, or use
          the Service to harass, defraud, or break any law.
        </p>
      </section>

      <section className="space-y-3 text-sm leading-relaxed">
        <h2 className="text-base font-semibold text-foreground">7. Changes</h2>
        <p>
          These Terms may be updated at any time. Continued use of the Service after
          changes are posted constitutes acceptance of the revised Terms.
        </p>
      </section>

      <section className="space-y-3 text-sm leading-relaxed">
        <h2 className="text-base font-semibold text-foreground">8. Governing law</h2>
        <p>
          These Terms are governed by the laws of India. Any dispute will be subject
          to the exclusive jurisdiction of the courts at the owner's place of
          residence.
        </p>
      </section>
    </div>
  );
}
