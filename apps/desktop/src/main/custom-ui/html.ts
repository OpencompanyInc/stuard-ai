import type { CustomUiHtmlOptions } from './types';
import { getReactRuntime, getKatexCss } from './assets/react-runtime';
import { EXTRA_CSS } from './assets/utility-css';
import { prepareComponentCode } from './jsx-transform';

let tailwindPrebuiltCssCache: string | null = null;

function getTailwindPrebuiltCss(): string {
  if (tailwindPrebuiltCssCache !== null) {
    return tailwindPrebuiltCssCache;
  }

  try {
    const mod = require('./assets/tailwind-prebuilt') as { TAILWIND_PREBUILT_CSS?: string };
    tailwindPrebuiltCssCache = typeof mod?.TAILWIND_PREBUILT_CSS === 'string' ? mod.TAILWIND_PREBUILT_CSS : '';
  } catch {
    tailwindPrebuiltCssCache = '';
  }

  return tailwindPrebuiltCssCache;
}

function escapeHtml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Build background CSS from window config options.
 */
function buildBackgroundCss(
  backgroundType: string,
  backgroundColor: string,
  gradient: any,
  backgroundImage: any,
): { backgroundCss: string; backgroundOverlayCss: string } {
  let backgroundCss = '';
  let backgroundOverlayCss = '';

  switch (backgroundType) {
    case 'gradient':
      if (gradient && gradient.stops?.length > 0) {
        const sortedStops = [...gradient.stops].sort((a: any, b: any) => a.position - b.position);
        const stopString = sortedStops.map((s: any) => `${s.color} ${s.position}%`).join(', ');
        if (gradient.type === 'linear') {
          backgroundCss = `background: linear-gradient(${gradient.angle || 135}deg, ${stopString});`;
        } else if (gradient.type === 'radial') {
          backgroundCss = `background: radial-gradient(circle at ${gradient.centerX || 50}% ${gradient.centerY || 50}%, ${stopString});`;
        } else if (gradient.type === 'conic') {
          backgroundCss = `background: conic-gradient(from 0deg at ${gradient.centerX || 50}% ${gradient.centerY || 50}%, ${stopString});`;
        }
      }
      break;
    case 'image':
      if (backgroundImage?.url) {
        const fit = backgroundImage.fit || 'cover';
        const position = backgroundImage.position || 'center';
        const repeat = backgroundImage.repeat || 'no-repeat';
        backgroundCss = `background-image: url('${backgroundImage.url}'); background-size: ${fit}; background-position: ${position}; background-repeat: ${repeat};`;
        if (backgroundImage.opacity !== undefined && backgroundImage.opacity < 1) {
          backgroundOverlayCss = `opacity: ${backgroundImage.opacity};`;
        }
      }
      break;
    case 'translucent':
      // Translucent is handled via translucentCss in buildThemeCss
      backgroundCss = '';
      break;
    case 'color':
    default:
      backgroundCss = `background-color: ${backgroundColor};`;
      break;
  }

  return { backgroundCss, backgroundOverlayCss };
}

/**
 * Build open-animation CSS from config.
 */
function buildAnimationCss(animation: any): { animationCss: string; animationKeyframes: string } {
  let animationCss = '';
  let animationKeyframes = '';
  if (animation?.open && animation.open !== 'none') {
    const duration = animation.duration || 300;
    const easing = animation.easing || 'ease-out';
    const keyframeName = `open-${animation.open}`;
    animationCss = `animation: ${keyframeName} ${duration}ms ${easing};`;
    switch (animation.open) {
      case 'fade':
        animationKeyframes = `@keyframes ${keyframeName} { from { opacity: 0; } to { opacity: 1; } }`;
        break;
      case 'slide-up':
        animationKeyframes = `@keyframes ${keyframeName} { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }`;
        break;
      case 'slide-down':
        animationKeyframes = `@keyframes ${keyframeName} { from { transform: translateY(-20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }`;
        break;
      case 'scale':
        animationKeyframes = `@keyframes ${keyframeName} { from { transform: scale(0.95); opacity: 0; } to { transform: scale(1); opacity: 1; } }`;
        break;
    }
  }
  return { animationCss, animationKeyframes };
}

/**
 * Build the base/theme CSS for a custom UI window.
 */
function buildThemeCss(options: {
  transparentBg: boolean;
  backgroundType: string;
  backgroundColor: string;
  borderRadius: number;
  contentPadding: number;
  overflow: string;
  shadowCss: string;
  borderCss: string;
  backgroundCss: string;
  backgroundOverlayCss: string;
  animationCss: string;
  translucentCss: string;
}): string {
  const {
    transparentBg, backgroundType, backgroundColor,
    borderRadius, contentPadding, overflow,
    shadowCss, borderCss, backgroundCss, backgroundOverlayCss, animationCss,
    translucentCss,
  } = options;

  const radiusStyle = borderRadius > 0 ? `border-radius: ${borderRadius}px;` : '';
  const overflowStyle = overflow ? `overflow: ${overflow};` : (borderRadius > 0 ? 'overflow: hidden;' : '');

  // Determine backgrounds:
  // - transparentBg → everything transparent, components own their bg
  // - backgroundType 'color' with explicit color → use that color
  // - backgroundType 'gradient'/'image'/'translucent' → containers must be transparent
  //   so the background layer (.stuard-background or translucent CSS) shows through
  const containerBg =
    transparentBg ? 'transparent'
    : backgroundType === 'color' && backgroundColor && backgroundColor !== 'transparent'
      ? backgroundColor
    : backgroundType === 'color'
      ? 'white'              // plain color mode with no color set → white fallback
      : 'transparent';       // gradient/image/translucent → let the bg layer show
  const htmlBg = transparentBg || backgroundType !== 'color' ? 'transparent' : 'white';
  const bodyBg = htmlBg;

  return `
    html { background: ${htmlBg}; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; height: 100%; }
    body {
      font-family: 'Inter', 'Outfit', 'Segoe UI', system-ui, -apple-system, sans-serif;
      background: ${bodyBg}; color: #1e293b; height: 100%;
      font-size: 14px; line-height: 1.5;
      ${borderRadius > 0 ? `${radiusStyle} ${overflowStyle}` : ''}
      ${animationCss}
    }
    .overlay-container, .root, .stuard-root {
      background: ${containerBg}; ${radiusStyle} ${shadowCss} ${borderCss} ${overflowStyle}
      height: 100%; ${contentPadding ? `padding: ${contentPadding}px;` : ''}
    }
    ${backgroundType !== 'color' ? `
    .stuard-background { position: fixed; inset: 0; ${backgroundCss} ${backgroundOverlayCss} z-index: -1; }` : ''}
    ${backgroundType === 'translucent' ? `
    .stuard-root, .root, .overlay-container { ${translucentCss} }` : ''}

    /* === Component Defaults === */
    button {
      cursor: pointer; user-select: none; display: inline-flex; align-items: center;
      justify-content: center; border: none; background: transparent;
      color: inherit; border-radius: 8px; font-weight: 500; font-size: 13px;
      transition: all 0.15s ease; padding: 0;
    }
    .btn {
      padding: 8px 16px; background: #f1f5f9; color: #475569; gap: 8px;
    }
    button:active { transform: scale(0.98); }
    .btn:hover { background: #e2e8f0; }
    .btn-primary { background: #4f46e5; color: white; }
    .btn-primary:hover { background: #4338ca; }
    .btn-danger { background: #ef4444; color: white; }
    .btn-danger:hover { background: #dc2626; }
    .btn-secondary { background: #f1f5f9; color: #475569; }
    .btn-secondary:hover { background: #e2e8f0; }
    .btn-ghost { background: transparent; color: #475569; border: none; box-shadow: none; }
    .btn-ghost:hover { background: #f1f5f9; color: #1e293b; }
    .btn-outline { background: transparent; color: #4f46e5; border: 1px solid #4f46e5; }
    .btn-outline:hover { background: #eef2ff; }
    button:disabled, .btn:disabled { opacity: 0.5; cursor: not-allowed; }

    input[type="text"], input[type="email"], input[type="password"], input[type="number"],
    input[type="url"], input[type="tel"], textarea, select {
      background: white; border: 1px solid #e2e8f0; color: #1e293b;
      border-radius: 8px; padding: 8px 12px; width: 100%; outline: none;
      font-size: 14px; transition: border-color 0.15s, box-shadow 0.15s;
    }
    input:focus, textarea:focus, select:focus { border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,0.1); }
    input::placeholder, textarea::placeholder { color: #94a3b8; }

    .glass { background: rgba(255,255,255,0.7)!important; backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); border: 1px solid rgba(0,0,0,0.08); }
    .card { background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    h1, h2, h3, h4, h5, h6 { color: #0f172a; font-weight: 600; margin-bottom: 0.5em; }
    p { margin-bottom: 1em; color: #475569; }
    label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
    input[type="checkbox"] { width: 18px; height: 18px; cursor: pointer; }

    /* Dark mode - add class="dark" to body or html */
    body.dark, .dark body { background: #0f172a; color: #e2e8f0; }
    body.dark .card, .dark .card { background: rgba(30,41,59,0.5); border-color: rgba(255,255,255,0.05); }
    body.dark input, body.dark textarea, body.dark select,
    .dark input, .dark textarea, .dark select {
      background: rgba(15,23,42,0.6); border-color: rgba(148,163,184,0.1); color: #f1f5f9;
    }
    body.dark h1, body.dark h2, body.dark h3, body.dark h4, body.dark h5, body.dark h6,
    .dark h1, .dark h2, .dark h3, .dark h4, .dark h5, .dark h6 { color: #f8fafc; }
    body.dark p, .dark p { color: #cbd5e1; }
    body.dark .btn, .dark .btn { background: #334155; color: white; }
    body.dark .btn:hover, .dark .btn:hover { background: #475569; }
    body.dark .btn-secondary, .dark .btn-secondary { background: #334155; color: white; }
    body.dark .btn-ghost, .dark .btn-ghost { color: #94a3b8; }
    body.dark .btn-ghost:hover, .dark .btn-ghost:hover { background: rgba(255,255,255,0.05); color: #f8fafc; }
    body.dark .glass, .dark .glass { background: rgba(15,23,42,0.7)!important; border-color: rgba(255,255,255,0.08); }

    /* ========== Font Family Utilities ========== */

    /* --- Sans-serif --- */
    .font-inter { font-family: 'Inter', system-ui, -apple-system, sans-serif; }
    .font-outfit { font-family: 'Outfit', system-ui, -apple-system, sans-serif; }
    .font-grotesk, .font-space-grotesk { font-family: 'Space Grotesk', system-ui, -apple-system, sans-serif; }
    .font-poppins { font-family: 'Poppins', system-ui, -apple-system, sans-serif; }
    .font-roboto { font-family: 'Roboto', system-ui, -apple-system, sans-serif; }
    .font-open-sans { font-family: 'Open Sans', system-ui, -apple-system, sans-serif; }
    .font-lato { font-family: 'Lato', system-ui, -apple-system, sans-serif; }
    .font-montserrat { font-family: 'Montserrat', system-ui, -apple-system, sans-serif; }
    .font-raleway { font-family: 'Raleway', system-ui, -apple-system, sans-serif; }
    .font-dm-sans, .font-dm { font-family: 'DM Sans', system-ui, -apple-system, sans-serif; }
    .font-jakarta, .font-plus-jakarta { font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif; }
    .font-manrope { font-family: 'Manrope', system-ui, -apple-system, sans-serif; }
    .font-sora { font-family: 'Sora', system-ui, -apple-system, sans-serif; }
    .font-archivo { font-family: 'Archivo', system-ui, -apple-system, sans-serif; }
    .font-nunito { font-family: 'Nunito', system-ui, -apple-system, sans-serif; }
    .font-quicksand { font-family: 'Quicksand', system-ui, -apple-system, sans-serif; }
    .font-comfortaa { font-family: 'Comfortaa', system-ui, -apple-system, sans-serif; }
    .font-ibm, .font-ibm-plex { font-family: 'IBM Plex Sans', system-ui, -apple-system, sans-serif; }

    /* --- Serif --- */
    .font-playfair { font-family: 'Playfair Display', Georgia, 'Times New Roman', serif; }
    .font-merriweather { font-family: 'Merriweather', Georgia, serif; }
    .font-lora { font-family: 'Lora', Georgia, serif; }
    .font-source-serif { font-family: 'Source Serif 4', Georgia, serif; }
    .font-dm-serif { font-family: 'DM Serif Display', Georgia, serif; }

    /* --- Display / Condensed --- */
    .font-bebas, .font-bebas-neue { font-family: 'Bebas Neue', Impact, sans-serif; }
    .font-oswald { font-family: 'Oswald', Impact, sans-serif; }

    /* --- Handwriting / Script --- */
    .font-caveat { font-family: 'Caveat', cursive; }
    .font-dancing, .font-dancing-script { font-family: 'Dancing Script', cursive; }
    .font-pacifico { font-family: 'Pacifico', cursive; }
    .font-marker, .font-permanent-marker { font-family: 'Permanent Marker', cursive; }
    .font-satisfy { font-family: 'Satisfy', cursive; }

    /* --- Monospace --- */
    .font-mono, .font-code { font-family: 'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace; }
    .font-jetbrains { font-family: 'JetBrains Mono', monospace; }
    .font-fira-code { font-family: 'Fira Code', monospace; }
    .font-source-code { font-family: 'Source Code Pro', monospace; }
    .font-space-mono { font-family: 'Space Mono', monospace; }
    .font-ibm-mono { font-family: 'IBM Plex Mono', monospace; }
    code, pre { font-family: 'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace; }

    /* --- Generic stacks (no Google Fonts needed) --- */
    .font-system { font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    .font-serif-stack { font-family: Georgia, Cambria, 'Times New Roman', Times, serif; }
    .font-mono-stack { font-family: 'Cascadia Code', 'Fira Code', Menlo, Monaco, Consolas, monospace; }

    /* ========== Font Size Utilities ========== */
    .text-2xs { font-size: 0.625rem; line-height: 0.875rem; }   /* 10px */
    .text-xs  { font-size: 0.75rem; line-height: 1rem; }        /* 12px */
    .text-sm  { font-size: 0.875rem; line-height: 1.25rem; }    /* 14px */
    .text-base { font-size: 1rem; line-height: 1.5rem; }        /* 16px */
    .text-lg  { font-size: 1.125rem; line-height: 1.75rem; }    /* 18px */
    .text-xl  { font-size: 1.25rem; line-height: 1.75rem; }     /* 20px */
    .text-2xl { font-size: 1.5rem; line-height: 2rem; }         /* 24px */
    .text-3xl { font-size: 1.875rem; line-height: 2.25rem; }    /* 30px */
    .text-4xl { font-size: 2.25rem; line-height: 2.5rem; }      /* 36px */
    .text-5xl { font-size: 3rem; line-height: 1; }              /* 48px */
    .text-6xl { font-size: 3.75rem; line-height: 1; }           /* 60px */
    .text-7xl { font-size: 4.5rem; line-height: 1; }            /* 72px */
    .text-8xl { font-size: 6rem; line-height: 1; }              /* 96px */
    .text-9xl { font-size: 8rem; line-height: 1; }              /* 128px */

    /* ========== Font Weight Utilities ========== */
    .font-thin       { font-weight: 100; }
    .font-extralight { font-weight: 200; }
    .font-light      { font-weight: 300; }
    .font-normal     { font-weight: 400; }
    .font-medium     { font-weight: 500; }
    .font-semibold   { font-weight: 600; }
    .font-bold       { font-weight: 700; }
    .font-extrabold  { font-weight: 800; }
    .font-black      { font-weight: 900; }

    /* ========== Font Style ========== */
    .italic     { font-style: italic; }
    .not-italic { font-style: normal; }

    /* ========== Letter Spacing (Tracking) ========== */
    .tracking-tighter { letter-spacing: -0.05em; }
    .tracking-tight   { letter-spacing: -0.025em; }
    .tracking-normal  { letter-spacing: 0em; }
    .tracking-wide    { letter-spacing: 0.025em; }
    .tracking-wider   { letter-spacing: 0.05em; }
    .tracking-widest  { letter-spacing: 0.1em; }

    /* ========== Line Height (Leading) ========== */
    .leading-none    { line-height: 1; }
    .leading-tight   { line-height: 1.25; }
    .leading-snug    { line-height: 1.375; }
    .leading-normal  { line-height: 1.5; }
    .leading-relaxed { line-height: 1.625; }
    .leading-loose   { line-height: 2; }
    .leading-3  { line-height: 0.75rem; }
    .leading-4  { line-height: 1rem; }
    .leading-5  { line-height: 1.25rem; }
    .leading-6  { line-height: 1.5rem; }
    .leading-7  { line-height: 1.75rem; }
    .leading-8  { line-height: 2rem; }
    .leading-9  { line-height: 2.25rem; }
    .leading-10 { line-height: 2.5rem; }

    /* ========== Text Transform ========== */
    .uppercase   { text-transform: uppercase; }
    .lowercase   { text-transform: lowercase; }
    .capitalize  { text-transform: capitalize; }
    .normal-case { text-transform: none; }

    /* ========== Text Decoration ========== */
    .underline      { text-decoration-line: underline; }
    .overline       { text-decoration-line: overline; }
    .line-through   { text-decoration-line: line-through; }
    .no-underline   { text-decoration-line: none; }
    .decoration-solid  { text-decoration-style: solid; }
    .decoration-double { text-decoration-style: double; }
    .decoration-dotted { text-decoration-style: dotted; }
    .decoration-dashed { text-decoration-style: dashed; }
    .decoration-wavy   { text-decoration-style: wavy; }
    .decoration-1   { text-decoration-thickness: 1px; }
    .decoration-2   { text-decoration-thickness: 2px; }
    .decoration-4   { text-decoration-thickness: 4px; }
    .underline-offset-1 { text-underline-offset: 1px; }
    .underline-offset-2 { text-underline-offset: 2px; }
    .underline-offset-4 { text-underline-offset: 4px; }
    .underline-offset-8 { text-underline-offset: 8px; }

    /* ========== Text Alignment ========== */
    .text-left    { text-align: left; }
    .text-center  { text-align: center; }
    .text-right   { text-align: right; }
    .text-justify { text-align: justify; }

    /* ========== Word Spacing ========== */
    .word-spacing-tight  { word-spacing: -0.05em; }
    .word-spacing-normal { word-spacing: normal; }
    .word-spacing-wide   { word-spacing: 0.1em; }
    .word-spacing-wider  { word-spacing: 0.25em; }

    /* ========== Numeric / OpenType features ========== */
    .tabular-nums   { font-variant-numeric: tabular-nums; }
    .proportional-nums { font-variant-numeric: proportional-nums; }
    .oldstyle-nums  { font-variant-numeric: oldstyle-nums; }
    .lining-nums    { font-variant-numeric: lining-nums; }
    .small-caps     { font-variant: small-caps; }
    .all-small-caps { font-variant-caps: all-small-caps; }
    .ordinal        { font-variant-numeric: ordinal; }
    .slashed-zero   { font-variant-numeric: slashed-zero; }
    .diagonal-fractions { font-variant-numeric: diagonal-fractions; }

    /* ========== Typography presets (composites) ========== */
    .heading-display {
      font-family: 'Outfit', 'Inter', system-ui, sans-serif;
      font-weight: 700; letter-spacing: -0.025em; line-height: 1.1;
    }
    .heading-serif {
      font-family: 'Playfair Display', Georgia, serif;
      font-weight: 700; letter-spacing: -0.01em; line-height: 1.2;
    }
    .heading-editorial {
      font-family: 'DM Serif Display', Georgia, serif;
      font-weight: 400; letter-spacing: 0; line-height: 1.15;
    }
    .heading-condensed {
      font-family: 'Bebas Neue', 'Oswald', Impact, sans-serif;
      font-weight: 400; letter-spacing: 0.05em; line-height: 1; text-transform: uppercase;
    }
    .body-readable {
      font-family: 'Merriweather', Georgia, serif;
      font-weight: 400; font-size: 1rem; line-height: 1.8; letter-spacing: 0.01em;
    }
    .body-clean {
      font-family: 'Inter', system-ui, sans-serif;
      font-weight: 400; font-size: 0.9375rem; line-height: 1.6;
    }
    .body-friendly {
      font-family: 'Nunito', 'Quicksand', system-ui, sans-serif;
      font-weight: 400; font-size: 1rem; line-height: 1.65;
    }
    .label-ui {
      font-family: 'Inter', system-ui, sans-serif;
      font-weight: 500; font-size: 0.8125rem; line-height: 1; letter-spacing: 0.01em;
    }
    .caption {
      font-size: 0.75rem; line-height: 1rem; color: #64748b; font-weight: 400;
    }
    .overline {
      font-size: 0.6875rem; line-height: 1rem; font-weight: 600;
      letter-spacing: 0.1em; text-transform: uppercase; color: #94a3b8;
    }
    .code-block {
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      font-size: 0.8125rem; line-height: 1.7; letter-spacing: 0;
      tab-size: 2; font-variant-ligatures: contextual;
    }

    /* ========== Responsive text (using clamp) ========== */
    .text-fluid-sm { font-size: clamp(0.75rem, 0.7rem + 0.25vw, 0.875rem); }
    .text-fluid-base { font-size: clamp(0.875rem, 0.8rem + 0.4vw, 1rem); }
    .text-fluid-lg { font-size: clamp(1rem, 0.9rem + 0.5vw, 1.25rem); }
    .text-fluid-xl { font-size: clamp(1.25rem, 1rem + 1vw, 1.75rem); }
    .text-fluid-2xl { font-size: clamp(1.5rem, 1.2rem + 1.5vw, 2.5rem); }
    .text-fluid-3xl { font-size: clamp(1.875rem, 1.4rem + 2.4vw, 3.5rem); }
    .text-fluid-hero { font-size: clamp(2.5rem, 1.5rem + 4vw, 5rem); line-height: 1.05; }
  `;
}

export function generateEnhancedCustomUiHtml(options: CustomUiHtmlOptions): string {
  const {
    id,
    title,
    css,
    data,
    rawHtml,
    borderRadius = 0,
    flowId,
    transparentBg,
    component,
    backgroundType = 'color',
    backgroundColor = 'transparent',
    gradient,
    backgroundImage,
    translucent,
    shadow,
    border,
    animation,
    contentPadding = 0,
    draggable = true,
  } = options;

  // Build sub-CSS pieces
  const { backgroundCss, backgroundOverlayCss } = buildBackgroundCss(backgroundType, backgroundColor, gradient, backgroundImage);

  // Build translucent CSS
  let translucentCss = '';
  if (backgroundType === 'translucent') {
    const tColor = translucent?.color || '#1a1a2e';
    const tOpacity = Math.max(0, Math.min(1, translucent?.opacity ?? 0.7));
    const tBlur = translucent?.blur ?? 12;
    // Convert hex to rgba
    const r = parseInt(tColor.slice(1, 3), 16) || 0;
    const g = parseInt(tColor.slice(3, 5), 16) || 0;
    const b = parseInt(tColor.slice(5, 7), 16) || 0;
    translucentCss = `background-color: rgba(${r}, ${g}, ${b}, ${tOpacity}) !important;`;
    if (tBlur > 0) {
      translucentCss += ` backdrop-filter: blur(${tBlur}px); -webkit-backdrop-filter: blur(${tBlur}px);`;
    }
  }
  const shadowCss = shadow?.enabled
    ? `box-shadow: ${shadow.x || 0}px ${shadow.y || 4}px ${shadow.blur || 12}px ${shadow.spread || 0}px ${shadow.color || '#00000040'};`
    : '';
  const borderCss = border?.enabled
    ? `border: ${border.width || 1}px ${border.style || 'solid'} ${border.color || '#ffffff20'};`
    : '';
  const { animationCss, animationKeyframes } = buildAnimationCss(animation);

  const overflow = options.overflow || '';
  const themeCss = buildThemeCss({
    transparentBg, backgroundType, backgroundColor,
    borderRadius, contentPadding, overflow,
    shadowCss, borderCss, backgroundCss, backgroundOverlayCss, animationCss,
    translucentCss,
  });

  // === Prepare component code ===
  let rawCode: string;
  if (component) {
    rawCode = component;
  } else if (rawHtml) {
    const escapedHtml = JSON.stringify(rawHtml);
    rawCode = `function App() {
      const [formData, setFormData] = React.useState({ ...initialData });
      return React.createElement('div', {
        dangerouslySetInnerHTML: { __html: ${escapedHtml} }
      });
    }`;
  } else {
    rawCode = `function App() {
      return React.createElement('div', {
        className: 'flex items-center justify-center h-full text-slate-400 text-sm'
      }, 'No component defined');
    }`;
  }

  const { code: processedComponent } = prepareComponentCode(rawCode);

  // Load bundled React runtime (offline)
  let reactRuntime: string;
  try {
    reactRuntime = getReactRuntime();
  } catch (err: any) {
    console.error('[custom-ui] Failed to load React runtime:', err);
    reactRuntime = '// React runtime failed to load: ' + String(err?.message || err);
  }

  const bgOverlay = backgroundType !== 'color' ? '<div class="stuard-background"></div>' : '';

  // Build the runtime script for the custom UI window
  const runtimeScript = buildRuntimeScript({
    id, flowId, data, processedComponent,
  });

  // Google Fonts for premium typography — wide selection for diverse UI styles
  const googleFontsLink = `
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@100;200;300;400;500;600;700;800;900&family=JetBrains+Mono:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&family=Outfit:wght@100;200;300;400;500;600;700;800;900&family=Space+Grotesk:wght@300;400;500;600;700&family=Poppins:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,400;1,600&family=Roboto:ital,wght@0,100;0,300;0,400;0,500;0,700;0,900;1,400&family=Open+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400;1,600&family=Lato:ital,wght@0,100;0,300;0,400;0,700;0,900;1,400&family=Montserrat:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,400;1,600&family=Raleway:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,400&family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;0,800;0,900;1,400;1,700&family=Merriweather:ital,wght@0,300;0,400;0,700;0,900;1,400&family=Lora:ital,wght@0,400;0,500;0,600;0,700;1,400;1,700&family=Source+Serif+4:ital,wght@0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,400&family=DM+Sans:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,400&family=DM+Serif+Display:ital@0;1&family=Plus+Jakarta+Sans:ital,wght@0,200;0,300;0,400;0,500;0,600;0,700;0,800;1,400;1,600&family=Manrope:wght@200;300;400;500;600;700;800&family=Sora:wght@100;200;300;400;500;600;700;800&family=Archivo:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,400&family=Bebas+Neue&family=Oswald:wght@200;300;400;500;600;700&family=Caveat:wght@400;500;600;700&family=Dancing+Script:wght@400;500;600;700&family=Pacifico&family=Permanent+Marker&family=Satisfy&family=Fira+Code:wght@300;400;500;600;700&family=Source+Code+Pro:ital,wght@0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,400&family=Space+Mono:ital,wght@0,400;0,700;1,400&family=IBM+Plex+Sans:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;1,400&family=IBM+Plex+Mono:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&family=Nunito:ital,wght@0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,400&family=Quicksand:wght@300;400;500;600;700&family=Comfortaa:wght@300;400;500;600;700&display=swap" rel="stylesheet">`;

  return `<!DOCTYPE html>
<html style="background:transparent!important">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https: file:; img-src * data: blob: local-file: file:; media-src * data: blob: local-file: file:; font-src * data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; connect-src https://fonts.googleapis.com https://fonts.gstatic.com;">
  <title>${escapeHtml(title)}</title>
  ${googleFontsLink}
  <style>${getTailwindPrebuiltCss()}</style>
  <style>${getKatexCss()}</style>
  <style>${EXTRA_CSS}</style>
  <style>${themeCss}\n${css || ''}\n${animationKeyframes}</style>
  <script>${reactRuntime}<\/script>
</head>
<body style="background:transparent!important">
  ${bgOverlay}
  <div class="stuard-root${draggable ? ' drag' : ''}" id="stuard-root"></div>
  <script>${runtimeScript}<\/script>
</body>
</html>`;
}

/**
 * Build the client-side runtime JavaScript that boots React,
 * defines hooks (useVar, useStream), and renders the user component.
 */
function buildRuntimeScript(options: {
  id: string;
  flowId: string;
  data: any;
  processedComponent: string;
}): string {
  const { id, flowId, data, processedComponent } = options;

  return `
    // === Stuard Custom UI Runtime (React + JSX) ===
    (function() {
      'use strict';

      var CUSTOM_UI_ID = ${JSON.stringify(id)};
      var FLOW_ID = ${JSON.stringify(flowId)};

      // Convert raw filesystem paths to file:// URLs so <img src> etc. can load them
      // Uses String.fromCharCode(92) for backslash to avoid template-literal escaping issues
      function toFileUrl(val) {
        if (typeof val !== 'string') return val;
        var bs = String.fromCharCode(92); // backslash
        // Windows absolute path: C:\ or C:/
        if (val.length > 2 && /^[A-Za-z]$/.test(val[0]) && val[1] === ':' && (val[2] === bs || val[2] === '/')) {
          return 'file:///' + val.split(bs).join('/');
        }
        // Unix absolute path with file extension
        if (val[0] === '/' && val[1] !== '/' && val.lastIndexOf('.') > val.lastIndexOf('/')) {
          return 'file://' + val;
        }
        return val;
      }
      function convertDataPaths(obj) {
        if (!obj || typeof obj !== 'object') return obj;
        var out = {};
        for (var k in obj) {
          if (Object.prototype.hasOwnProperty.call(obj, k)) {
            out[k] = toFileUrl(obj[k]);
          }
        }
        return out;
      }

      window.initialData = convertDataPaths(${JSON.stringify(data)});
      var initialData = window.initialData;
      var formData = Object.assign({}, initialData, { flowId: FLOW_ID });
      var hasStuardApi = typeof window.stuard !== 'undefined';

      // === Legacy Fallback: provide basic stuard API when preload is unavailable ===
      if (!hasStuardApi) {
        window.stuard = {
          submit: function(data) {
            // Signal submit via title, then close window
            try { document.title = '__stuard_submit__' + JSON.stringify(data || formData); } catch(e) {}
            window.close();
          },
          close: function(data) {
            try { document.title = '__stuard_close__' + JSON.stringify(data || {}); } catch(e) {}
            window.close();
          },
          action: function(name, data) {
            try { document.title = '__stuard_action__' + JSON.stringify({ action: name, data: data }); } catch(e) {}
          },
          emit: function() {},
          on: function() { return function() {}; },
          getData: function() { return Promise.resolve(initialData); },
          getFlowId: function() { return Promise.resolve(FLOW_ID); },
          getWindowId: function() { return Promise.resolve(CUSTOM_UI_ID); },
          updateData: function(updates) {
            Object.assign(formData, updates);
            Object.assign(initialData, updates);
            return Promise.resolve();
          },
          getVar: function(name) {
            var val = initialData[name];
            return Promise.resolve({ ok: val !== undefined, name: name, value: val });
          },
          setVar: function(name, value) {
            initialData[name] = value;
            formData[name] = value;
            // Notify local listeners
            if (window.__varListeners && window.__varListeners[name]) {
              window.__varListeners[name].forEach(function(cb) { try { cb(value); } catch(e) {} });
            }
            return Promise.resolve({ ok: true, name: name, value: value, type: typeof value });
          },
          subscribeVars: function() { return Promise.resolve(); },
          onVarUpdate: function() { return function() {}; },
          subscribeStream: function() { return Promise.resolve({ ok: false }); },
          unsubscribeStream: function() { return Promise.resolve(); },
          navigate: function() {},
          getCurrentPage: function() { return Promise.resolve(null); },
          onPageChange: function() { return function() {}; },
          log: function(msg) { console.log('[stuard]', msg); },
          copyToClipboard: function(text) { try { navigator.clipboard.writeText(text); } catch(e) {} return Promise.resolve(); },
          notify: function() {},
          setAlwaysOnTop: function() {},
          resize: function() {},
          center: function() {},
        };
        hasStuardApi = true;
      }

      // === Verify React loaded ===
      if (typeof React === 'undefined' || typeof ReactDOM === 'undefined') {
        document.getElementById('stuard-root').innerHTML =
          '<div style="padding:24px;color:#f87171;font-family:system-ui">' +
          '<h2 style="font-size:18px;font-weight:bold;margin-bottom:8px">React Runtime Error</h2>' +
          '<p style="color:#94a3b8;font-size:13px">React or ReactDOM failed to initialize. This is a bug.</p></div>';
        return;
      }

      // === React Hooks (global scope for component code) ===
      var useState = React.useState;
      var useEffect = React.useEffect;
      var useRef = React.useRef;
      var useMemo = React.useMemo;
      var useCallback = React.useCallback;
      var useReducer = React.useReducer;
      var useContext = React.useContext;
      var useLayoutEffect = React.useLayoutEffect;
      var Fragment = React.Fragment;
      var createElement = React.createElement;

      // === Framer Motion (global scope) ===
      var _Motion = (typeof window !== 'undefined' && window.Motion) || {};
      var motion = _Motion.motion || {};
      var AnimatePresence = _Motion.AnimatePresence || React.Fragment;
      var useAnimation = _Motion.useAnimation || function() { return {}; };
      var useMotionValue = _Motion.useMotionValue || function(v) { return { get: function() { return v; }, set: function() {} }; };
      var useTransform = _Motion.useTransform || function(v) { return v; };
      var useSpring = _Motion.useSpring || function(v) { return v; };
      var useInView = _Motion.useInView || function() { return true; };
      var useScroll = _Motion.useScroll || function() { return { scrollY: 0, scrollYProgress: 0 }; };
      var m = motion; // shorthand alias

      // === useStyles Hook — inject dynamic CSS (keyframes, custom animations) ===
      var _styleIdCounter = 0;
      function useStyles(cssString) {
        var idRef = React.useRef('stuard-dyn-' + (++_styleIdCounter));
        React.useEffect(function() {
          var style = document.createElement('style');
          style.id = idRef.current;
          style.textContent = cssString;
          document.head.appendChild(style);
          return function() {
            var el = document.getElementById(idRef.current);
            if (el) el.remove();
          };
        }, [cssString]);
      }

      // === useInterval Hook ===
      function useInterval(callback, delay) {
        var savedCallback = React.useRef(callback);
        React.useEffect(function() { savedCallback.current = callback; }, [callback]);
        React.useEffect(function() {
          if (delay === null || delay === undefined) return;
          var id = setInterval(function() { savedCallback.current(); }, delay);
          return function() { clearInterval(id); };
        }, [delay]);
      }

      // === useTimeout Hook ===
      function useTimeout(callback, delay) {
        var savedCallback = React.useRef(callback);
        React.useEffect(function() { savedCallback.current = callback; }, [callback]);
        React.useEffect(function() {
          if (delay === null || delay === undefined) return;
          var id = setTimeout(function() { savedCallback.current(); }, delay);
          return function() { clearTimeout(id); };
        }, [delay]);
      }

      // === useLocalStorage Hook ===
      function useLocalStorage(key, initialValue) {
        var state = React.useState(function() {
          try {
            var item = window.localStorage.getItem(key);
            return item ? JSON.parse(item) : initialValue;
          } catch (e) { return initialValue; }
        });
        var value = state[0], _setValue = state[1];
        var setValue = React.useCallback(function(newValue) {
          _setValue(newValue);
          try { window.localStorage.setItem(key, JSON.stringify(newValue)); } catch (e) {}
        }, [key]);
        return [value, setValue];
      }

      // === Pre-built Component Library ===

      // Spinner
      function Spinner(props) {
        var size = props.size || 24;
        var color = props.color || 'currentColor';
        return React.createElement('svg', {
          width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
          className: 'animate-spin ' + (props.className || ''),
          style: props.style
        },
          React.createElement('circle', { cx: 12, cy: 12, r: 10, stroke: color, strokeWidth: 3, strokeDasharray: '32 32', strokeLinecap: 'round', opacity: 0.25 }),
          React.createElement('circle', { cx: 12, cy: 12, r: 10, stroke: color, strokeWidth: 3, strokeDasharray: '32 32', strokeDashoffset: 32, strokeLinecap: 'round' })
        );
      }

      // Badge
      function Badge(props) {
        var variants = {
          default: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
          primary: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
          success: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
          warning: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
          danger: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
          info: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',
        };
        var variant = props.variant || 'default';
        return React.createElement('span', {
          className: 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ' + (variants[variant] || variants.default) + ' ' + (props.className || ''),
          style: props.style
        }, props.children);
      }

      // Progress
      function Progress(props) {
        var value = Math.min(100, Math.max(0, props.value || 0));
        var max = props.max || 100;
        var pct = (value / max) * 100;
        var color = props.color || 'bg-indigo-500';
        return React.createElement('div', {
          className: 'w-full bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden ' + (props.className || ''),
          style: Object.assign({ height: props.height || 8 }, props.style)
        },
          React.createElement('div', {
            className: color + ' rounded-full transition-all duration-500 ease-out',
            style: { width: pct + '%', height: '100%' }
          })
        );
      }

      // Skeleton
      function Skeleton(props) {
        return React.createElement('div', {
          className: 'skeleton ' + (props.circle ? 'rounded-full' : 'rounded-lg') + ' ' + (props.className || ''),
          style: Object.assign({ width: props.width || '100%', height: props.height || 20 }, props.style)
        });
      }

      // Tooltip (simple CSS-based)
      function Tooltip(props) {
        var showState = React.useState(false);
        var show = showState[0], setShow = showState[1];
        return React.createElement('div', {
          className: 'relative inline-block',
          onMouseEnter: function() { setShow(true); },
          onMouseLeave: function() { setShow(false); },
        },
          props.children,
          show && React.createElement('div', {
            className: 'absolute z-50 px-3 py-1.5 text-xs font-medium text-white bg-slate-900 dark:bg-slate-700 rounded-lg shadow-lg whitespace-nowrap animate-fade-in pointer-events-none',
            style: { bottom: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)' }
          }, props.content)
        );
      }

      // Switch/Toggle
      function Switch(props) {
        var checked = !!props.checked;
        return React.createElement('button', {
          type: 'button',
          role: 'switch',
          'aria-checked': checked,
          onClick: function() { if (props.onChange) props.onChange(!checked); },
          className: 'relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none ' + (checked ? 'bg-indigo-500' : 'bg-slate-300 dark:bg-slate-600') + ' ' + (props.className || ''),
          style: props.style
        },
          React.createElement('span', {
            className: 'inline-block h-4 w-4 rounded-full bg-white transform transition-transform duration-200 ' + (checked ? 'translate-x-6' : 'translate-x-1')
          })
        );
      }

      // Toast notification (auto-dismiss)
      function Toast(props) {
        var visState = React.useState(true);
        var visible = visState[0];
        var duration = props.duration || 3000;
        React.useEffect(function() {
          var t = setTimeout(function() { visState[1](false); if (props.onDismiss) props.onDismiss(); }, duration);
          return function() { clearTimeout(t); };
        }, []);
        if (!visible) return null;
        var typeStyles = {
          success: 'bg-emerald-500 text-white',
          error: 'bg-red-500 text-white',
          warning: 'bg-amber-500 text-white',
          info: 'bg-blue-500 text-white',
        };
        return React.createElement('div', {
          className: 'fixed bottom-4 right-4 z-50 px-4 py-3 rounded-xl shadow-2xl animate-slide-up font-medium text-sm ' + (typeStyles[props.type] || typeStyles.info) + ' ' + (props.className || ''),
          style: props.style
        }, props.message || props.children);
      }

      // Divider
      function Divider(props) {
        return React.createElement('div', {
          className: 'w-full border-t ' + (props.className || 'border-white/10'),
          style: Object.assign({ margin: '16px 0' }, props.style)
        },
          props.label ? React.createElement('span', {
            className: 'relative inline-block px-3 text-xs text-white/40 bg-inherit',
            style: { top: '-0.7em' }
          }, props.label) : null
        );
      }

      // Avatar
      function Avatar(props) {
        var size = props.size || 40;
        return React.createElement('div', {
          className: 'rounded-full overflow-hidden flex-shrink-0 ' + (props.className || ''),
          style: Object.assign({ width: size, height: size }, props.style)
        },
          props.src
            ? React.createElement('img', { src: props.src, alt: props.alt || '', className: 'w-full h-full object-cover' })
            : React.createElement('div', {
                className: 'w-full h-full flex items-center justify-center bg-indigo-500 text-white font-semibold',
                style: { fontSize: size * 0.4 }
              }, props.name ? props.name.charAt(0).toUpperCase() : '?')
        );
      }

      // Kbd (keyboard shortcut display)
      function Kbd(props) {
        return React.createElement('kbd', {
          className: 'inline-flex items-center px-2 py-0.5 text-xs font-mono font-medium rounded border bg-white/5 border-white/10 text-white/60 ' + (props.className || ''),
          style: props.style
        }, props.children);
      }

      // Markdown — renders markdown strings as real React elements using react-markdown
      // Usage: <Markdown>{markdownString}</Markdown>
      //   or:  <Markdown content={markdownString} />
      //   or:  <Markdown src={markdownString} dark />
      // Props: content/src/children (string), className, style, dark (bool), compact (bool)
      // Supports: GFM tables/strikethrough, LaTeX/KaTeX math ($inline$ and $$block$$)
      function Markdown(props) {
        var source = props.content || props.src || (typeof props.children === 'string' ? props.children : '') || '';
        var darkClass = props.dark ? ' markdown-dark' : '';
        var compactClass = props.compact ? ' markdown-compact' : '';

        // Use the real react-markdown component if loaded
        if (typeof window.ReactMarkdown === 'function') {
          var remarkPlugins = [];
          var rehypePlugins = [];
          if (typeof window.remarkGfm === 'function') {
            remarkPlugins.push(window.remarkGfm);
          }
          if (typeof window.remarkMath === 'function') {
            remarkPlugins.push(window.remarkMath);
          }
          if (typeof window.rehypeKatex === 'function') {
            rehypePlugins.push(window.rehypeKatex);
          }
          return React.createElement('div', {
            className: 'markdown-body' + darkClass + compactClass + ' ' + (props.className || ''),
            style: props.style
          },
            React.createElement(window.ReactMarkdown, {
              remarkPlugins: remarkPlugins,
              rehypePlugins: rehypePlugins,
              children: source
            })
          );
        }

        // Fallback: plain text with newlines
        return React.createElement('div', {
          className: 'markdown-body' + darkClass + compactClass + ' ' + (props.className || ''),
          style: props.style
        },
          React.createElement('pre', {
            style: { whiteSpace: 'pre-wrap', fontFamily: 'inherit' }
          }, source)
        );
      }

      // CodeBlock — code display with optional copy button
      function CodeBlock(props) {
        var code = props.code || props.children || '';
        var language = props.language || props.lang || '';
        var copyable = props.copyable !== false;
        var copiedState = React.useState(false);
        var copied = copiedState[0], setCopied = copiedState[1];
        function handleCopy() {
          if (typeof navigator !== 'undefined' && navigator.clipboard) {
            navigator.clipboard.writeText(code).then(function() {
              setCopied(true);
              setTimeout(function() { setCopied(false); }, 2000);
            });
          }
        }
        return React.createElement('div', {
          className: 'relative group rounded-lg overflow-hidden ' + (props.className || ''),
          style: props.style
        },
          copyable && React.createElement('button', {
            onClick: handleCopy,
            className: 'absolute top-2 right-2 px-2 py-1 text-xs rounded bg-white/10 text-white/60 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white/20'
          }, copied ? 'Copied!' : 'Copy'),
          React.createElement('pre', {
            className: 'p-4 overflow-x-auto text-sm leading-relaxed bg-slate-900 text-slate-200 ' + (language ? 'language-' + language : '')
          },
            React.createElement('code', { className: language ? 'language-' + language : '' }, code)
          )
        );
      }

      // === Variable Subscription ===
      window.__varListeners = {};
      if (hasStuardApi) {
        window.stuard.subscribeVars(['*']);
        window.stuard.onVarUpdate(function(info) {
          var matchNames = [info.name, info.shortName];
          for (var i = 0; i < matchNames.length; i++) {
            var mn = matchNames[i];
            if (window.__varListeners[mn]) {
              window.__varListeners[mn].forEach(function(cb) {
                try { cb(info.value); } catch(e) { console.error('[useVar] listener error:', e); }
              });
            }
          }
        });
      }

      // === useVar Hook ===
      // Seeds from initialData if the variable name matches a data key
      function useVar(varName, defaultValue) {
        var ref = React.useRef({ initialized: false });
        var initVal = (initialData && initialData[varName] !== undefined) ? initialData[varName] : defaultValue;
        var state = React.useState(initVal);
        var value = state[0], _setValue = state[1];

        React.useEffect(function() {
          if (!hasStuardApi) return;

          window.stuard.getVar(varName).then(function(res) {
            if (res.ok && res.value !== undefined && res.value !== null) {
              _setValue(res.value);
            } else if (initVal !== undefined && !ref.current.initialized) {
              // Seed variable store from initialData (or default)
              window.stuard.setVar(varName, initVal);
            }
            ref.current.initialized = true;
          });

          var handler = function(newVal) { _setValue(newVal); };
          if (!window.__varListeners[varName]) window.__varListeners[varName] = [];
          window.__varListeners[varName].push(handler);

          return function() {
            var arr = window.__varListeners[varName];
            if (arr) {
              var idx = arr.indexOf(handler);
              if (idx >= 0) arr.splice(idx, 1);
            }
          };
        }, []);

        var setVar = React.useCallback(function(newVal) {
          _setValue(newVal);
          if (hasStuardApi) window.stuard.setVar(varName, newVal);
        }, [varName]);

        return [value, setVar];
      }

      // === useStream Hook ===
      function useStream(streamId) {
        var chunkState = React.useState(null);
        var chunk = chunkState[0], setChunk = chunkState[1];
        var indexState = React.useState(-1);
        var index = indexState[0], setIndex = indexState[1];
        var doneState = React.useState(false);
        var done = doneState[0], setDone = doneState[1];
        var fullTextState = React.useState('');
        var fullText = fullTextState[0], setFullText = fullTextState[1];
        var subRef = React.useRef(null);

        React.useEffect(function() {
          if (!hasStuardApi || !streamId) return;

          window.stuard.subscribeStream(streamId, function(evt) {
            if (evt.closed || evt.index === -1) { setDone(true); return; }
            setChunk(evt.data);
            setIndex(evt.index);
            if (typeof evt.data === 'string') {
              setFullText(function(prev) { return prev + evt.data; });
            }
          }).then(function(res) {
            if (res.ok) subRef.current = res.subscriberId;
          });

          return function() {
            if (subRef.current) {
              window.stuard.unsubscribeStream(streamId, subRef.current);
            }
          };
        }, [streamId]);

        return {
          chunk: chunk, frame: chunk,
          text: typeof chunk === 'string' ? chunk : null,
          fullText: fullText, index: index, done: done,
        };
      }

      // === User Component ===
      // NOTE: In strict mode, function declarations inside blocks (try/catch)
      // are block-scoped. We convert "function App(" to "App = function App("
      // so the assignment reaches the outer var App.
      var App;
      try {
        ${processedComponent.replace(/^(\s*)function\s+App\s*\(/m, '$1App = function App(')}
      } catch (__compDefError) {
        console.error('[stuard] Component definition error:', __compDefError);
        App = function ErrorApp() {
          return React.createElement('div', { className: 'p-6 space-y-3' },
            React.createElement('h2', { className: 'text-red-500 font-bold text-lg' }, 'Component Error'),
            React.createElement('pre', {
              className: 'text-xs text-red-400 bg-red-50 rounded-lg p-3 overflow-auto max-h-60 whitespace-pre-wrap'
            }, String(__compDefError && __compDefError.message || __compDefError)),
            React.createElement('p', { className: 'text-slate-500 text-sm' }, 'Check the component code for syntax errors.'),
            React.createElement('button', {
              onClick: function() { if (hasStuardApi) stuard.close(); },
              className: 'btn-secondary mt-2'
            }, 'Close')
          );
        };
      }

      // === Render ===
      try {
        var root = document.getElementById('stuard-root');
        var AppComponent = typeof App === 'function' ? App : function() {
          return React.createElement('div', { className: 'p-4 text-red-400' },
            'No App component defined. Your component must define a function named App.'
          );
        };
        ReactDOM.render(React.createElement(AppComponent), root);
      } catch (__renderError) {
        console.error('[stuard] Render error:', __renderError);
        document.getElementById('stuard-root').innerHTML =
          '<div style="padding:24px;color:#f87171;font-family:monospace">' +
          '<h2 style="font-size:18px;font-weight:bold;margin-bottom:8px">Render Error</h2>' +
          '<pre style="font-size:12px;background:#fef2f2;padding:12px;border-radius:8px;white-space:pre-wrap;overflow:auto;max-height:300px">' +
          String(__renderError && __renderError.message || __renderError).replace(/</g, '&lt;') +
          '</pre><p style="color:#94a3b8;font-size:13px;margin-top:12px">The component defined an App function but it failed to render.</p></div>';
      }
    })();
  `;
}
