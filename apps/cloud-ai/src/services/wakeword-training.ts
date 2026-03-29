/**
 * Wakeword Training Service
 *
 * Manages per-user wakeword fine-tuning jobs:
 *  1. Accept audio samples from the user
 *  2. Spawn Python fine-tuning subprocess (finetune_user_cloud.py)
 *  3. Upload resulting weights (.npz) to GCS
 *  4. Track enrollment status in Supabase
 *
 * Only available to paid users (STARTER+).
 */

import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  WAKEWORD_REPO_PATH,
  WAKEWORD_BASE_MODEL_PATH,
  WAKEWORD_WORK_DIR,
  WAKEWORD_PYTHON,
  ELEVENLABS_API_KEY,
} from '../utils/config';
import { uploadUserFileBuffer, generateUserDownloadUrl } from './cold-storage';
import { getSupabaseService } from '../supabase';
import { writeLog } from '../utils/logger';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type EnrollmentStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface WakewordEnrollment {
  id: string;
  user_id: string;
  status: EnrollmentStatus;
  wake_phrase: string;
  weights_object: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

// In-memory job tracker for active jobs (so we don't double-start)
const _activeJobs = new Map<string, { jobId: string; startedAt: number }>();

// ─────────────────────────────────────────────────────────────────────────────
// Enrollment Status (Supabase)
// ─────────────────────────────────────────────────────────────────────────────

export async function getEnrollment(userId: string): Promise<WakewordEnrollment | null> {
  const sb = getSupabaseService();
  if (!sb) return null;
  const { data, error } = await sb
    .from('wakeword_enrollments')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (error || !data) return null;
  return data as WakewordEnrollment;
}

async function upsertEnrollment(
  userId: string,
  fields: Partial<WakewordEnrollment>,
): Promise<string | null> {
  const sb = getSupabaseService();
  if (!sb) return null;

  const existing = await getEnrollment(userId);
  if (existing) {
    await sb
      .from('wakeword_enrollments')
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq('id', existing.id);
    return existing.id;
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  await sb.from('wakeword_enrollments').insert({
    id,
    user_id: userId,
    status: 'pending',
    wake_phrase: 'hey stuard',
    weights_object: null,
    error_message: null,
    created_at: now,
    updated_at: now,
    ...fields,
  });
  return id;
}

// ─────────────────────────────────────────────────────────────────────────────
// Weights Download
// ─────────────────────────────────────────────────────────────────────────────

export async function getWeightsDownloadUrl(userId: string): Promise<string | null> {
  const enrollment = await getEnrollment(userId);
  if (!enrollment || enrollment.status !== 'completed' || !enrollment.weights_object) return null;
  try {
    const { downloadUrl } = await generateUserDownloadUrl(userId, enrollment.weights_object);
    return downloadUrl;
  } catch (e: any) {
    writeLog('wakeword', `Failed to generate download URL for ${userId}: ${e.message}`);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Delete Enrollment
// ─────────────────────────────────────────────────────────────────────────────

export async function deleteEnrollment(userId: string): Promise<boolean> {
  const sb = getSupabaseService();
  if (!sb) return false;

  const enrollment = await getEnrollment(userId);
  if (!enrollment) return false;

  // Delete weights from GCS if present
  if (enrollment.weights_object) {
    try {
      const { Storage } = await import('@google-cloud/storage');
      const storage = new Storage();
      const bucket = storage.bucket(process.env.CLOUD_ENGINE_BUCKET || 'stuard-user-data');
      await bucket.file(enrollment.weights_object).delete({ ignoreNotFound: true });
    } catch {}
  }

  await sb.from('wakeword_enrollments').delete().eq('id', enrollment.id);
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Enrollment (Fine-tuning)
// ─────────────────────────────────────────────────────────────────────────────

export interface EnrollResult {
  ok: boolean;
  jobId?: string;
  error?: string;
}

/**
 * Start a wakeword enrollment job for a user.
 * `audioSamples` should be an array of { filename, data: Buffer } for each WAV recording.
 */
export async function startEnrollment(
  userId: string,
  audioSamples: Array<{ filename: string; data: Buffer }>,
  wakePhrase = 'hey stuard',
): Promise<EnrollResult> {
  // Prevent double-submission
  if (_activeJobs.has(userId)) {
    return { ok: false, error: 'enrollment_already_in_progress' };
  }

  // Validate config
  if (!WAKEWORD_REPO_PATH || !fs.existsSync(WAKEWORD_REPO_PATH)) {
    return { ok: false, error: 'wakeword_repo_not_configured' };
  }
  const baseModel = WAKEWORD_BASE_MODEL_PATH || path.join(WAKEWORD_REPO_PATH, 'models', 'kws_model_base.keras');
  if (!fs.existsSync(baseModel)) {
    return { ok: false, error: 'base_model_not_found' };
  }
  if (!ELEVENLABS_API_KEY) {
    return { ok: false, error: 'elevenlabs_api_key_not_configured' };
  }
  if (audioSamples.length < 2) {
    return { ok: false, error: 'at_least_2_samples_required' };
  }

  // Create work directory for this job
  const jobId = randomUUID();
  const jobDir = path.join(WAKEWORD_WORK_DIR, jobId);
  const inputDir = path.join(jobDir, 'input');
  const outputDir = path.join(jobDir, 'output');

  try {
    fs.mkdirSync(inputDir, { recursive: true });
    fs.mkdirSync(outputDir, { recursive: true });
  } catch (e: any) {
    return { ok: false, error: `failed_to_create_work_dir: ${e.message}` };
  }

  // Write audio samples to disk
  for (const sample of audioSamples) {
    const safeName = sample.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    fs.writeFileSync(path.join(inputDir, safeName), sample.data);
  }

  // Mark enrollment as processing
  await upsertEnrollment(userId, {
    status: 'processing',
    wake_phrase: wakePhrase,
    weights_object: null,
    error_message: null,
  });
  _activeJobs.set(userId, { jobId, startedAt: Date.now() });

  // Spawn fine-tuning process in the background
  runFinetuneJob(userId, jobId, inputDir, outputDir, baseModel, wakePhrase).catch((err) => {
    writeLog('wakeword', `Unhandled error in fine-tune job for ${userId}: ${err}`);
  });

  return { ok: true, jobId };
}

async function runFinetuneJob(
  userId: string,
  jobId: string,
  inputDir: string,
  outputDir: string,
  baseModel: string,
  wakePhrase: string,
): Promise<void> {
  const scriptPath = path.join(WAKEWORD_REPO_PATH, 'finetune_user_cloud.py');

  writeLog('wakeword', `Starting fine-tune job ${jobId} for user ${userId}`);

  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(
        WAKEWORD_PYTHON,
        [
          scriptPath,
          '--input-dir', inputDir,
          '--base-model', baseModel,
          '--output-dir', outputDir,
          '--api-key', ELEVENLABS_API_KEY,
        ],
        {
          cwd: WAKEWORD_REPO_PATH,
          env: {
            ...process.env,
            ELEVENLABS_API_KEY,
            PYTHONUNBUFFERED: '1',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 10 * 60 * 1000, // 10 minute timeout
        },
      );

      let stdout = '';
      let stderr = '';
      proc.stdout?.on('data', (d) => { stdout += d.toString(); });
      proc.stderr?.on('data', (d) => { stderr += d.toString(); });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Process exited with code ${code}\nstderr: ${stderr.slice(-500)}`));
        }
      });

      proc.on('error', (err) => reject(err));
    });

    // Find the output weights file
    const weightsFile = path.join(outputDir, 'user_weights.npz');
    if (!fs.existsSync(weightsFile)) {
      throw new Error('user_weights.npz not found in output directory');
    }

    // Upload weights to GCS
    const weightsData = fs.readFileSync(weightsFile);
    const { objectName } = await uploadUserFileBuffer(
      userId,
      'kws_weights.npz',
      weightsData,
      'application/octet-stream',
      'wakeword',
      'private',
    );

    // Mark enrollment as completed
    await upsertEnrollment(userId, {
      status: 'completed',
      weights_object: objectName,
      error_message: null,
    });

    writeLog('wakeword', `Fine-tune job ${jobId} completed for user ${userId}. Weights: ${objectName}`);
  } catch (err: any) {
    writeLog('wakeword', `Fine-tune job ${jobId} failed for user ${userId}: ${err.message}`);
    await upsertEnrollment(userId, {
      status: 'failed',
      error_message: String(err.message || 'unknown_error').slice(0, 500),
    });
  } finally {
    _activeJobs.delete(userId);
    // Clean up work directory
    try {
      fs.rmSync(path.join(WAKEWORD_WORK_DIR, jobId), { recursive: true, force: true });
    } catch {}
  }
}
