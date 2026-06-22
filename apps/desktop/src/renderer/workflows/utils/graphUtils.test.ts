import { describe, expect, it } from 'vitest';
import type { DesignerWire } from '../types';
import { isBackEdge, isContinueInLoopWire, isNodeInsideOpenLoop } from './graphUtils';

describe('isBackEdge', () => {
  it('flags only the closing edge of a cycle', () => {
    const wires: DesignerWire[] = [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'c', to: 'a' },
    ];

    expect(isBackEdge('a', 'b', wires)).toBe(false);
    expect(isBackEdge('b', 'c', wires)).toBe(false);
    expect(isBackEdge('c', 'a', wires)).toBe(true);
  });

  it('does not treat forward loop entry wires as back edges', () => {
    const wires: DesignerWire[] = [
      { from: 'a', to: 'b', loop: { type: 'repeat', count: 5 } },
      { from: 'b', to: 'c' },
      { from: 'c', to: 'b' },
    ];

    expect(isBackEdge('a', 'b', wires)).toBe(false);
    expect(isBackEdge('b', 'c', wires)).toBe(false);
    expect(isBackEdge('c', 'b', wires)).toBe(true);
  });

  it('still flags configured loop wires that close a cycle', () => {
    const wires: DesignerWire[] = [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'c', to: 'a', loop: { type: 'while', conditionText: '{{done}}' } },
    ];

    expect(isBackEdge('a', 'b', wires)).toBe(false);
    expect(isBackEdge('b', 'c', wires)).toBe(false);
    expect(isBackEdge('c', 'a', wires)).toBe(true);
  });
});

describe('loop scope detection', () => {
  const loopBody: DesignerWire[] = [
    { from: 'a', to: 'b', loop: { type: 'repeat', count: 5 } },
    { from: 'b', to: 'c' },
    { from: 'c', to: 'b' },
  ];

  it('marks loop-body nodes as inside an open loop', () => {
    expect(isNodeInsideOpenLoop('a', loopBody)).toBe(false);
    expect(isNodeInsideOpenLoop('b', loopBody)).toBe(true);
    expect(isNodeInsideOpenLoop('c', loopBody)).toBe(true);
  });

  it('styles forward body wires as continue-in-loop', () => {
    expect(isContinueInLoopWire({ from: 'b', to: 'c' }, loopBody, false)).toBe(true);
    expect(isContinueInLoopWire({ from: 'c', to: 'b' }, loopBody, true)).toBe(false);
    expect(isContinueInLoopWire({ from: 'a', to: 'b', loop: { type: 'repeat', count: 5 } }, loopBody, false)).toBe(false);
  });

  it('does not style loopBreak exit wires as continue-in-loop', () => {
    const wires: DesignerWire[] = [
      ...loopBody,
      { from: 'b', to: 'd', loopBreak: true },
    ];

    expect(isContinueInLoopWire({ from: 'b', to: 'd', loopBreak: true }, wires, false)).toBe(false);
    expect(isNodeInsideOpenLoop('d', wires)).toBe(false);
  });
});
