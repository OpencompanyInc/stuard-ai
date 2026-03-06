import { describe, expect, it } from 'vitest';
import { PALETTE_CATEGORIES, getToolColor } from './paletteCategories';

describe('workflow palette categories', () => {
  it('includes generate_image in the AI & Vision toolbox category', () => {
    const aiCategory = PALETTE_CATEGORIES.find((category) => category.id === 'ai');

    expect(aiCategory).toBeDefined();
    expect(aiCategory?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          k: 'cloud.tool',
          t: 'generate_image',
          label: 'Generate Image',
          args: expect.objectContaining({
            prompt: '',
            model: 'gpt-image-1',
            format: 'png',
          }),
        }),
      ])
    );
  });

  it('uses the AI & Vision color for generate_image nodes', () => {
    expect(getToolColor('generate_image')).toBe('fuchsia');
  });
});