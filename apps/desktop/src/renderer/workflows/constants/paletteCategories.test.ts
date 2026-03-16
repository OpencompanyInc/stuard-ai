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

  it('includes Meta and WhatsApp integration categories in the toolbox', () => {
    const facebookCategory = PALETTE_CATEGORIES.find((category) => category.id === 'facebook');
    const instagramCategory = PALETTE_CATEGORIES.find((category) => category.id === 'instagram');
    const threadsCategory = PALETTE_CATEGORIES.find((category) => category.id === 'threads');
    const whatsappCategory = PALETTE_CATEGORIES.find((category) => category.id === 'whatsapp');

    expect(facebookCategory?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ t: 'facebook_create_page_post' }),
      ])
    );
    expect(instagramCategory?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ t: 'instagram_publish_media' }),
      ])
    );
    expect(threadsCategory?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ t: 'threads_publish_post' }),
      ])
    );
    expect(whatsappCategory?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ t: 'whatsapp_send_message' }),
      ])
    );
  });
});