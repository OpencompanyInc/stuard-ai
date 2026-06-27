export default function SecurityTrustSection() {
  return (
    <section id="security" className="mb-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white/75 rounded-2xl p-6 border border-white/20">
          <h3 className="text-2xl font-bold mb-3">Security & Trust</h3>
          <p className="text-gray-600 mb-4">
            We build privacy and control into agent actions: choose sandbox mode, grant least-privilege connector scopes, inspect agent plans before execution, and review full audit logs. Enterprise options include SSO, retention policies, and on-prem or local-only memory.
          </p>
          <div className="flex flex-wrap gap-4 mt-4">
            <span className="px-3 py-1 bg-gray-100 rounded-full text-sm">Sandbox runs</span>
            <span className="px-3 py-1 bg-gray-100 rounded-full text-sm">Audit logs</span>
            <span className="px-3 py-1 bg-gray-100 rounded-full text-sm">Least-privilege connectors</span>
            <span className="px-3 py-1 bg-gray-100 rounded-full text-sm">Data retention controls</span>
          </div>
        </div>
      </div>
    </section>
  );
}
