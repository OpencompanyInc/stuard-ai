import { describe, it, expect } from 'vitest';
import { prepareComponentCode } from '../jsx-transform';
import { generateEnhancedCustomUiHtml } from '../html';

// Extract the real __stuardRequire + __stuardImportNamed helpers from generated
// HTML and run a rewritten named-import binding against them — proves the shipped
// runtime turns a missing export into a clear error, not React #130.
function extractHelpers(html: string): { run: (binding: string, mod: any) => any } {
  const grab = (name: string) => {
    const i = html.indexOf(`function ${name}(`);
    if (i < 0) throw new Error(`helper ${name} not found in HTML`);
    // brace-match
    let depth = 0, started = false, end = i;
    for (let j = i; j < html.length; j++) {
      if (html[j] === '{') { depth++; started = true; }
      else if (html[j] === '}') { depth--; if (started && depth === 0) { end = j + 1; break; } }
    }
    return html.slice(i, end);
  };
  const importNamed = grab('__stuardImportNamed');
  return {
    run: (binding: string, mod: any) => {
      const harness = `
        var __mod = ${JSON.stringify(null)};
        function __stuardRequire(name){ return __injected; }
        ${importNamed}
        ${binding}
        return { Present: typeof Present !== 'undefined' ? Present : undefined };
      `;
      // eslint-disable-next-line no-new-func
      return new Function('__injected', harness)(mod);
    },
  };
}

describe('missing named import surfaces a clear error', () => {
  it('rewriter emits __stuardImportNamed for non-global named imports', () => {
    const { code } = prepareComponentCode(
      "import { Home01Icon, BarChart01Icon } from 'hugeicons-react';\nfunction App(){ return null; }",
      { availableModules: ['hugeicons-react'] },
    );
    expect(code).toContain('__stuardImportNamed("hugeicons-react", ["Home01Icon","BarChart01Icon"])');
  });

  it('real runtime helper throws naming the missing export', () => {
    const html = generateEnhancedCustomUiHtml({
      id: 't', title: 't', css: '', layout: null, data: {}, borderRadius: 0, flowId: 'f', transparentBg: false,
      component: "function App(){ return null; }",
    } as any);
    const { run } = extractHelpers(html);

    // Present export → no throw
    expect(() => run('var { Present } = __stuardImportNamed("pkg", ["Present"]);', { Present: () => null })).not.toThrow();

    // Missing export → clear, specific error
    expect(() => run('var { Nope } = __stuardImportNamed("pkg", ["Nope"]);', { Present: () => null }))
      .toThrow(/has no export named "Nope"/);

    // Missing export with a near-match → suggests it
    expect(() => run('var { TrendUp01Icon } = __stuardImportNamed("pkg", ["TrendUp01Icon"]);', { TrendUpIcon: () => null }))
      .toThrow(/did you mean .*TrendUpIcon/);
  });

  it('definition errors render the error card instead of blanking the window', () => {
    // A bad named import throws at definition time; the generated runtime must
    // show the error (not ReactDOM.render(null), which would wipe it → black screen).
    const html = generateEnhancedCustomUiHtml({
      id: 't', title: 't', css: '', layout: null, data: {}, borderRadius: 0, flowId: 'f', transparentBg: false,
      component: "import { Nope } from 'recharts';\nfunction App(){ return null; }",
      uiPackagesModules: ['recharts'],
    } as any);

    // The render section guards on __compDefError and calls __showComponentError
    // directly rather than rendering an ErrorApp that returns null.
    expect(html).toContain('if (__compDefError)');
    expect(html).toContain("__showComponentError('Component Definition Error'");
    expect(html).not.toContain('function ErrorApp');
  });
});
