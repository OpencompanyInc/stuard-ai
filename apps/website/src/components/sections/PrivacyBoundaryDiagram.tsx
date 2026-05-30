/** Illustration-only: privacy boundary (files/screen stay on PC). */

const PrivacyBoundaryDiagram = ({ compact = false }: { compact?: boolean }) => {
  const height = compact ? 140 : 220;

  return (
    <figure
      className={`w-full ${compact ? 'max-w-[360px]' : 'max-w-[520px]'} mx-auto`}
      aria-label="Your PC keeps files, camera, screen, and microphone local. Only encrypted memories and OAuth tokens leave to the cloud."
    >
      <svg
        viewBox="0 0 520 220"
        className="w-full h-auto text-[#E5E5E5]"
        style={{ height }}
        role="img"
      >
        <rect
          x="24"
          y="24"
          width="320"
          height="172"
          rx="12"
          fill="#111111"
          stroke="#404040"
          strokeWidth="1.5"
        />
        <text x="44" y="52" fill="#FF383C" fontSize="11" fontWeight="600" letterSpacing="0.08em">
          YOUR PC
        </text>
        <rect x="44" y="68" width="72" height="28" rx="6" fill="#171717" stroke="#262626" />
        <text x="80" y="86" textAnchor="middle" fill="#D4D4D4" fontSize="10">
          Files
        </text>
        <rect x="124" y="68" width="72" height="28" rx="6" fill="#171717" stroke="#262626" />
        <text x="160" y="86" textAnchor="middle" fill="#D4D4D4" fontSize="10">
          Screen
        </text>
        <rect x="204" y="68" width="72" height="28" rx="6" fill="#171717" stroke="#262626" />
        <text x="240" y="86" textAnchor="middle" fill="#D4D4D4" fontSize="10">
          Camera
        </text>
        <rect x="284" y="68" width="44" height="28" rx="6" fill="#171717" stroke="#262626" />
        <text x="306" y="86" textAnchor="middle" fill="#D4D4D4" fontSize="10">
          Mic
        </text>
        <path
          d="M168 118 L168 148 L200 148"
          stroke="#525252"
          strokeWidth="1"
          fill="none"
        />
        <circle cx="200" cy="148" r="14" fill="#171717" stroke="#737373" />
        <path
          d="M194 148 L198 152 L206 144"
          stroke="#A3A3A3"
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
        />
        <text x="168" y="168" textAnchor="middle" fill="#737373" fontSize="9">
          stays inside
        </text>

        <rect x="380" y="72" width="116" height="76" rx="10" fill="#171717" stroke="#404040" strokeDasharray="4 3" />
        <text x="438" y="98" textAnchor="middle" fill="#A3A3A3" fontSize="10">
          Cloud
        </text>
        <text x="438" y="118" textAnchor="middle" fill="#737373" fontSize="9">
          (optional)
        </text>

        <line x1="344" y1="100" x2="378" y2="100" stroke="#525252" strokeWidth="1" strokeDasharray="3 2" />
        <text x="361" y="92" textAnchor="middle" fill="#525252" fontSize="8">
          encrypted
        </text>
        <line x1="344" y1="130" x2="378" y2="130" stroke="#525252" strokeWidth="1" strokeDasharray="3 2" />
        <text x="438" y="138" textAnchor="middle" fill="#D4D4D4" fontSize="9">
          Memories
        </text>
        <text x="438" y="152" textAnchor="middle" fill="#D4D4D4" fontSize="9">
          OAuth tokens
        </text>
      </svg>
      {!compact ? (
        <figcaption className="mt-3 text-center text-[13px] text-[#737373]">
          Files, screen, camera, and mic never leave your machine.
        </figcaption>
      ) : null}
    </figure>
  );
};

export default PrivacyBoundaryDiagram;
