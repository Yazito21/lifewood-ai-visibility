import type { ReactNode } from "react";

export type ReportBrand = { name: string; logoUrl: string | null };

/** One 16:9 report page: client mark and (for other brands) the Lifewood logo in the header, page number in the footer. */
export function ReportPage({ number, section, title, brand, children, variant = "content" }: {
  number: number;
  section?: string;
  title?: string;
  brand: ReportBrand;
  children: ReactNode;
  variant?: "content" | "cover" | "closing";
}) {
  // When the audited brand is Lifewood itself, its own logo already sits on the left, so the second one is dropped.
  const isLifewood = /lifewood/i.test(brand.name);
  return <section className={`report-page report-page-${variant}`} aria-label={title ?? brand.name}>
    <header className="report-page-header">
      <span className="report-client-mark">
        {brand.logoUrl ? <img src={brand.logoUrl} alt={brand.name} /> : <span>{brand.name.slice(0, 1).toUpperCase()}</span>}
      </span>
      {!isLifewood && <img className="report-lifewood-logo" src="/lifewood-logo.svg" alt="Lifewood" />}
    </header>
    {(section || title) && <div className="report-page-heading">
      {section && <span className="report-section-number">{section}</span>}
      {title && <h2>{title}</h2>}
    </div>}
    <div className="report-page-body">{children}</div>
    {variant === "content" && <footer className="report-page-footer"><span>{brand.name} · AI Visibility &amp; GEO Audit</span><span>{number}</span></footer>}
  </section>;
}
