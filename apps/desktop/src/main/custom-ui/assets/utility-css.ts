/**
 * Extra CSS for Custom UI Windows
 *
 * Provides non-Tailwind extras: scrollbar styling, drag support, custom animations.
 * The bulk of utility classes come from the pre-built Tailwind CSS (tailwind-prebuilt.ts),
 * generated at build time from the existing tailwindcss devDependency.
 */

export const EXTRA_CSS = `
/* === Stuard Custom UI Extras (non-Tailwind) === */

/* Scrollbar */
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(148, 163, 184, 0.25); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: rgba(148, 163, 184, 0.4); }

/* Window dragging: add .drag class to make an area draggable (e.g., title bar) */
.drag { -webkit-app-region: drag; }
.drag input, .drag textarea, .drag button, .drag a, .drag select, .no-drag { -webkit-app-region: no-drag; }

/* Custom animations beyond Tailwind defaults */
.fade-in { animation: fadeIn 0.3s ease-out; }
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

.slide-up { animation: slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1); }
@keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

.slide-down { animation: slideDown 0.4s cubic-bezier(0.16, 1, 0.3, 1); }
@keyframes slideDown { from { transform: translateY(-20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

.scale-in { animation: scaleIn 0.3s cubic-bezier(0.16, 1, 0.3, 1); }
@keyframes scaleIn { from { transform: scale(0.95); opacity: 0; } to { transform: scale(1); opacity: 1; } }

/* Glass effect */
.glass {
  background: rgba(255, 255, 255, 0.7) !important;
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(0, 0, 0, 0.08);
}
.dark .glass {
  background: rgba(15, 23, 42, 0.7) !important;
  border-color: rgba(255, 255, 255, 0.08);
}
`;
