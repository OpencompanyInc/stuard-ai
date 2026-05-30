/** Illustration-only: laptop → cloud VM handoff. */

const CloudHandoffDiagram = () => {
  return (
    <figure
      className="mx-auto w-full max-w-[640px]"
      aria-label="Same workflow on your laptop or on a cloud host when your lid is closed."
    >
      <svg viewBox="0 0 640 160" className="h-auto w-full text-[#E5E5E5]" role="img">
        <rect x="40" y="48" width="200" height="88" rx="8" fill="#111111" stroke="#404040" />
        <rect x="56" y="56" width="168" height="56" rx="4" fill="#171717" stroke="#262626" />
        <line x1="56" y1="72" x2="224" y2="72" stroke="#262626" strokeWidth="8" strokeLinecap="round" />
        <text x="140" y="130" textAnchor="middle" fill="#A3A3A3" fontSize="11">
          Your laptop
        </text>
        <text x="140" y="44" textAnchor="middle" fill="#737373" fontSize="10">
          lid closing
        </text>

        <path
          d="M280 92 H360"
          stroke="#525252"
          strokeWidth="2"
          markerEnd="url(#arrow)"
        />
        <defs>
          <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
            <path d="M0 0 L8 4 L0 8 Z" fill="#737373" />
          </marker>
        </defs>

        <rect x="400" y="40" width="200" height="104" rx="8" fill="#111111" stroke="#404040" />
        <rect x="416" y="56" width="168" height="72" rx="4" fill="#171717" stroke="#262626" />
        <circle cx="500" cy="92" r="8" fill="#22c55e" fillOpacity="0.25" stroke="#22c55e" />
        <text x="500" y="130" textAnchor="middle" fill="#A3A3A3" fontSize="11">
          Cloud VM
        </text>
        <text x="500" y="36" textAnchor="middle" fill="#D4D4D4" fontSize="10" fontWeight="500">
          workflow still running
        </text>
      </svg>
      <figcaption className="mt-4 text-center text-[14px] font-medium text-[#D4D4D4]">
        Same workflow. Different host.
      </figcaption>
    </figure>
  );
};

export default CloudHandoffDiagram;
