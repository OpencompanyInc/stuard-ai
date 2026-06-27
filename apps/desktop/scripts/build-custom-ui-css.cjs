/**
 * Build Custom UI CSS
 *
 * Generates a pre-built Tailwind CSS file for custom UI windows.
 * Uses the existing tailwindcss devDependency to generate a comprehensive
 * set of utility classes that work fully offline.
 *
 * Run: node scripts/build-custom-ui-css.cjs
 * Called automatically before build via package.json scripts.
 */

const postcss = require('postcss');
const tailwindcss = require('tailwindcss');
const fs = require('fs');
const path = require('path');

const OUTPUT_PATH = path.join(
  __dirname,
  '../src/main/custom-ui/assets/tailwind-prebuilt.ts'
);

// Tailwind input CSS - include base reset + all utilities
const INPUT_CSS = `
@tailwind base;
@tailwind utilities;
`;

// Tailwind config with comprehensive safelist patterns
// This generates CSS for the most commonly used utility classes
const TAILWIND_CONFIG = {
  content: [{ raw: '' }], // No content scanning - we use safelist
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        dark: { 900: '#0f0f1a', 800: '#1a1a2e', 700: '#2d2d44' },
      },
    },
  },
  safelist: [
    // Display
    { pattern: /^(block|inline-block|inline|flex|inline-flex|grid|inline-grid|hidden|contents)$/ },

    // Position
    { pattern: /^(static|fixed|absolute|relative|sticky)$/ },
    { pattern: /^(inset|top|right|bottom|left)-/ },
    { pattern: /^z-/ },

    // Overflow
    { pattern: /^overflow(-[xy])?-/ },

    // Flexbox
    { pattern: /^flex-(row|col|wrap|nowrap|1|auto|initial|none)/ },
    { pattern: /^(items|justify|self|content|place)-/ },
    { pattern: /^(grow|shrink)/ },
    { pattern: /^(flex-row|flex-col|flex-row-reverse|flex-col-reverse)$/ },

    // Grid
    { pattern: /^grid-cols-/ },
    { pattern: /^grid-rows-/ },
    { pattern: /^(col|row)-span-/ },
    { pattern: /^(col|row)-start-/ },
    { pattern: /^(col|row)-end-/ },
    { pattern: /^place-(items|content|self)-/ },

    // Gap
    { pattern: /^gap(-[xy])?-/ },

    // Spacing (padding + margin)
    { pattern: /^-?[mp][xytblr]?-/ },

    // Space between
    { pattern: /^-?space-[xy]-/ },

    // Width + Height
    { pattern: /^[wh]-/ },
    { pattern: /^(min|max)-[wh]-/ },

    // Typography
    { pattern: /^text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)$/ },
    { pattern: /^text-(left|center|right|justify)$/ },
    { pattern: /^text-(transparent|current|black|white)$/ },
    { pattern: /^text-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d+$/ },
    { pattern: /^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black|mono|sans|serif)$/ },
    { pattern: /^(italic|not-italic)$/ },
    { pattern: /^(underline|overline|line-through|no-underline)$/ },
    { pattern: /^(uppercase|lowercase|capitalize|normal-case)$/ },
    { pattern: /^(truncate|text-ellipsis|text-clip)$/ },
    { pattern: /^whitespace-/ },
    { pattern: /^(break-words|break-all|break-normal)$/ },
    { pattern: /^leading-/ },
    { pattern: /^tracking-/ },

    // Background colors
    { pattern: /^bg-(transparent|current|black|white)$/ },
    { pattern: /^bg-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d+$/ },
    { pattern: /^bg-(black|white)\/(5|10|20|25|30|40|50|60|70|75|80|90|95)$/ },

    // Gradients
    { pattern: /^bg-gradient-to-(t|tr|r|br|b|bl|l|tl)$/ },
    { pattern: /^from-(slate|gray|red|orange|amber|yellow|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|pink|rose)-\d+$/ },
    { pattern: /^via-(slate|gray|red|orange|amber|yellow|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|pink|rose)-\d+$/ },
    { pattern: /^to-(slate|gray|red|orange|amber|yellow|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|pink|rose)-\d+$/ },
    { pattern: /^to-transparent$/ },

    // Borders
    { pattern: /^border(-[trblxy])?(-[02468])?$/ },
    { pattern: /^border-(solid|dashed|dotted|double|none)$/ },
    { pattern: /^border-(transparent|current|black|white)$/ },
    { pattern: /^border-(slate|gray|zinc|red|orange|amber|yellow|green|emerald|blue|indigo|violet|purple|pink|rose)-\d+$/ },
    { pattern: /^border-(black|white)\/(5|10|20|30|50)$/ },
    { pattern: /^divide-[xy]$/ },
    { pattern: /^divide-(slate|gray)-\d+$/ },

    // Border radius
    { pattern: /^rounded(-[trblse]{1,2})?(-none|-sm|-md|-lg|-xl|-2xl|-3xl|-full)?$/ },

    // Shadows
    { pattern: /^shadow(-sm|-md|-lg|-xl|-2xl|-inner|-none)?$/ },

    // Ring
    { pattern: /^ring(-[01248])?$/ },
    { pattern: /^ring-(slate|gray|blue|indigo|purple|red|green)-\d+$/ },
    { pattern: /^ring-(white|black)\/(10|20|30|50)$/ },

    // Opacity
    { pattern: /^opacity-/ },

    // Effects
    { pattern: /^backdrop-blur(-sm|-md|-lg|-xl|-2xl|-3xl)?$/ },
    { pattern: /^blur(-sm|-md|-lg|-xl|-2xl|-3xl)?$/ },

    // Transitions
    { pattern: /^transition(-all|-colors|-opacity|-shadow|-transform|-none)?$/ },
    { pattern: /^duration-/ },
    { pattern: /^ease-(linear|in|out|in-out)$/ },
    { pattern: /^delay-/ },

    // Transforms
    { pattern: /^scale-/ },
    { pattern: /^-?rotate-/ },
    { pattern: /^-?translate-[xy]-/ },

    // Cursor
    { pattern: /^cursor-/ },

    // User select
    { pattern: /^select-(none|text|all|auto)$/ },

    // Pointer events
    { pattern: /^pointer-events-(none|auto)$/ },

    // Object fit
    { pattern: /^object-(contain|cover|fill|none|scale-down)$/ },

    // List style
    { pattern: /^list-(none|disc|decimal|inside|outside)$/ },

    // Appearance
    'appearance-none',

    // Outline
    { pattern: /^outline(-none)?$/ },

    // Aspect ratio
    { pattern: /^aspect-(auto|square|video)$/ },

    // Animations
    { pattern: /^animate-(none|spin|ping|pulse|bounce)$/ },

    // SR only
    'sr-only',
    'not-sr-only',
  ],
  // Include hover, focus, active, disabled, dark variants for colors/bg/text
  // Tailwind v3 generates these automatically with JIT
};

async function build() {
  console.log('[custom-ui-css] Generating pre-built Tailwind CSS...');
  const startTime = Date.now();

  try {
    const result = await postcss([tailwindcss(TAILWIND_CONFIG)])
      .process(INPUT_CSS, { from: undefined });

    const css = result.css;
    const sizeKB = (Buffer.byteLength(css, 'utf-8') / 1024).toFixed(1);

    // Write as a TypeScript module
    const output = `/**
 * Pre-built Tailwind CSS for Custom UI Windows
 * Auto-generated by scripts/build-custom-ui-css.cjs
 * DO NOT EDIT MANUALLY
 *
 * Size: ${sizeKB}KB
 * Generated: ${new Date().toISOString()}
 */

export const TAILWIND_PREBUILT_CSS = ${JSON.stringify(css)};
`;

    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, output, 'utf-8');

    const elapsed = Date.now() - startTime;
    console.log(`[custom-ui-css] Generated ${sizeKB}KB of Tailwind CSS in ${elapsed}ms`);
    console.log(`[custom-ui-css] Output: ${OUTPUT_PATH}`);
  } catch (err) {
    console.error('[custom-ui-css] Failed to generate Tailwind CSS:', err);
    process.exit(1);
  }
}

build();
