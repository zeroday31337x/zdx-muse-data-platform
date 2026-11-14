const faqs = [
  {
    question: 'What does the ZeroDriveX Data Intelligence Platform do?',
    answer:
      'It helps teams ingest datasets, record source provenance, analyse quality and schema, add governed synthetic data, and export only datasets that satisfy the platform policy.',
  },
  {
    question: 'Why does dataset provenance matter?',
    answer:
      'Provenance shows where records came from and whether their source and licence were verified. Without it, a team cannot reliably judge what a dataset contains or whether it is ready for training.',
  },
  {
    question: 'How much synthetic data can a final dataset contain?',
    answer:
      'At most 30%. Training export requires at least 70% verified authentic records, and records with unknown provenance never count as authentic.',
  },
  {
    question: 'What happens if a dataset does not meet the export policy?',
    answer:
      'Training export is blocked. The dataset can be reviewed, repaired or supplemented with verified authentic records until its final composition satisfies the policy.',
  },
  {
    question: 'Is tenant data public?',
    answer:
      'No. The homepage is public, while dashboards, settings and tenant datasets require sign-in. Operator administration uses a separate authenticated and MFA-gated session.',
  },
];

const structuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': 'https://zerodrivex.com/#organization',
      name: 'ZeroDriveX',
      url: 'https://zerodrivex.com/',
      logo: {
        '@type': 'ImageObject',
        url: 'https://data.zerodrivex.com/icon-512.png',
        width: 512,
        height: 512,
      },
    },
    {
      '@type': 'WebSite',
      '@id': 'https://data.zerodrivex.com/#website',
      url: 'https://data.zerodrivex.com/',
      name: 'ZeroDriveX Data Intelligence Platform',
      publisher: { '@id': 'https://zerodrivex.com/#organization' },
      inLanguage: 'en-US',
    },
    {
      '@type': 'WebPage',
      '@id': 'https://data.zerodrivex.com/#webpage',
      url: 'https://data.zerodrivex.com/',
      name: 'AI Dataset Intelligence & Provenance Platform | ZeroDriveX',
      description:
        'Build training-ready datasets with verified provenance, dataset quality analysis, controlled synthetic augmentation capped at 30%, and audit-ready exports.',
      isPartOf: { '@id': 'https://data.zerodrivex.com/#website' },
      about: { '@id': 'https://data.zerodrivex.com/#software' },
      primaryImageOfPage: {
        '@type': 'ImageObject',
        url: 'https://data.zerodrivex.com/og-image.png',
        width: 1200,
        height: 630,
      },
      inLanguage: 'en-US',
    },
    {
      '@type': 'SoftwareApplication',
      '@id': 'https://data.zerodrivex.com/#software',
      name: 'ZeroDriveX Data Intelligence Platform',
      url: 'https://data.zerodrivex.com/',
      applicationCategory: 'BusinessApplication',
      applicationSubCategory: 'Dataset intelligence and provenance',
      operatingSystem: 'Web',
      publisher: { '@id': 'https://zerodrivex.com/#organization' },
      featureList: [
        'CSV, JSON and JSONL dataset ingestion',
        'Source and licence provenance tracking',
        'Dataset schema and quality analysis',
        'Governed synthetic data augmentation',
        '70% verified-authentic export gate',
        'Durable jobs and audit-ready export manifests',
      ],
      audience: [
        { '@type': 'Audience', audienceType: 'AI and machine-learning teams' },
        { '@type': 'Audience', audienceType: 'Data teams' },
        { '@type': 'Audience', audienceType: 'Dataset builders and evaluators' },
      ],
    },
    {
      '@type': 'FAQPage',
      '@id': 'https://data.zerodrivex.com/#faq',
      mainEntity: faqs.map((faq) => ({
        '@type': 'Question',
        name: faq.question,
        acceptedAnswer: { '@type': 'Answer', text: faq.answer },
      })),
    },
  ],
};

export default function SeoContent() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />

      <section className="seo-section" aria-labelledby="dataset-intelligence-heading">
        <h2 id="dataset-intelligence-heading">Dataset intelligence with provenance you can inspect</h2>
        <p>
          ZeroDriveX is built for teams preparing AI training and evaluation data. It connects the
          records in a dataset to their source evidence, measures quality before export, and keeps
          synthetic data inside a clear governance limit.
        </p>
        <div className="seo-grid">
          <article>
            <h3>Verified data provenance</h3>
            <p>
              Track source and licence evidence for every record. Verified authentic, unverified
              and synthetic records stay distinct, and unknown provenance never counts as authentic.
            </p>
          </article>
          <article>
            <h3>Dataset quality and schema analysis</h3>
            <p>
              Profile a dataset, infer a schema for human review, evaluate quality, and manage
              targeted repair cases without silently changing the underlying provenance.
            </p>
          </article>
          <article>
            <h3>Governed synthetic augmentation</h3>
            <p>
              Add synthetic examples against the composition of the final dataset—not just the
              batch being generated—so the 30% ceiling remains enforceable after joins and imports.
            </p>
          </article>
          <article>
            <h3>Audit-ready exports</h3>
            <p>
              Durable jobs, manifests and composition checks make an export reproducible and
              reviewable. A training export remains blocked until the dataset passes the policy gate.
            </p>
          </article>
        </div>
      </section>

      <section className="seo-section" aria-labelledby="data-faq-heading">
        <h2 id="data-faq-heading">Dataset provenance and synthetic-data FAQs</h2>
        <div className="faq-list">
          {faqs.map((faq) => (
            <details key={faq.question}>
              <summary>{faq.question}</summary>
              <p>{faq.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="seo-section" aria-labelledby="related-platforms-heading">
        <h2 id="related-platforms-heading">Related ZeroDriveX platforms</h2>
        <p>
          The Data Intelligence Platform prepares governed datasets. The{' '}
          <a href="https://viral.zerodrivex.com/">Viral Intelligence Platform</a> maps social
          content performance and patterns, and <a href="https://zerodrivex.com/">ZeroDriveX</a>{' '}
          brings the wider product family together.
        </p>
      </section>
    </>
  );
}
