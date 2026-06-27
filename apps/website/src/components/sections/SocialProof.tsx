'use client';

export default function SocialProof() {
  const stats = [
    { label: 'Data stays on your device', value: '100% local-first' },
    { label: 'No data selling or sharing', value: 'Never' },
    { label: 'You choose what it can see', value: 'Total control' },
    { label: 'Simple approvals for actions', value: 'You decide' },
  ];

  const trustedBy = [
    'Operator‑Founders', 'Product Leads', 'Analysts', 'Consultants', 'Students', 'Researchers', 'Indie Builders', 'Designers'
  ];

  return (
    <section className="py-24 bg-gradient-to-br from-white via-gray-50 to-accent/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center mb-16">
          <h2 className="text-4xl lg:text-5xl font-bold text-gray-900 mb-6">
            Privacy and control, <span className="text-gradient">by default</span>
          </h2>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto">
            No fake metrics. Just honest commitments: local-first execution, no data selling, and you stay in charge of what Stuard can do.
          </p>
        </div>

        {/* Privacy Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 mb-16">
          {stats.map((stat, index) => (
            <div key={index} className="text-center p-6 bg-gradient-to-br from-primary/5 to-secondary/5 rounded-2xl border border-primary/20">
              <div className="text-3xl lg:text-4xl font-bold text-primary mb-2">
                {stat.value}
              </div>
              <div className="text-sm text-gray-700 font-medium">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Trusted By */}
        <div className="text-center">
          <p className="text-sm text-gray-600 mb-6 uppercase tracking-wide font-medium">
            Designed for professionals in
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            {trustedBy.map((category, index) => (
              <span
                key={index}
                className="px-5 py-2.5 bg-white rounded-full text-sm font-medium text-gray-700 shadow-sm border border-gray-300 hover:border-primary hover:shadow-md transition-all"
              >
                {category}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

