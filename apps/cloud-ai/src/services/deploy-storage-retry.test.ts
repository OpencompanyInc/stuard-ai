import { describe, expect, it } from 'vitest';

import { isRetryableStorageError } from './deploy-manager';

describe('GCS storage retry helpers', () => {
  it('treats transient DNS errors as retryable for GCS upload/signing', () => {
    expect(isRetryableStorageError({ code: 'EAI_AGAIN', message: 'getaddrinfo EAI_AGAIN storage.googleapis.com' })).toBe(true);
    expect(isRetryableStorageError({ message: 'socket hang up while calling storage.googleapis.com' })).toBe(true);
    expect(isRetryableStorageError({ statusCode: 503, message: 'service unavailable' })).toBe(true);
  });

  it('does not treat permanent client-side storage errors as retryable', () => {
    expect(isRetryableStorageError({ statusCode: 403, message: 'forbidden' })).toBe(false);
    expect(isRetryableStorageError({ code: 'EINVAL', message: 'bad config' })).toBe(false);
  });
});
