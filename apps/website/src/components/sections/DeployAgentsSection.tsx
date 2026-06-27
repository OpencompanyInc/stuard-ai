export default function DeployAgentsSection() {
  return (
    <section id="demo-canvas" className="mt-12 mb-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white/80 rounded-2xl p-8 border border-white/20">
          <h2 className="text-3xl font-bold mb-4">Deploy Agents — describe, deploy, deliver</h2>
          <p className="text-gray-600 mb-6">
            Create agents from plain English goals, assign them to canvases or tasks, and watch them produce artifacts — proposals, demos, outreach sequences, or deployed sites. Agents stream their plan, request approval for sensitive actions, and attach outputs to your canvas.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4">
              <h4 className="font-semibold">One-shot or Persistent</h4>
              <p className="text-gray-600">Run a single job or have an agent watch a folder, run nightly reports, or respond to webhooks.</p>
            </div>
            <div className="p-4">
              <h4 className="font-semibold">Multi-agent workflows</h4>
              <p className="text-gray-600">Assign Researcher, Writer, and Deployer agents to a canvas and let them hand artifacts between each other.</p>
            </div>
            <div className="p-4">
              <h4 className="font-semibold">Human-in-the-loop</h4>
              <p className="text-gray-600">Agents propose actions and wait for approval before executing sensitive operations like pushes or emails.</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
