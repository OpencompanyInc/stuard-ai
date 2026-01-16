/**
 * Encryption utilities for locked workflows
 *
 * Locked workflows are encrypted on disk so users cannot view or edit
 * the source code directly. The encryption is tied to the machine.
 */

import * as crypto from 'crypto';
import * as os from 'os';

const ALGORITHM = 'aes-256-gcm';
const ENCRYPTED_PREFIX = 'STUARD_ENCRYPTED_V1:';

/**
 * Generate a machine-specific encryption key
 * This ensures encrypted files can't simply be copied to another machine
 */
function getMachineKey(): Buffer {
  // Combine multiple machine identifiers for the key derivation
  const machineInfo = [
    os.hostname(),
    os.platform(),
    os.arch(),
    os.cpus()[0]?.model || 'unknown',
    // Add a static salt to make it harder to reproduce
    'stuard-workflow-encryption-salt-v1'
  ].join('|');

  // Derive a 256-bit key using PBKDF2
  return crypto.pbkdf2Sync(machineInfo, 'stuard-salt', 100000, 32, 'sha256');
}

/**
 * Encrypt workflow content for locked workflows
 */
export function encryptWorkflow(content: string): string {
  try {
    const key = getMachineKey();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(content, 'utf8', 'base64');
    encrypted += cipher.final('base64');

    const authTag = cipher.getAuthTag();

    // Format: PREFIX + iv (base64) + : + authTag (base64) + : + encrypted data
    const result = ENCRYPTED_PREFIX +
      iv.toString('base64') + ':' +
      authTag.toString('base64') + ':' +
      encrypted;

    return result;
  } catch (e) {
    console.error('Failed to encrypt workflow:', e);
    throw new Error('Encryption failed');
  }
}

/**
 * Decrypt workflow content
 */
export function decryptWorkflow(encryptedContent: string): string {
  try {
    if (!encryptedContent.startsWith(ENCRYPTED_PREFIX)) {
      throw new Error('Invalid encrypted format');
    }

    const data = encryptedContent.slice(ENCRYPTED_PREFIX.length);
    const parts = data.split(':');

    if (parts.length !== 3) {
      throw new Error('Invalid encrypted format');
    }

    const iv = Buffer.from(parts[0], 'base64');
    const authTag = Buffer.from(parts[1], 'base64');
    const encrypted = parts[2];

    const key = getMachineKey();
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (e) {
    console.error('Failed to decrypt workflow:', e);
    throw new Error('Decryption failed - this workflow may have been created on a different machine');
  }
}

/**
 * Check if content is encrypted
 */
export function isEncrypted(content: string): boolean {
  return content.startsWith(ENCRYPTED_PREFIX);
}

/**
 * Prepare workflow content for saving
 * If the workflow is locked, encrypt it. Otherwise, return as-is.
 */
export function prepareForSave(content: string): string {
  try {
    const parsed = JSON.parse(content);
    if (parsed.locked) {
      return encryptWorkflow(content);
    }
    return content;
  } catch {
    return content;
  }
}

/**
 * Prepare workflow content for loading
 * If encrypted, decrypt it. Otherwise, return as-is.
 */
export function prepareForLoad(content: string): string {
  if (isEncrypted(content)) {
    return decryptWorkflow(content);
  }
  return content;
}
