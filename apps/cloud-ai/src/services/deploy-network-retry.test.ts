import { describe, expect, it } from 'vitest';

import { isRetryableDownloadError } from '../agent/deploy-executor';
import { isRetryableStorageError } from './deploy-manager';

describe('deploy network retry helpers', () => {
  it('treats transient DNS errors as retryable for GCS upload/signing', () => {
    expect(isRetryableStorageError({ code: 'EAI_AGAIN', message: 'getaddrinfo EAI_AGAIN storage.googleapis.com' })).toBe(true);
    expect(isRetryableStorageError({ message: 'socket hang up while calling storage.googleapis.com' })).toBe(true);
    expect(isRetryableStorageError({ statusCode: 503, message: 'service unavailable' })).toBe(true);
  });

  it('does not treat permanent client-side storage errors as retryable', () => {
    expect(isRetryableStorageError({ statusCode: 403, message: 'forbidden' })).toBe(false);
    expect(isRetryableStorageError({ code: 'EINVAL', message: 'bad config' })).toBe(false);
  });

  it('treats transient signed bundle download failures as retryable on the VM', () => {
    expect(isRetryableDownloadError({ code: 'EAI_AGAIN', message: 'getaddrinfo EAI_AGAIN storage.googleapis.com' })).toBe(true);
    expect(isRetryableDownloadError({ code: 'ETIMEDOUT', message: 'Download timeout' })).toBe(true);
    expect(isRetryableDownloadError({ statusCode: 502, message: 'bad gateway' })).toBe(true);
  });

  it('does not retry permanent download failures', () => {
    expect(isRetryableDownloadError({ statusCode: 404, message: 'not found' })).toBe(false);
    expect(isRetryableDownloadError({ code: 'EINVAL', message: 'invalid URL' })).toBe(false);
  });
});
