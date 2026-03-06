/**
 * Extra CSS for Custom UI Windows
 *
 * Provides non-Tailwind extras: scrollbar styling, drag support, custom animations,
 * comprehensive animation library (50+ animations), glassmorphism effects,
 * gradient utilities, and enhanced visual effects.
 *
 * The bulk of utility classes come from the pre-built Tailwind CSS (tailwind-prebuilt.ts),
 * generated at build time from the existing tailwindcss devDependency.
 */

export const EXTRA_CSS = `
/* === Stuard Custom UI Extras === */

/* ========================================
   1. BASE RESETS & SCROLLBAR
   ======================================== */

::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(148, 163, 184, 0.25); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: rgba(148, 163, 184, 0.4); }

/* Window dragging */
.drag { -webkit-app-region: drag; }
.drag input, .drag textarea, .drag button, .drag a, .drag select, .no-drag { -webkit-app-region: no-drag; }

/* ========================================
   2. ENTRANCE ANIMATIONS
   ======================================== */

/* Fade */
.fade-in, .animate-fade-in { animation: fadeIn 0.3s ease-out both; }
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

.fade-in-up, .animate-fade-in-up { animation: fadeInUp 0.5s cubic-bezier(0.16, 1, 0.3, 1) both; }
@keyframes fadeInUp { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: translateY(0); } }

.fade-in-down, .animate-fade-in-down { animation: fadeInDown 0.5s cubic-bezier(0.16, 1, 0.3, 1) both; }
@keyframes fadeInDown { from { opacity: 0; transform: translateY(-24px); } to { opacity: 1; transform: translateY(0); } }

.fade-in-left, .animate-fade-in-left { animation: fadeInLeft 0.5s cubic-bezier(0.16, 1, 0.3, 1) both; }
@keyframes fadeInLeft { from { opacity: 0; transform: translateX(-24px); } to { opacity: 1; transform: translateX(0); } }

.fade-in-right, .animate-fade-in-right { animation: fadeInRight 0.5s cubic-bezier(0.16, 1, 0.3, 1) both; }
@keyframes fadeInRight { from { opacity: 0; transform: translateX(24px); } to { opacity: 1; transform: translateX(0); } }

/* Slide */
.slide-up, .animate-slide-up { animation: slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1) both; }
@keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

.slide-down, .animate-slide-down { animation: slideDown 0.4s cubic-bezier(0.16, 1, 0.3, 1) both; }
@keyframes slideDown { from { transform: translateY(-20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

.slide-in-left, .animate-slide-in-left { animation: slideInLeft 0.5s cubic-bezier(0.16, 1, 0.3, 1) both; }
@keyframes slideInLeft { from { transform: translateX(-100%); } to { transform: translateX(0); } }

.slide-in-right, .animate-slide-in-right { animation: slideInRight 0.5s cubic-bezier(0.16, 1, 0.3, 1) both; }
@keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }

/* Scale */
.scale-in, .animate-scale-in { animation: scaleIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) both; }
@keyframes scaleIn { from { transform: scale(0.95); opacity: 0; } to { transform: scale(1); opacity: 1; } }

.scale-in-center, .animate-scale-in-center { animation: scaleInCenter 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both; }
@keyframes scaleInCenter { from { transform: scale(0); opacity: 0; } to { transform: scale(1); opacity: 1; } }

.zoom-in, .animate-zoom-in { animation: zoomIn 0.6s cubic-bezier(0.16, 1, 0.3, 1) both; }
@keyframes zoomIn {
  from { opacity: 0; transform: scale3d(0.3, 0.3, 0.3); }
  50% { opacity: 1; }
  to { transform: scale3d(1, 1, 1); }
}

/* Bounce */
.bounce-in, .animate-bounce-in { animation: bounceIn 0.6s cubic-bezier(0.68, -0.55, 0.265, 1.55) both; }
@keyframes bounceIn {
  0% { opacity: 0; transform: scale(0.3); }
  50% { opacity: 1; transform: scale(1.05); }
  70% { transform: scale(0.9); }
  100% { transform: scale(1); }
}

.bounce-in-down, .animate-bounce-in-down { animation: bounceInDown 0.8s cubic-bezier(0.215, 0.61, 0.355, 1) both; }
@keyframes bounceInDown {
  0% { opacity: 0; transform: translateY(-200px); }
  60% { opacity: 1; transform: translateY(25px); }
  75% { transform: translateY(-10px); }
  90% { transform: translateY(5px); }
  100% { transform: translateY(0); }
}

.bounce-in-up, .animate-bounce-in-up { animation: bounceInUp 0.8s cubic-bezier(0.215, 0.61, 0.355, 1) both; }
@keyframes bounceInUp {
  0% { opacity: 0; transform: translateY(200px); }
  60% { opacity: 1; transform: translateY(-25px); }
  75% { transform: translateY(10px); }
  90% { transform: translateY(-5px); }
  100% { transform: translateY(0); }
}

/* Flip */
.flip-in-x, .animate-flip-in-x { animation: flipInX 0.6s ease-out both; }
@keyframes flipInX {
  from { opacity: 0; transform: perspective(400px) rotateX(90deg); }
  40% { transform: perspective(400px) rotateX(-20deg); }
  60% { opacity: 1; transform: perspective(400px) rotateX(10deg); }
  80% { transform: perspective(400px) rotateX(-5deg); }
  to { transform: perspective(400px) rotateX(0deg); }
}

.flip-in-y, .animate-flip-in-y { animation: flipInY 0.6s ease-out both; }
@keyframes flipInY {
  from { opacity: 0; transform: perspective(400px) rotateY(90deg); }
  40% { transform: perspective(400px) rotateY(-20deg); }
  60% { opacity: 1; transform: perspective(400px) rotateY(10deg); }
  80% { transform: perspective(400px) rotateY(-5deg); }
  to { transform: perspective(400px) rotateY(0deg); }
}

/* Rotate */
.rotate-in, .animate-rotate-in { animation: rotateIn 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) both; }
@keyframes rotateIn {
  from { opacity: 0; transform: rotate(-200deg); }
  to { opacity: 1; transform: rotate(0); }
}

/* Elastic */
.elastic-in, .animate-elastic-in { animation: elasticIn 0.8s cubic-bezier(0.68, -0.55, 0.265, 1.55) both; }
@keyframes elasticIn {
  0% { opacity: 0; transform: scale(0); }
  55% { opacity: 1; transform: scale(1.1); }
  75% { transform: scale(0.95); }
  100% { transform: scale(1); }
}

/* Blur entrance */
.blur-in, .animate-blur-in { animation: blurIn 0.5s ease-out both; }
@keyframes blurIn {
  from { opacity: 0; filter: blur(12px); }
  to { opacity: 1; filter: blur(0); }
}

/* ========================================
   3. ATTENTION SEEKERS
   ======================================== */

.animate-pulse { animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }

.animate-bounce { animation: bounce 1s infinite; }
@keyframes bounce {
  0%, 100% { transform: translateY(-25%); animation-timing-function: cubic-bezier(0.8, 0, 1, 1); }
  50% { transform: translateY(0); animation-timing-function: cubic-bezier(0, 0, 0.2, 1); }
}

.animate-shake, .shake { animation: shake 0.82s cubic-bezier(0.36, 0.07, 0.19, 0.97) both; }
@keyframes shake {
  10%, 90% { transform: translate3d(-1px, 0, 0); }
  20%, 80% { transform: translate3d(2px, 0, 0); }
  30%, 50%, 70% { transform: translate3d(-4px, 0, 0); }
  40%, 60% { transform: translate3d(4px, 0, 0); }
}

.animate-wobble, .wobble { animation: wobble 1s ease-in-out both; }
@keyframes wobble {
  0% { transform: translateX(0%); }
  15% { transform: translateX(-25%) rotate(-5deg); }
  30% { transform: translateX(20%) rotate(3deg); }
  45% { transform: translateX(-15%) rotate(-3deg); }
  60% { transform: translateX(10%) rotate(2deg); }
  75% { transform: translateX(-5%) rotate(-1deg); }
  100% { transform: translateX(0%); }
}

.animate-tada, .tada { animation: tada 1s ease-in-out both; }
@keyframes tada {
  0% { transform: scale3d(1, 1, 1); }
  10%, 20% { transform: scale3d(0.9, 0.9, 0.9) rotate3d(0, 0, 1, -3deg); }
  30%, 50%, 70%, 90% { transform: scale3d(1.1, 1.1, 1.1) rotate3d(0, 0, 1, 3deg); }
  40%, 60%, 80% { transform: scale3d(1.1, 1.1, 1.1) rotate3d(0, 0, 1, -3deg); }
  100% { transform: scale3d(1, 1, 1); }
}

.animate-heartbeat, .heartbeat { animation: heartbeat 1.5s ease-in-out infinite; }
@keyframes heartbeat {
  0% { transform: scale(1); }
  14% { transform: scale(1.3); }
  28% { transform: scale(1); }
  42% { transform: scale(1.3); }
  70% { transform: scale(1); }
}

.animate-jello, .jello { animation: jello 1s both; }
@keyframes jello {
  0%, 11.1%, 100% { transform: translate3d(0, 0, 0); }
  22.2% { transform: skewX(-12.5deg) skewY(-12.5deg); }
  33.3% { transform: skewX(6.25deg) skewY(6.25deg); }
  44.4% { transform: skewX(-3.125deg) skewY(-3.125deg); }
  55.5% { transform: skewX(1.5625deg) skewY(1.5625deg); }
  66.6% { transform: skewX(-0.78125deg) skewY(-0.78125deg); }
  77.7% { transform: skewX(0.390625deg) skewY(0.390625deg); }
  88.8% { transform: skewX(-0.1953125deg) skewY(-0.1953125deg); }
}

.animate-swing, .swing { animation: swing 1s ease-in-out both; transform-origin: top center; }
@keyframes swing {
  20% { transform: rotate3d(0, 0, 1, 15deg); }
  40% { transform: rotate3d(0, 0, 1, -10deg); }
  60% { transform: rotate3d(0, 0, 1, 5deg); }
  80% { transform: rotate3d(0, 0, 1, -5deg); }
  100% { transform: rotate3d(0, 0, 1, 0deg); }
}

.animate-rubber-band, .rubber-band { animation: rubberBand 1s both; }
@keyframes rubberBand {
  0% { transform: scale3d(1, 1, 1); }
  30% { transform: scale3d(1.25, 0.75, 1); }
  40% { transform: scale3d(0.75, 1.25, 1); }
  50% { transform: scale3d(1.15, 0.85, 1); }
  65% { transform: scale3d(0.95, 1.05, 1); }
  75% { transform: scale3d(1.05, 0.95, 1); }
  100% { transform: scale3d(1, 1, 1); }
}

/* ========================================
   4. CONTINUOUS / LOOPING ANIMATIONS
   ======================================== */

.animate-float, .float { animation: float 3s ease-in-out infinite; }
@keyframes float {
  0%, 100% { transform: translateY(0px); }
  50% { transform: translateY(-10px); }
}

.animate-float-slow { animation: float 6s ease-in-out infinite; }
.animate-float-fast { animation: float 1.5s ease-in-out infinite; }

.animate-glow, .glow { animation: glow 2s ease-in-out infinite; }
@keyframes glow {
  0%, 100% { box-shadow: 0 0 5px rgba(99, 102, 241, 0.3), 0 0 20px rgba(99, 102, 241, 0.1); }
  50% { box-shadow: 0 0 20px rgba(99, 102, 241, 0.6), 0 0 50px rgba(99, 102, 241, 0.2); }
}

.animate-glow-cyan { animation: glowCyan 2s ease-in-out infinite; }
@keyframes glowCyan {
  0%, 100% { box-shadow: 0 0 5px rgba(6, 182, 212, 0.3), 0 0 20px rgba(6, 182, 212, 0.1); }
  50% { box-shadow: 0 0 20px rgba(6, 182, 212, 0.6), 0 0 50px rgba(6, 182, 212, 0.2); }
}

.animate-glow-pink { animation: glowPink 2s ease-in-out infinite; }
@keyframes glowPink {
  0%, 100% { box-shadow: 0 0 5px rgba(236, 72, 153, 0.3), 0 0 20px rgba(236, 72, 153, 0.1); }
  50% { box-shadow: 0 0 20px rgba(236, 72, 153, 0.6), 0 0 50px rgba(236, 72, 153, 0.2); }
}

.animate-shimmer, .shimmer { animation: shimmer 2s linear infinite; background-size: 200% 100%; }
@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

.animate-gradient-shift, .gradient-shift { animation: gradientShift 3s ease infinite; background-size: 200% 200%; }
@keyframes gradientShift {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}

.animate-gradient-x { animation: gradientX 3s ease infinite; background-size: 200% auto; }
@keyframes gradientX {
  0% { background-position: 0% center; }
  50% { background-position: 100% center; }
  100% { background-position: 0% center; }
}

.animate-breathe, .breathe { animation: breathe 4s ease-in-out infinite; }
@keyframes breathe {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.05); opacity: 0.85; }
}

.animate-orbit { animation: orbit 8s linear infinite; }
@keyframes orbit {
  from { transform: rotate(0deg) translateX(30px) rotate(0deg); }
  to { transform: rotate(360deg) translateX(30px) rotate(-360deg); }
}

.animate-spin { animation: spin 1s linear infinite; }
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

.animate-spin-slow { animation: spin 3s linear infinite; }

.animate-ping { animation: ping 1s cubic-bezier(0, 0, 0.2, 1) infinite; }
@keyframes ping { 75%, 100% { transform: scale(2); opacity: 0; } }

.animate-morph { animation: morph 8s ease-in-out infinite; }
@keyframes morph {
  0%, 100% { border-radius: 60% 40% 30% 70% / 60% 30% 70% 40%; }
  50% { border-radius: 30% 60% 70% 40% / 50% 60% 30% 60%; }
}

.animate-wave { animation: wave 2.5s ease-in-out infinite; }
@keyframes wave {
  0% { transform: rotate(0deg); }
  10% { transform: rotate(14deg); }
  20% { transform: rotate(-8deg); }
  30% { transform: rotate(14deg); }
  40% { transform: rotate(-4deg); }
  50% { transform: rotate(10deg); }
  60% { transform: rotate(0deg); }
  100% { transform: rotate(0deg); }
}

.animate-typewriter { animation: typewriter 3s steps(40) 1s both, blink 0.75s step-end infinite; overflow: hidden; white-space: nowrap; border-right: 2px solid; }
@keyframes typewriter { from { width: 0; } to { width: 100%; } }
@keyframes blink { 50% { border-color: transparent; } }

.animate-levitate { animation: levitate 3s ease-in-out infinite; }
@keyframes levitate {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  25% { transform: translateY(-5px) rotate(1deg); }
  75% { transform: translateY(-5px) rotate(-1deg); }
}

.animate-marquee { animation: marquee 15s linear infinite; }
@keyframes marquee { 0% { transform: translateX(100%); } 100% { transform: translateX(-100%); } }

/* ========================================
   5. STAGGER ANIMATION DELAYS
   ======================================== */

.delay-75 { animation-delay: 75ms; }
.delay-100 { animation-delay: 100ms; }
.delay-150 { animation-delay: 150ms; }
.delay-200 { animation-delay: 200ms; }
.delay-300 { animation-delay: 300ms; }
.delay-400 { animation-delay: 400ms; }
.delay-500 { animation-delay: 500ms; }
.delay-600 { animation-delay: 600ms; }
.delay-700 { animation-delay: 700ms; }
.delay-800 { animation-delay: 800ms; }
.delay-1000 { animation-delay: 1000ms; }
.delay-1500 { animation-delay: 1500ms; }
.delay-2000 { animation-delay: 2000ms; }

/* Stagger children helper */
.stagger-children > *:nth-child(1) { animation-delay: 0ms; }
.stagger-children > *:nth-child(2) { animation-delay: 50ms; }
.stagger-children > *:nth-child(3) { animation-delay: 100ms; }
.stagger-children > *:nth-child(4) { animation-delay: 150ms; }
.stagger-children > *:nth-child(5) { animation-delay: 200ms; }
.stagger-children > *:nth-child(6) { animation-delay: 250ms; }
.stagger-children > *:nth-child(7) { animation-delay: 300ms; }
.stagger-children > *:nth-child(8) { animation-delay: 350ms; }
.stagger-children > *:nth-child(9) { animation-delay: 400ms; }
.stagger-children > *:nth-child(10) { animation-delay: 450ms; }

/* ========================================
   6. GROUP-HOVER UTILITIES
   ======================================== */

.group:hover .group-hover\\:translate-y-0 { transform: translateY(0px); }
.group:hover .group-hover\\:translate-x-0 { transform: translateX(0px); }
.group:hover .group-hover\\:text-white { color: #fff; }
.group:hover .group-hover\\:text-black { color: #000; }
.group:hover .group-hover\\:opacity-0 { opacity: 0; }
.group:hover .group-hover\\:opacity-40 { opacity: 0.4; }
.group:hover .group-hover\\:opacity-100 { opacity: 1; }
.group:hover .group-hover\\:scale-100 { transform: scale(1); }
.group:hover .group-hover\\:scale-105 { transform: scale(1.05); }
.group:hover .group-hover\\:scale-110 { transform: scale(1.1); }
.group:hover .group-hover\\:bg-white { background-color: #fff; }
.group:hover .group-hover\\:bg-black { background-color: #000; }
.group:hover .group-hover\\:visible { visibility: visible; }
.group:hover .group-hover\\:block { display: block; }
.group:hover .group-hover\\:flex { display: flex; }
.group:hover .group-hover\\:shadow-lg { box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -4px rgba(0,0,0,0.1); }
.group:hover .group-hover\\:shadow-xl { box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1); }
.group:hover .group-hover\\:ring-2 { box-shadow: 0 0 0 2px rgba(99,102,241,0.5); }
.group:hover .group-hover\\:-translate-y-1 { transform: translateY(-0.25rem); }
.group:hover .group-hover\\:-translate-y-2 { transform: translateY(-0.5rem); }
.group:hover .group-hover\\:brightness-110 { filter: brightness(1.1); }

/* ========================================
   7. TRANSLATE UTILITIES
   ======================================== */

.translate-y-full { transform: translateY(100%); }
.-translate-y-full { transform: translateY(-100%); }
.translate-x-full { transform: translateX(100%); }
.-translate-x-full { transform: translateX(-100%); }
.translate-y-0 { transform: translateY(0px); }
.translate-x-0 { transform: translateX(0px); }
.-translate-y-1 { transform: translateY(-0.25rem); }
.-translate-y-2 { transform: translateY(-0.5rem); }
.-translate-y-4 { transform: translateY(-1rem); }
.-translate-x-1 { transform: translateX(-0.25rem); }

/* ========================================
   8. HOVER UTILITIES
   ======================================== */

.hover\\:scale-100:hover { transform: scale(1); }
.hover\\:scale-102:hover { transform: scale(1.02); }
.hover\\:scale-105:hover { transform: scale(1.05); }
.hover\\:scale-110:hover { transform: scale(1.1); }
.hover\\:-translate-y-1:hover { transform: translateY(-0.25rem); }
.hover\\:-translate-y-2:hover { transform: translateY(-0.5rem); }
.hover\\:shadow-lg:hover { box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -4px rgba(0,0,0,0.1); }
.hover\\:shadow-xl:hover { box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1); }
.hover\\:shadow-2xl:hover { box-shadow: 0 25px 50px -12px rgba(0,0,0,0.25); }
.hover\\:brightness-110:hover { filter: brightness(1.1); }
.hover\\:brightness-125:hover { filter: brightness(1.25); }
.hover\\:saturate-150:hover { filter: saturate(1.5); }
.hover\\:ring-2:hover { box-shadow: 0 0 0 2px rgba(99,102,241,0.5); }
.active\\:scale-95:active { transform: scale(0.95); }
.active\\:scale-98:active { transform: scale(0.98); }
.active\\:scale-100:active { transform: scale(1); }

/* ========================================
   9. TRANSITION UTILITIES
   ======================================== */

.transition-none { transition-property: none; }
.transition-transform { transition-property: transform; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 150ms; }
.transition-colors { transition-property: color, background-color, border-color, text-decoration-color, fill, stroke; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 150ms; }
.transition-all { transition-property: all; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 150ms; }
.transition-opacity { transition-property: opacity; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 150ms; }
.transition-shadow { transition-property: box-shadow; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 150ms; }
.transition { transition-property: color, background-color, border-color, text-decoration-color, fill, stroke, opacity, box-shadow, transform, filter, backdrop-filter; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 150ms; }

.duration-75 { transition-duration: 75ms; }
.duration-100 { transition-duration: 100ms; }
.duration-150 { transition-duration: 150ms; }
.duration-200 { transition-duration: 200ms; }
.duration-300 { transition-duration: 300ms; }
.duration-500 { transition-duration: 500ms; }
.duration-700 { transition-duration: 700ms; }
.duration-1000 { transition-duration: 1000ms; }

.ease-linear { transition-timing-function: linear; }
.ease-in { transition-timing-function: cubic-bezier(0.4, 0, 1, 1); }
.ease-out { transition-timing-function: cubic-bezier(0, 0, 0.2, 1); }
.ease-in-out { transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); }
.ease-spring { transition-timing-function: cubic-bezier(0.34, 1.56, 0.64, 1); }

/* ========================================
   10. OVERFLOW / SCROLLBAR
   ======================================== */

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

/* ========================================
   11. BLUR / FILTER / BACKDROP
   ======================================== */

.blur-none { filter: blur(0); }
.blur-sm { filter: blur(4px); }
.blur-md { filter: blur(12px); }
.blur-lg { filter: blur(16px); }
.blur-xl { filter: blur(24px); }
.blur-2xl { filter: blur(40px); }
.blur-3xl { filter: blur(64px); }
.backdrop-blur-none { backdrop-filter: blur(0); }
.backdrop-blur-sm { backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); }
.backdrop-blur-md { backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); }
.backdrop-blur-lg { backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); }
.backdrop-blur-xl { backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px); }
.backdrop-blur-2xl { backdrop-filter: blur(40px); -webkit-backdrop-filter: blur(40px); }
.backdrop-saturate-150 { backdrop-filter: saturate(1.5); }
.backdrop-saturate-200 { backdrop-filter: saturate(2); }
.backdrop-brightness-75 { backdrop-filter: brightness(0.75); }
.backdrop-brightness-125 { backdrop-filter: brightness(1.25); }
.grayscale { filter: grayscale(100%); }
.grayscale-0 { filter: grayscale(0); }
.invert { filter: invert(100%); }
.brightness-50 { filter: brightness(0.5); }
.brightness-75 { filter: brightness(0.75); }
.brightness-90 { filter: brightness(0.9); }
.brightness-110 { filter: brightness(1.1); }
.brightness-125 { filter: brightness(1.25); }
.saturate-0 { filter: saturate(0); }
.saturate-50 { filter: saturate(0.5); }
.saturate-150 { filter: saturate(1.5); }
.saturate-200 { filter: saturate(2); }
.contrast-75 { filter: contrast(0.75); }
.contrast-125 { filter: contrast(1.25); }

/* ========================================
   12. GLASSMORPHISM & VISUAL EFFECTS
   ======================================== */

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

.glass-sm {
  background: rgba(255, 255, 255, 0.4) !important;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.2);
}
.dark .glass-sm {
  background: rgba(15, 23, 42, 0.4) !important;
  border-color: rgba(255, 255, 255, 0.05);
}

.glass-heavy {
  background: rgba(255, 255, 255, 0.85) !important;
  backdrop-filter: blur(24px) saturate(1.8);
  -webkit-backdrop-filter: blur(24px) saturate(1.8);
  border: 1px solid rgba(0, 0, 0, 0.06);
}
.dark .glass-heavy {
  background: rgba(15, 23, 42, 0.85) !important;
  border-color: rgba(255, 255, 255, 0.1);
}

.glass-colored {
  backdrop-filter: blur(16px) saturate(1.8);
  -webkit-backdrop-filter: blur(16px) saturate(1.8);
}

.noise { position: relative; }
.noise::before {
  content: '';
  position: absolute;
  inset: 0;
  opacity: 0.03;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
  pointer-events: none;
  z-index: 1;
}

/* ========================================
   13. GRADIENT PRESETS
   ======================================== */

.gradient-purple-pink { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
.gradient-blue-cyan { background: linear-gradient(135deg, #3b82f6 0%, #06b6d4 100%); }
.gradient-green-teal { background: linear-gradient(135deg, #10b981 0%, #14b8a6 100%); }
.gradient-orange-red { background: linear-gradient(135deg, #f97316 0%, #ef4444 100%); }
.gradient-pink-rose { background: linear-gradient(135deg, #ec4899 0%, #f43f5e 100%); }
.gradient-indigo-purple { background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%); }
.gradient-sunset { background: linear-gradient(135deg, #f093fb 0%, #f5576c 50%, #fda085 100%); }
.gradient-ocean { background: linear-gradient(135deg, #667eea 0%, #4facfe 50%, #00f2fe 100%); }
.gradient-aurora { background: linear-gradient(135deg, #4facfe 0%, #00f2fe 50%, #43e97b 100%); }
.gradient-candy { background: linear-gradient(135deg, #fa709a 0%, #fee140 100%); }
.gradient-midnight { background: linear-gradient(135deg, #0c0c1d 0%, #1a1a3e 50%, #2d1b69 100%); }
.gradient-fire { background: linear-gradient(135deg, #f12711 0%, #f5af19 100%); }
.gradient-cosmic { background: linear-gradient(135deg, #ff00cc 0%, #333399 100%); }
.gradient-emerald { background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%); }
.gradient-royal { background: linear-gradient(135deg, #141e30 0%, #243b55 100%); }

.gradient-text { -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }

.gradient-border {
  position: relative;
  border: none !important;
}
.gradient-border::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  padding: 1px;
  background: linear-gradient(135deg, #6366f1, #a855f7, #ec4899);
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
}

/* ========================================
   14. SELECTION & CURSOR
   ======================================== */

.selection\\:bg-cyan-500\\/30 *::selection { background-color: rgb(6 182 212 / 0.3); }
.select-none { user-select: none; }
.select-text { user-select: text; }
.select-all { user-select: all; }
.cursor-grab { cursor: grab; }
.cursor-grab:active { cursor: grabbing; }
.cursor-pointer { cursor: pointer; }
.cursor-default { cursor: default; }
.cursor-not-allowed { cursor: not-allowed; }

/* ========================================
   15. TRANSFORM UTILITIES
   ======================================== */

.perspective { perspective: 1000px; }
.perspective-lg { perspective: 2000px; }
.preserve-3d { transform-style: preserve-3d; }
.backface-hidden { backface-visibility: hidden; }
.rotate-x-12 { transform: rotateX(12deg); }
.rotate-y-12 { transform: rotateY(12deg); }
.-rotate-x-12 { transform: rotateX(-12deg); }
.-rotate-y-12 { transform: rotateY(-12deg); }
.rotate-3 { transform: rotate(3deg); }
.-rotate-3 { transform: rotate(-3deg); }
.rotate-6 { transform: rotate(6deg); }
.-rotate-6 { transform: rotate(-6deg); }
.rotate-12 { transform: rotate(12deg); }
.-rotate-12 { transform: rotate(-12deg); }
.rotate-45 { transform: rotate(45deg); }
.rotate-90 { transform: rotate(90deg); }
.rotate-180 { transform: rotate(180deg); }
.skew-x-3 { transform: skewX(3deg); }
.skew-x-6 { transform: skewX(6deg); }
.-skew-x-3 { transform: skewX(-3deg); }
.skew-y-3 { transform: skewY(3deg); }
.-skew-y-3 { transform: skewY(-3deg); }

/* ========================================
   16. ASPECT RATIO & CLIP PATH
   ======================================== */

.aspect-square { aspect-ratio: 1 / 1; }
.aspect-video { aspect-ratio: 16 / 9; }
.aspect-auto { aspect-ratio: auto; }

.clip-circle { clip-path: circle(50%); }
.clip-polygon { clip-path: polygon(50% 0%, 0% 100%, 100% 100%); }
.clip-diamond { clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%); }
.clip-hexagon { clip-path: polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%); }

/* ========================================
   17. TEXT EFFECTS
   ======================================== */

.text-glow { text-shadow: 0 0 10px currentColor, 0 0 20px currentColor, 0 0 40px currentColor; }
.text-glow-sm { text-shadow: 0 0 5px currentColor, 0 0 10px currentColor; }
.text-glow-lg { text-shadow: 0 0 10px currentColor, 0 0 30px currentColor, 0 0 60px currentColor, 0 0 80px currentColor; }
.text-shadow { text-shadow: 0 2px 4px rgba(0,0,0,0.1); }
.text-shadow-lg { text-shadow: 0 4px 8px rgba(0,0,0,0.25); }
.text-shadow-none { text-shadow: none; }

.text-outline {
  -webkit-text-stroke: 1px currentColor;
  -webkit-text-fill-color: transparent;
}

.text-balance { text-wrap: balance; }
.text-pretty { text-wrap: pretty; }

.line-clamp-1 { display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; }
.line-clamp-2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.line-clamp-3 { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }

/* ========================================
   18. SHADOW PRESETS
   ======================================== */

.shadow-glow { box-shadow: 0 0 15px rgba(99, 102, 241, 0.4), 0 0 45px rgba(99, 102, 241, 0.1); }
.shadow-glow-sm { box-shadow: 0 0 10px rgba(99, 102, 241, 0.3); }
.shadow-glow-lg { box-shadow: 0 0 30px rgba(99, 102, 241, 0.5), 0 0 60px rgba(99, 102, 241, 0.2); }
.shadow-neon-blue { box-shadow: 0 0 5px #3b82f6, 0 0 20px #3b82f6, 0 0 40px #3b82f6; }
.shadow-neon-purple { box-shadow: 0 0 5px #a855f7, 0 0 20px #a855f7, 0 0 40px #a855f7; }
.shadow-neon-cyan { box-shadow: 0 0 5px #06b6d4, 0 0 20px #06b6d4, 0 0 40px #06b6d4; }
.shadow-neon-green { box-shadow: 0 0 5px #10b981, 0 0 20px #10b981, 0 0 40px #10b981; }
.shadow-neon-pink { box-shadow: 0 0 5px #ec4899, 0 0 20px #ec4899, 0 0 40px #ec4899; }
.shadow-neon-orange { box-shadow: 0 0 5px #f97316, 0 0 20px #f97316, 0 0 40px #f97316; }
.shadow-inner-glow { box-shadow: inset 0 0 20px rgba(99, 102, 241, 0.3); }

/* Color-specific neon hover */
.hover\\:shadow-neon-blue:hover { box-shadow: 0 0 5px #3b82f6, 0 0 20px #3b82f6, 0 0 40px #3b82f6; }
.hover\\:shadow-neon-purple:hover { box-shadow: 0 0 5px #a855f7, 0 0 20px #a855f7, 0 0 40px #a855f7; }
.hover\\:shadow-neon-cyan:hover { box-shadow: 0 0 5px #06b6d4, 0 0 20px #06b6d4, 0 0 40px #06b6d4; }

/* ========================================
   19. CONTAINER QUERIES (modern CSS)
   ======================================== */

.container-type-inline { container-type: inline-size; }
.container-type-size { container-type: size; }

/* ========================================
   20. CUSTOM PROPERTIES / CSS VARS
   ======================================== */

:root {
  --animation-duration: 300ms;
  --animation-easing: cubic-bezier(0.16, 1, 0.3, 1);
  --glass-bg: rgba(255, 255, 255, 0.7);
  --glass-border: rgba(0, 0, 0, 0.08);
  --glow-color: rgba(99, 102, 241, 0.4);
  --accent-h: 239;
  --accent-s: 84%;
  --accent-l: 67%;
  --accent: hsl(var(--accent-h), var(--accent-s), var(--accent-l));
}

.dark {
  --glass-bg: rgba(15, 23, 42, 0.7);
  --glass-border: rgba(255, 255, 255, 0.08);
}

/* ========================================
   21. ANIMATION FILL / PLAY STATE
   ======================================== */

.fill-forwards { animation-fill-mode: forwards; }
.fill-backwards { animation-fill-mode: backwards; }
.fill-both { animation-fill-mode: both; }
.animation-paused { animation-play-state: paused; }
.animation-running { animation-play-state: running; }
.animation-iteration-1 { animation-iteration-count: 1; }
.animation-iteration-2 { animation-iteration-count: 2; }
.animation-iteration-infinite { animation-iteration-count: infinite; }

/* ========================================
   22. LOADING SKELETONS
   ======================================== */

.skeleton {
  background: linear-gradient(90deg, rgba(255,255,255,0.06) 25%, rgba(255,255,255,0.12) 50%, rgba(255,255,255,0.06) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 8px;
}

.skeleton-text {
  height: 1em;
  border-radius: 4px;
  background: linear-gradient(90deg, rgba(255,255,255,0.06) 25%, rgba(255,255,255,0.12) 50%, rgba(255,255,255,0.06) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}

.skeleton-circle {
  border-radius: 50%;
  background: linear-gradient(90deg, rgba(255,255,255,0.06) 25%, rgba(255,255,255,0.12) 50%, rgba(255,255,255,0.06) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}

/* ========================================
   23. MISC UTILITIES
   ======================================== */

.truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.break-words { word-wrap: break-word; overflow-wrap: break-word; }
.whitespace-nowrap { white-space: nowrap; }
.whitespace-pre-wrap { white-space: pre-wrap; }

.pointer-events-none { pointer-events: none; }
.pointer-events-auto { pointer-events: auto; }

.resize-none { resize: none; }
.resize { resize: both; }
.resize-x { resize: horizontal; }
.resize-y { resize: vertical; }

.appearance-none { -webkit-appearance: none; -moz-appearance: none; appearance: none; }

.will-change-transform { will-change: transform; }
.will-change-opacity { will-change: opacity; }
.will-change-auto { will-change: auto; }

.contain-paint { contain: paint; }
.contain-layout { contain: layout; }
.contain-content { contain: content; }

/* Isolation */
.isolate { isolation: isolate; }

/* Mix blend modes */
.mix-blend-multiply { mix-blend-mode: multiply; }
.mix-blend-screen { mix-blend-mode: screen; }
.mix-blend-overlay { mix-blend-mode: overlay; }
.mix-blend-soft-light { mix-blend-mode: soft-light; }
.mix-blend-difference { mix-blend-mode: difference; }

/* Object fit */
.object-cover { object-fit: cover; }
.object-contain { object-fit: contain; }
.object-fill { object-fit: fill; }
.object-center { object-position: center; }
`;
