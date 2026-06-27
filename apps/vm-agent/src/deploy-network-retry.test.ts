import { describe, expect, it } from 'vitest';

import { isRetryableDownloadError } from './deploy-executor';

describe('VM bundle download retry helpers', () => {
  it('treats transient signed bundle download failures as retryable', () => {
    expect(isRetryableDownloadError({ code: 'EAI_AGAIN', message: 'getaddrinfo EAI_AGAIN storage.googleapis.com' })).toBe(true);
    expect(isRetryableDownloadError({ code: 'ETIMEDOUT', message: 'Download timeout' })).toBe(true);
    expect(isRetryableDownloadError({ statusCode: 502, message: 'bad gateway' })).toBe(true);
  });

  it('does not retry permanent download failures', () => {
    expect(isRetryableDownloadError({ statusCode: 404, message: 'not found' })).toBe(false);
    expect(isRetryableDownloadError({ code: 'EINVAL', message: 'invalid URL' })).toBe(false);
  });
});
