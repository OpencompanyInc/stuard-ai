export default function UseCasesSection() {
  return (
    <section className="mb-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <h3 className="text-3xl font-bold mb-6 text-center">Who gets value fast</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="bg-white/70 rounded-xl p-4 border border-white/20">
            <h4 className="font-semibold">Agencies</h4>
            <p className="text-gray-600">Auto-generate branded proposals, SOWs, and status decks from a brief.</p>
          </div>
          <div className="bg-white/70 rounded-xl p-4 border border-white/20">
            <h4 className="font-semibold">Founders</h4>
            <p className="text-gray-600">Scaffold landing + Stripe + deploy to Vercel in minutes.</p>
          </div>
          <div className="bg-white/70 rounded-xl p-4 border border-white/20">
            <h4 className="font-semibold">Sales & CS</h4>
            <p className="text-gray-600">Turn call notes into follow-ups & CRM updates automatically.</p>
          </div>
          <div className="bg-white/70 rounded-xl p-4 border border-white/20">
            <h4 className="font-semibold">HR & Ops</h4>
            <p className="text-gray-600">Create onboarding packets, compliance checklists, and policy Q&A.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
