"use client";

// Lean features: concise 3-card grid + single CTA

const FeaturesShowcase = () => {

  const features = [
    {
      id: 'desktop-automation',
      title: 'Desktop Automation',
      description: 'Control your mouse and keyboard. Stuard can click, type, scroll, and drag-and-drop to automate any desktop application.',
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      ),
    },
    {
      id: 'smart-files',
      title: 'Smart File Operations',
      description: 'Read, write, and organize files automatically. Stuard manages your file system with intelligent sorting and processing.',
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
        </svg>
      ),
    },
    {
      id: 'visual-workflows',
      title: 'Loops & Parallel Execution',
      description: 'Scale your automations. Run tasks in parallel for speed, or use loops and conditions to handle complex, multi-step logic efficiently.',
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
        </svg>
      ),
    },
    {
      id: 'media-intelligence',
      title: 'Media Intelligence',
      description: 'Analyze images and videos. Stuard can understand screen content, process media files, and even analyze YouTube videos.',
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      ),
    },
    {
      id: 'app-integrations',
      title: 'Deep Integrations',
      description: 'Connect with your favorite apps. Seamlessly integrate with GitHub, Google Workspace, and Outlook to automate your workflow.',
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z" />
        </svg>
      ),
    },
    {
      id: 'privacy-control',
      title: 'Privacy & Control',
      description: 'Your data stays yours. Run local workflows securely, with full control over what Stuard sees and touches on your machine.',
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
      ),
    }
  ];

  return (
    <section className="bg-[#0A0A0B] py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Features Grid */}
        <div className="mb-12 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <div
              key={feature.id}
              className="group rounded-2xl border border-white/10 bg-[#111111] p-6 transition-all hover:border-[#FF383C]/40"
            >
              <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-xl border border-[#FF383C]/20 bg-[#FF383C]/10 text-[#FF6B6E]">
                {feature.icon}
              </div>
              <h3 className="mb-2 text-lg font-bold text-white">{feature.title}</h3>
              <p className="text-sm text-[#A3A3A3]">{feature.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default FeaturesShowcase;
