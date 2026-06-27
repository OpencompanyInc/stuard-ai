import { describe, it, expect } from 'vitest';
import { JIT_LITE_JS } from '../assets/jit-lite';

/**
 * Runs the JIT-lite script against a minimal DOM stub.
 * `prebuilt` simulates rules already present in the prebuilt Tailwind stylesheet;
 * `classes` are the class attributes found in the document.
 * Returns the CSS rules the script synthesized.
 */
function runJit(prebuilt: Array<[string, string]>, classes: string[]): string[] {
  const inserted: string[] = [];
  const styleEl: any = {
    id: '',
    sheet: {
      cssRules: { length: 0 },
      insertRule(rule: string) {
        inserted.push(rule);
        this.cssRules.length++;
      },
    },
  };
  const elements = classes.map(cls => ({ nodeType: 1, classList: cls.split(/\s+/) }));
  const root: any = { nodeType: 1, classList: [], querySelectorAll: () => elements };
  const documentStub: any = {
    readyState: 'complete',
    head: { appendChild: () => {} },
    documentElement: root,
    createElement: () => styleEl,
    addEventListener: () => {},
    styleSheets: [
      {
        ownerNode: {},
        cssRules: prebuilt.map(([sel, body]) => ({ selectorText: sel, cssText: `${sel} { ${body} }` })),
      },
    ],
  };
  const windowStub: any = {};
  class MutationObserverStub {
    constructor(_cb: any) {}
    observe() {}
  }
  new Function('window', 'document', 'MutationObserver', JIT_LITE_JS)(windowStub, documentStub, MutationObserverStub);
  return inserted;
}

const BG_ZINC_900: [string, string] = ['.bg-zinc-900', '--tw-bg-opacity: 1; background-color: rgb(24 24 27 / var(--tw-bg-opacity))'];
const BORDER_WHITE: [string, string] = ['.border-white', '--tw-border-opacity: 1; border-color: rgb(255 255 255 / var(--tw-border-opacity))'];
const BG_RED_500: [string, string] = ['.bg-red-500', '--tw-bg-opacity: 1; background-color: rgb(239 68 68 / var(--tw-bg-opacity))'];
const SCALE_125: [string, string] = ['.scale-125', '--tw-scale-x: 1.25; --tw-scale-y: 1.25; transform: translate(var(--tw-translate-x), var(--tw-translate-y))'];
const TEXT_WHITE: [string, string] = ['.text-white', '--tw-text-opacity: 1; color: rgb(255 255 255 / var(--tw-text-opacity))'];

describe('custom-ui JIT-lite', () => {
  it('synthesizes opacity-modified colors by cloning the base rule', () => {
    const rules = runJit([BG_ZINC_900], ['bg-zinc-900/95']);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toContain('.bg-zinc-900\\/95');
    expect(rules[0]).toContain('rgb(24 24 27 / 0.95)');
  });

  it('handles border color opacity modifiers', () => {
    const rules = runJit([BORDER_WHITE], ['border-white/25']);
    expect(rules[0]).toContain('border-color: rgb(255 255 255 / 0.25)');
  });

  it('handles bg color opacity modifiers for any palette family', () => {
    const rules = runJit([BG_RED_500], ['bg-red-500/30']);
    expect(rules[0]).toContain('background-color: rgb(239 68 68 / 0.3)');
  });

  it('reconstructs missing color utilities from a sibling rule of the same shade', () => {
    // border-teal-500 is not in the prebuilt safelist, but bg-teal-500 is
    const rules = runJit(
      [['.bg-teal-500', '--tw-bg-opacity: 1; background-color: rgb(20 184 166 / var(--tw-bg-opacity))']],
      ['border-teal-500/50']
    );
    expect(rules[0]).toContain('border-color: rgb(20 184 166 / 0.5)');
  });

  it('synthesizes arbitrary values', () => {
    const rules = runJit([], ['text-[12px]', 'max-w-[180px]', 'h-[5px]', 'bg-[#ff0000]']);
    expect(rules.find(r => r.includes('font-size: 12px'))).toBeTruthy();
    expect(rules.find(r => r.includes('max-width: 180px'))).toBeTruthy();
    expect(rules.find(r => r.includes('height: 5px'))).toBeTruthy();
    expect(rules.find(r => r.includes('background-color: #ff0000'))).toBeTruthy();
  });

  it('applies alpha to arbitrary colors via color-mix', () => {
    const rules = runJit([], ['bg-[#123456]/40']);
    expect(rules[0]).toContain('color-mix(in srgb, #123456 40%, transparent)');
  });

  it('clones existing utilities for hover variants', () => {
    const rules = runJit([SCALE_125, TEXT_WHITE], ['hover:scale-125', 'hover:text-white']);
    expect(rules.find(r => r.includes('.hover\\:scale-125:hover') && r.includes('--tw-scale-x: 1.25'))).toBeTruthy();
    expect(rules.find(r => r.includes('.hover\\:text-white:hover'))).toBeTruthy();
  });

  it('prefixes dark variants with the .dark ancestor selector', () => {
    const rules = runJit([BG_ZINC_900], ['dark:bg-zinc-900/95']);
    expect(rules[0]).toMatch(/^\.dark \.dark\\:bg-zinc-900\\\/95 /);
  });

  it('does not duplicate classes already present in the stylesheets', () => {
    const rules = runJit([['.bg-black\\/60', 'background-color: rgb(0 0 0 / 0.6)'], BG_ZINC_900], ['bg-black/60', 'bg-zinc-900']);
    expect(rules).toHaveLength(0);
  });

  it('ignores unknown classes and unsupported variants', () => {
    const rules = runJit([BG_ZINC_900], ['totally-made-up', 'md:bg-zinc-900/95', 'stu-bob']);
    expect(rules).toHaveLength(0);
  });
});
