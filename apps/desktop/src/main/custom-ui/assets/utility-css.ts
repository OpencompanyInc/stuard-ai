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

/* === Group-hover utilities (not in prebuilt Tailwind) === */
.group:hover .group-hover\\:translate-y-0 { transform: translateY(0px); }
.group:hover .group-hover\\:translate-x-0 { transform: translateX(0px); }
.group:hover .group-hover\\:text-white { color: #fff; }
.group:hover .group-hover\\:text-black { color: #000; }
.group:hover .group-hover\\:opacity-0 { opacity: 0; }
.group:hover .group-hover\\:opacity-40 { opacity: 0.4; }
.group:hover .group-hover\\:opacity-100 { opacity: 1; }
.group:hover .group-hover\\:scale-105 { transform: scale(1.05); }
.group:hover .group-hover\\:scale-110 { transform: scale(1.1); }
.group:hover .group-hover\\:bg-white { background-color: #fff; }
.group:hover .group-hover\\:bg-black { background-color: #000; }
.group:hover .group-hover\\:visible { visibility: visible; }
.group:hover .group-hover\\:block { display: block; }
.group:hover .group-hover\\:flex { display: flex; }

/* Translate utilities */
.translate-y-full { transform: translateY(100%); }
.-translate-y-full { transform: translateY(-100%); }
.translate-x-full { transform: translateX(100%); }
.-translate-x-full { transform: translateX(-100%); }
.translate-y-0 { transform: translateY(0px); }
.translate-x-0 { transform: translateX(0px); }

/* Hover utilities */
.hover\\:scale-105:hover { transform: scale(1.05); }
.hover\\:scale-110:hover { transform: scale(1.1); }
.active\\:scale-95:active { transform: scale(0.95); }
.active\\:scale-100:active { transform: scale(1); }

/* Transition utilities */
.transition-transform { transition-property: transform; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 150ms; }
.transition-colors { transition-property: color, background-color, border-color, text-decoration-color, fill, stroke; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 150ms; }
.transition-all { transition-property: all; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 150ms; }
.transition-opacity { transition-property: opacity; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 150ms; }
.duration-200 { transition-duration: 200ms; }
.duration-300 { transition-duration: 300ms; }
.duration-500 { transition-duration: 500ms; }
.duration-700 { transition-duration: 700ms; }
.duration-1000 { transition-duration: 1000ms; }

/* Overflow / scrollbar control */
.overflow-hidden { overflow: hidden; }
.overflow-auto { overflow: auto; }
.overflow-scroll { overflow: scroll; }
.overflow-x-auto { overflow-x: auto; }
.overflow-y-auto { overflow-y: auto; }
.overflow-x-hidden { overflow-x: hidden; }
.overflow-y-hidden { overflow-y: hidden; }
.scrollbar-none::-webkit-scrollbar { display: none; }
.scrollbar-none { -ms-overflow-style: none; scrollbar-width: none; }
.scrollbar-thin::-webkit-scrollbar { width: 4px; height: 4px; }

/* Blur utilities */
.blur-sm { filter: blur(4px); }
.blur-md { filter: blur(12px); }
.blur-lg { filter: blur(16px); }
.blur-xl { filter: blur(24px); }
.blur-2xl { filter: blur(40px); }
.blur-3xl { filter: blur(64px); }
.backdrop-blur-sm { backdrop-filter: blur(4px); }
.backdrop-blur-md { backdrop-filter: blur(12px); }
.backdrop-blur-lg { backdrop-filter: blur(16px); }

/* Selection utilities */
.selection\\:bg-cyan-500\\/30 *::selection { background-color: rgb(6 182 212 / 0.3); }

/* Animate pulse */
.animate-pulse { animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .5; } }

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
