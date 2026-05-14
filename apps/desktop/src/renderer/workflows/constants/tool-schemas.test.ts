import { describe, expect, it } from 'vitest';
import { getToolSchema } from './tool-schemas';

function arg(toolName: string, argKey: string) {
  const schema = getToolSchema(toolName);
  expect(schema, `${toolName} schema`).toBeDefined();
  const argSchema = schema?.args[argKey];
  expect(argSchema, `${toolName}.${argKey} schema`).toBeDefined();
  return argSchema!;
}

function optionValues(toolName: string, argKey: string) {
  return (arg(toolName, argKey).options || []).map((option) => option.value);
}

describe('workflow tool smart-arg schemas', () => {
  it('uses friendly date/time options for get_datetime.format', () => {
    const formatArg = arg('get_datetime', 'format');

    expect(formatArg.type).toBe('select');
    expect(formatArg.label).toBe('Show As');
    expect(optionValues('get_datetime', 'format')).toEqual(
      expect.arrayContaining(['dddd, MMMM D [at] h:mm A', 'YYYY-MM-DD HH:mm:ss', 'iso']),
    );
    expect(optionValues('get_datetime', 'format')).not.toEqual(
      expect.arrayContaining(['mp3', 'wav', 'opus']),
    );
    expect(arg('get_datetime', 'tzOffset').advanced).toBe(true);
  });

  it('keeps generic field names scoped to the tool that owns them', () => {
    expect(arg('launch_application_or_uri', 'target').type).toBe('string');
    expect(optionValues('capture_screen', 'target')).toEqual(
      expect.arrayContaining(['fullscreen', 'monitor', 'window', 'region']),
    );

    expect(optionValues('capture_media', 'kind')).toEqual(
      expect.arrayContaining(['photo', 'video', 'audio', 'audiovideo']),
    );
    expect(optionValues('stream_create', 'kind')).toEqual(
      expect.arrayContaining(['bytes', 'json', 'text']),
    );
  });

  it('does not leak notification/card variants into link and progress tools', () => {
    expect(optionValues('show_link', 'variant')).toEqual(['large', 'compact']);
    expect(optionValues('show_progress', 'variant')).toEqual(['download', 'upload', 'sync', 'processing']);
    expect(optionValues('show_info_card', 'variant')).toEqual(
      expect.arrayContaining(['info', 'warning', 'success', 'error', 'default']),
    );
  });

  it('uses each audio tool own output format list', () => {
    expect(optionValues('capture_system_audio', 'format')).toEqual(['wav', 'mp3']);
    expect(optionValues('text_to_speech', 'format')).toEqual(
      expect.arrayContaining(['mp3', 'wav', 'opus', 'aac', 'flac']),
    );
  });
});
