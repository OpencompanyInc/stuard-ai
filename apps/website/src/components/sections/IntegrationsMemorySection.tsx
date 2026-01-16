export default function IntegrationsMemorySection() {
  return (
    <section className="mb-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-gradient-to-r from-indigo-50 to-white rounded-2xl p-8 border border-white/20">
          <h3 className="text-2xl font-bold mb-3">Integrations + Memory = Contextual Superpower</h3>
          <p className="text-gray-600 mb-4">
            Connect Drive, Gmail, Slack, Notion, GitHub and other sources. Stuard AI ingests, summarizes, and retrieves the most relevant memories so agents act using your past work and client history — not guesswork.
          </p>
          <ul className="list-disc ml-6 text-gray-600 space-y-2">
            <li><strong>Live context:</strong> Agents use documents and messages you’ve connected for higher accuracy.</li>
            <li><strong>Project memory:</strong> Per-canvas memory captures decisions and outcomes to make future runs better.</li>
            <li><strong>Provenance:</strong> Every output links back to the source files and shows why it was used.</li>
          </ul>
        </div>
      </div>
    </section>
  );
}
