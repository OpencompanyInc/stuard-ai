/**
 * Build React-Markdown Bundle for Custom UI
 *
 * Bundles react-markdown + remark-gfm + remark-math + rehype-katex into a
 * single browser-ready IIFE script that expects React as a global and exposes
 * ReactMarkdown, remarkGfm, remarkMath, and rehypeKatex on window.
 *
 * Also reads katex.min.css and exports it as a string constant for inlining.
 *
 * This follows the same pattern as build-custom-ui-css.cjs — the output is a
 * TypeScript module exporting the bundle as a string constant.
 *
 * Run: node scripts/build-react-markdown-bundle.cjs
 * Called automatically before build via package.json scripts.
 */

const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const OUTPUT_PATH = path.join(
  __dirname,
  '../src/main/custom-ui/assets/react-markdown-bundle.ts'
);

// Shim entry that imports react-markdown + plugins and attaches to window
const ENTRY_CODE = `
import ReactMarkdownDefault from 'react-markdown';
import remarkGfmDefault from 'remark-gfm';
import remarkMathDefault from 'remark-math';
import rehypeKatexDefault from 'rehype-katex';

// Handle both default and named exports
const ReactMarkdown = ReactMarkdownDefault?.default || ReactMarkdownDefault;
const remarkGfm = remarkGfmDefault?.default || remarkGfmDefault;
const remarkMath = remarkMathDefault?.default || remarkMathDefault;
const rehypeKatex = rehypeKatexDefault?.default || rehypeKatexDefault;

window.ReactMarkdown = ReactMarkdown;
window.remarkGfm = remarkGfm;
window.remarkMath = remarkMath;
window.rehypeKatex = rehypeKatex;
`;

async function build() {
  const startTime = Date.now();
  console.log('[react-markdown-bundle] Building...');

  // Write temp entry file
  const tmpEntry = path.join(__dirname, '_tmp_md_entry.mjs');
  fs.writeFileSync(tmpEntry, ENTRY_CODE, 'utf-8');

  try {
    const result = await esbuild.build({
      entryPoints: [tmpEntry],
      bundle: true,
      format: 'iife',
      globalName: '__reactMarkdownBundle',
      platform: 'browser',
      target: 'es2020',
      // Use classic JSX transform — generates React.createElement() calls directly,
      // avoids jsx-runtime shim issues entirely
      jsx: 'transform',
      jsxFactory: 'React.createElement',
      jsxFragment: 'React.Fragment',
      minify: true,
      write: false,
      plugins: [{
        name: 'react-global',
        setup(build) {
          // Intercept all react imports — point to the global window.React
          build.onResolve({ filter: /^react(\/.*)?$/ }, (args) => {
            return { path: args.path, namespace: 'react-global' };
          });
          build.onLoad({ filter: /.*/, namespace: 'react-global' }, (args) => {
            if (args.path === 'react/jsx-runtime' || args.path === 'react/jsx-dev-runtime') {
              // Map the new JSX runtime to classic React.createElement.
              // jsx(type, props, key) → React.createElement(type, {...props, key})
              // jsxs(type, props, key) → same, but children is an array in props.
              // React.createElement reads props.children natively in React 18.
              return {
                contents: `
                  var React = window.React;
                  export function jsx(type, props, key) {
                    var args = [type, props];
                    if (key !== undefined) args[1] = Object.assign({}, props, {key: key});
                    var c = args[1] && args[1].children;
                    if (c !== undefined && !Array.isArray(c)) {
                      // single child — pass as 3rd arg for classic createElement
                      return React.createElement(args[0], Object.assign({}, args[1], {children: undefined}), c);
                    }
                    if (Array.isArray(c)) {
                      // multiple children — spread as extra args
                      var p = Object.assign({}, args[1], {children: undefined});
                      return React.createElement.apply(React, [args[0], p].concat(c));
                    }
                    return React.createElement(args[0], args[1]);
                  }
                  export var jsxs = jsx;
                  export var jsxDEV = jsx;
                  export var Fragment = React.Fragment;
                `,
                loader: 'js',
              };
            }
            // Main react import — return the global
            return {
              contents: `module.exports = window.React;`,
              loader: 'js',
            };
          });
        },
      }],
    });

    const jsCode = result.outputFiles[0].text;
    const sizeKB = (Buffer.byteLength(jsCode, 'utf-8') / 1024).toFixed(1);

    // Read KaTeX CSS and inline fonts as base64 data URIs for fully offline operation.
    // This embeds ~296KB of woff2 fonts directly into the CSS string.
    let katexCss = '';
    try {
      const katexCssPath = require.resolve('katex/dist/katex.min.css');
      katexCss = fs.readFileSync(katexCssPath, 'utf-8');
      const fontsDir = path.join(path.dirname(katexCssPath), 'fonts');
      // Replace every url(fonts/Foo.woff2) with a base64 data URI
      katexCss = katexCss.replace(/url\(fonts\/([^)]+\.woff2)\)/g, (match, filename) => {
        const fontPath = path.join(fontsDir, filename);
        if (fs.existsSync(fontPath)) {
          const b64 = fs.readFileSync(fontPath).toString('base64');
          return `url(data:font/woff2;base64,${b64})`;
        }
        return match; // keep original if file missing
      });
      // Also handle .woff and .ttf references if any remain
      katexCss = katexCss.replace(/url\(fonts\/([^)]+\.woff)\)(?!2)/g, (match, filename) => {
        const fontPath = path.join(fontsDir, filename);
        if (fs.existsSync(fontPath)) {
          const b64 = fs.readFileSync(fontPath).toString('base64');
          return `url(data:font/woff;base64,${b64})`;
        }
        return match;
      });
      katexCss = katexCss.replace(/url\(fonts\/([^)]+\.ttf)\)/g, (match, filename) => {
        const fontPath = path.join(fontsDir, filename);
        if (fs.existsSync(fontPath)) {
          const b64 = fs.readFileSync(fontPath).toString('base64');
          return `url(data:font/ttf;base64,${b64})`;
        }
        return match;
      });
    } catch (err) {
      console.warn('[react-markdown-bundle] Could not read katex.min.css:', err.message);
    }
    const katexSizeKB = (Buffer.byteLength(katexCss, 'utf-8') / 1024).toFixed(1);

    // Write as TypeScript module (same pattern as tailwind-prebuilt.ts)
    const output = `/**
 * Pre-built React-Markdown + remark-gfm + remark-math + rehype-katex bundle
 * Auto-generated by scripts/build-react-markdown-bundle.cjs
 * DO NOT EDIT MANUALLY
 *
 * Exposes window.ReactMarkdown, window.remarkGfm, window.remarkMath,
 * and window.rehypeKatex when evaluated.
 * Expects window.React to be loaded first.
 *
 * JS Size: ${sizeKB}KB
 * KaTeX CSS Size: ${katexSizeKB}KB
 * Generated: ${new Date().toISOString()}
 */

export const REACT_MARKDOWN_BUNDLE = ${JSON.stringify(jsCode)};

export const KATEX_CSS = ${JSON.stringify(katexCss)};
`;

    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, output, 'utf-8');

    const elapsed = Date.now() - startTime;
    console.log(`[react-markdown-bundle] Generated ${sizeKB}KB bundle in ${elapsed}ms`);
    console.log(`[react-markdown-bundle] Output: ${OUTPUT_PATH}`);
  } catch (err) {
    console.error('[react-markdown-bundle] Build failed:', err);
    process.exit(1);
  } finally {
    // Clean up temp file
    try { fs.unlinkSync(tmpEntry); } catch {}
  }
}

build();
