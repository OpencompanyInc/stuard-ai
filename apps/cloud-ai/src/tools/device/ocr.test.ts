import { describe, expect, it } from 'vitest';

import { findOcrTextMatches } from './ocr';

type WordAnnotation = {
  description: string;
  boundingPoly: {
    vertices: Array<{ x: number; y: number }>;
  };
};

function makeWord(description: string, index: number): WordAnnotation {
  const x = index * 10;
  return {
    description,
    boundingPoly: {
      vertices: [
        { x, y: 0 },
        { x: x + 8, y: 0 },
        { x: x + 8, y: 8 },
        { x, y: 8 },
      ],
    },
  };
}

describe('findOcrTextMatches', () => {
  it('treats a multi-word answer as one phrase match instead of many single-word matches', () => {
    const searchText = 'All of the above (this is the correct answer)';
    const words = [
      'Powerful,',
      'often',
      'exclusionary,',
      'populist',
      'nationalism',
      'centered',
      'on',
      'a',
      'cult',
      'of',
      'a',
      'redemptive,',
      '"infallible"',
      'leader',
      'who',
      'never',
      'admits',
      'mistakes',
      'All',
      'of',
      'the',
      'above',
      '(this',
      'is',
      'the',
      'correct',
      'answer)',
    ];

    const matches = findOcrTextMatches({
      fullText: words.join(' '),
      searchText,
      wordAnnotations: words.map((word, index) => makeWord(word, index)),
    });

    expect(matches).toHaveLength(1);
    expect(matches[0]?.text).toBe(searchText);
  });

  it('still allows reverse partial matching for single-word searches', () => {
    const matches = findOcrTextMatches({
      fullText: 'Honorlock Browser Guard',
      searchText: 'Honorlock',
      wordAnnotations: [makeWord('Honorlock®', 0), makeWord('Browser', 1), makeWord('Guard', 2)],
    });

    expect(matches).toHaveLength(1);
    expect(matches[0]?.text).toBe('Honorlock®');
  });
});
