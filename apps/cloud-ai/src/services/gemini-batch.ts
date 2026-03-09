import { SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getSupabaseService } from '../supabase';

const GOOGLE_API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

function getSupabase(): SupabaseClient {
  const client = getSupabaseService();
  if (!client) {
    throw new Error('Supabase client not initialized. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  }
  return client;
}

export interface BatchRequest {
  key: string;
  request: {
    contents: Array<{
      parts: Array<{ text?: string; inline_data?: { mime_type: string; data: string } }>;
      role?: string;
    }>;
    generation_config?: Record<string, any>;
  };
}

export interface BatchJob {
  id: string;
  job_id: string;
  status: string;
  display_name?: string;
  model: string;
  output_file_id?: string;
  metadata: any;
}

/**
 * Uploads a JSONL file to Gemini File API
 */
async function uploadToGemini(filePath: string, displayName: string): Promise<string> {
  if (!GOOGLE_API_KEY) throw new Error('Missing Google API Key');

  const stats = fs.statSync(filePath);
  const boundary = '-------' + Math.random().toString(36).substring(2);

  // Gemini File API Upload (simple version for JSONL)
  const metadata = {
    file: {
      display_name: displayName,
      mime_type: 'application/x-jsonlines',
    },
  };

  const metadataPart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`;
  const filePartHeader = `--${boundary}\r\nContent-Type: application/x-jsonlines\r\n\r\n`;
  const filePartFooter = `\r\n--${boundary}--`;

  const body = Buffer.concat([
    Buffer.from(metadataPart),
    Buffer.from(filePartHeader),
    fs.readFileSync(filePath),
    Buffer.from(filePartFooter),
  ]);

  const response = await fetch('https://generativelanguage.googleapis.com/upload/v1beta/files?key=' + GOOGLE_API_KEY, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'multipart',
      'X-Goog-Upload-Command': 'upload, finalize',
      'X-Goog-Upload-Header-Content-Length': body.length.toString(),
      'X-Goog-Upload-Header-Content-Type': 'application/x-jsonlines',
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to upload to Gemini: ${response.status} ${errText}`);
  }

  const result = await response.json() as any;
  return result.file.name; // This is the file ID e.g. "files/..."
}

/**
 * Creates a batch job in Gemini
 */
export async function createBatchJob(
  requests: BatchRequest[],
  model: string = 'gemini-3-flash-preview',
  displayName: string = 'batch-job',
  extraMetadata: any = {},
  userId?: string
): Promise<BatchJob> {
  if (!GOOGLE_API_KEY) throw new Error('Missing Google API Key');

  // 1. Create JSONL file
  const tmpDir = os.tmpdir();
  const fileName = `batch-${Date.now()}.jsonl`;
  const filePath = path.join(tmpDir, fileName);

  const stream = fs.createWriteStream(filePath);
  for (const req of requests) {
    stream.write(JSON.stringify(req) + '\n');
  }
  await new Promise((resolve, reject) => {
    stream.on('finish', () => resolve(undefined));
    stream.on('error', reject);
    stream.end();
  });

  try {
    // 2. Upload to Gemini
    const geminiFileId = await uploadToGemini(filePath, displayName);

    // 3. Create Batch Job
    const batchResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/batches?key=${GOOGLE_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: `models/${model}`,
        src: geminiFileId,
        config: {
          display_name: displayName,
        },
      }),
    });

    if (!batchResponse.ok) {
      const errText = await batchResponse.text();
      throw new Error(`Failed to create Gemini batch job: ${batchResponse.status} ${errText}`);
    }

    const batchResult = await batchResponse.json() as any;
    const jobId = batchResult.name; // e.g. "batches/..."

    // 4. Store in DB
    const { data, error } = await getSupabase().from('gemini_batch_jobs').insert({
      job_id: jobId,
      display_name: displayName,
      model,
      status: 'JOB_STATE_PENDING',
      input_file_id: geminiFileId,
      metadata: { ...extraMetadata, total_requests: requests.length },
      user_id: userId,
    }).select().single();

    if (error) throw error;

    return data;
  } finally {
    // Clean up tmp file
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}

/**
 * Checks the status of a batch job and updates DB
 */
export async function pollBatchJob(id: string): Promise<BatchJob> {
  if (!GOOGLE_API_KEY) throw new Error('Missing Google API Key');

  const { data: job, error: fetchError } = await getSupabase().from('gemini_batch_jobs').select('*').eq('id', id).single();
  if (fetchError || !job) throw new Error(`Job not found: ${id}`);

  if (['JOB_STATE_SUCCEEDED', 'JOB_STATE_FAILED', 'JOB_STATE_CANCELLED', 'JOB_STATE_EXPIRED'].includes(job.status)) {
    return job;
  }

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/${job.job_id}?key=${GOOGLE_API_KEY}`);
  if (!response.ok) {
    throw new Error(`Failed to get job status: ${response.status}`);
  }

  const result = await response.json() as any;
  const newStatus = result.state;
  const output_file_id = result.dest; // result.dest is the file name for output

  if (newStatus !== job.status) {
    const { data: updatedJob, error: updateError } = await getSupabase()
      .from('gemini_batch_jobs')
      .update({ 
        status: newStatus, 
        output_file_id: output_file_id,
        updated_at: new Date().toISOString() 
      })
      .eq('id', id)
      .select()
      .single();

    if (updateError) throw updateError;
    return updatedJob;
  }

  return job;
}

/**
 * Downloads and parses results from a completed batch job
 */
export async function getBatchResults(id: string): Promise<any[]> {
  if (!GOOGLE_API_KEY) throw new Error('Missing Google API Key');

  const { data: job, error: fetchError } = await getSupabase().from('gemini_batch_jobs').select('*').eq('id', id).single();
  if (fetchError || !job) throw new Error(`Job not found: ${id}`);

  if (job.status !== 'JOB_STATE_SUCCEEDED' || !job.output_file_id) {
    throw new Error(`Job not finished or no output file: ${job.status}`);
  }

  // Gemini File API Download (use the content endpoint)
  // The output file ID is like "files/..."
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/${job.output_file_id}:download?key=${GOOGLE_API_KEY}`);
  if (!response.ok) {
    throw new Error(`Failed to download results: ${response.status}`);
  }

  const content = await response.text();
  return content.split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
}
