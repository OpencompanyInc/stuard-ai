import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getSupabaseService } from '../supabase';
import { execLocalTool, hasClientBridge } from './bridge';
import * as os from 'os';

/**
 * Feedback Tools - Bug Reports & Feature Requests
 * 
 * Allows users to submit feedback directly through the chat interface.
 * Supports screenshots, severity levels, and labels.
 */

// Helper to get system metadata
function getSystemMetadata() {
  return {
    platform: os.platform(),
    arch: os.arch(),
    nodeVersion: process.version,
    timestamp: new Date().toISOString(),
  };
}

// Helper to upload screenshot to storage and get URL
async function processScreenshots(screenshots: string[], userId: string): Promise<{ url: string; caption?: string }[]> {
  const supabase = getSupabaseService();
  if (!supabase || !screenshots.length) return [];

  const processed: { url: string; caption?: string }[] = [];

  for (const screenshot of screenshots) {
    // If it's already a URL, use it directly
    if (screenshot.startsWith('http://') || screenshot.startsWith('https://')) {
      processed.push({ url: screenshot });
      continue;
    }

    // If it's a local path, try to read and upload it
    if (hasClientBridge()) {
      try {
        // Read the file as base64 through the agent
        const readResult = await execLocalTool('read_file', { 
          path: screenshot, 
          encoding: 'base64' 
        }, undefined, 10000);

        if (readResult?.ok && readResult?.content) {
          // Upload to Supabase storage
          const fileName = `feedback/${userId}/${Date.now()}_${screenshot.split(/[/\\]/).pop()}`;
          const buffer = Buffer.from(readResult.content, 'base64');
          
          const { data, error } = await supabase.storage
            .from('feedback-attachments')
            .upload(fileName, buffer, {
              contentType: 'image/png',
              upsert: false
            });

          if (!error && data) {
            const { data: urlData } = supabase.storage
              .from('feedback-attachments')
              .getPublicUrl(fileName);
            
            if (urlData?.publicUrl) {
              processed.push({ url: urlData.publicUrl, caption: screenshot.split(/[/\\]/).pop() });
            }
          }
        }
      } catch (err) {
        console.warn(`Failed to process screenshot: ${screenshot}`, err);
        // Still include the path as reference
        processed.push({ url: screenshot, caption: 'Local file (not uploaded)' });
      }
    } else {
      // No bridge, just store the path reference
      processed.push({ url: screenshot, caption: 'Local file reference' });
    }
  }

  return processed;
}

// GenUI feedback form helper
async function showFeedbackForm(args: {
  type?: 'bug' | 'feature';
  title?: string;
  description?: string;
  severity?: string;
  labels?: string[];
  screenshots?: string[];
}): Promise<{
  submitted: boolean;
  cancelled?: boolean;
  type?: 'bug' | 'feature';
  title?: string;
  description?: string;
  severity?: string;
  labels?: string[];
  screenshots?: string[];
}> {
  if (!hasClientBridge()) {
    // No UI available, use provided values directly
    return { 
      submitted: true,
      type: args.type || 'bug',
      title: args.title,
      description: args.description,
      severity: args.severity,
      labels: args.labels,
      screenshots: args.screenshots,
    };
  }

  try {
    const result = await execLocalTool('show_feedback_form', {
      type: args.type,
      title: args.title,
      description: args.description,
      severity: args.severity,
      labels: args.labels,
      suggestedLabels: ['ui', 'performance', 'workflow', 'bug', 'enhancement', 'documentation'],
      allowScreenshot: true,
    }, undefined, 300000); // 5 minute timeout for form completion

    return {
      submitted: result?.submitted === true,
      cancelled: result?.cancelled === true,
      type: result?.type,
      title: result?.title,
      description: result?.description,
      severity: result?.severity,
      labels: result?.labels,
      screenshots: result?.screenshots,
    };
  } catch (err) {
    console.warn('Feedback form failed', err);
    return { submitted: false, cancelled: true };
  }
}

export const submitFeedback = createTool({
  id: 'submit_feedback',
  description: 'Submit a bug report or feature request. Shows a confirmation dialog before submitting. Use this when the user wants to report issues or suggest improvements.',
  inputSchema: z.object({
    type: z.enum(['bug', 'feature']).describe('Type of feedback: "bug" for issues/problems, "feature" for suggestions/requests'),
    title: z.string().min(5).max(200).describe('Short summary of the feedback (5-200 characters)'),
    description: z.string().min(10).max(5000).describe('Detailed explanation of the bug or feature request'),
    severity: z.enum(['low', 'medium', 'high', 'critical']).optional().describe('Severity level (only for bugs): low=minor annoyance, medium=affects workflow, high=major blocker, critical=data loss/security'),
    screenshots: z.array(z.string()).optional().describe('Array of screenshot paths (local) or URLs. Tip: Use take_screenshot tool first to capture relevant screens.'),
    labels: z.array(z.string()).optional().describe('Tags for categorization, e.g., ["ui", "performance", "workflow"]'),
    skipConfirmation: z.boolean().optional().default(false).describe('Skip the confirmation dialog (use with caution)'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    feedbackId: z.string().optional(),
    type: z.string().optional(),
    title: z.string().optional(),
    status: z.string().optional(),
    cancelled: z.boolean().optional(),
    error: z.string().optional(),
  }),
  execute: async (args, runCtx) => {
    const { type, title, description, severity, screenshots, labels, skipConfirmation } = args.context;
    
    // Validate severity is only for bugs
    if (type === 'feature' && severity) {
      return {
        ok: false,
        error: 'Severity is only applicable for bug reports, not feature requests.',
      };
    }

    // Show feedback form unless skipped
    let finalType = type;
    let finalTitle = title;
    let finalDescription = description;
    let finalSeverity = severity;
    let finalLabels = labels;
    let finalScreenshots = screenshots;

    if (!skipConfirmation) {
      const formResult = await showFeedbackForm({
        type,
        title,
        description,
        severity,
        labels,
        screenshots,
      });

      if (!formResult.submitted) {
        return {
          ok: false,
          cancelled: true,
          error: 'Feedback submission cancelled by user.',
        };
      }

      // Use values from the form (user may have edited them)
      finalType = formResult.type || type;
      finalTitle = formResult.title || title;
      finalDescription = formResult.description || description;
      finalSeverity = (formResult.severity as 'low' | 'medium' | 'high' | 'critical' | undefined) || severity;
      finalLabels = formResult.labels || labels;
      finalScreenshots = formResult.screenshots || screenshots;
    }

    const supabase = getSupabaseService();
    if (!supabase) {
      return {
        ok: false,
        error: 'Database service unavailable. Please try again later.',
      };
    }

    // Get user ID from runtime context if available
    const userId = (runCtx as any)?.userId || null;

    // Process screenshots
    const processedScreenshots = await processScreenshots(finalScreenshots || [], userId || 'anonymous');

    // Build metadata
    const metadata = {
      ...getSystemMetadata(),
      hasClientBridge: hasClientBridge(),
      screenshotCount: finalScreenshots?.length || 0,
    };

    // Insert feedback
    const { data, error } = await supabase
      .from('feedback')
      .insert({
        user_id: userId,
        type: finalType,
        title: finalTitle,
        description: finalDescription,
        severity: finalType === 'bug' ? finalSeverity || 'medium' : null,
        labels: finalLabels || [],
        screenshots: processedScreenshots,
        metadata,
        status: 'open',
      })
      .select('id, type, title, status')
      .single();

    if (error) {
      console.error('Failed to submit feedback:', error);
      return {
        ok: false,
        error: `Failed to submit feedback: ${error.message}`,
      };
    }

    return {
      ok: true,
      feedbackId: data.id,
      type: data.type,
      title: data.title,
      status: data.status,
    };
  },
});

export const listMyFeedback = createTool({
  id: 'list_my_feedback',
  description: 'List your submitted bug reports and feature requests.',
  inputSchema: z.object({
    type: z.enum(['bug', 'feature', 'all']).optional().default('all').describe('Filter by type'),
    status: z.enum(['open', 'in_progress', 'resolved', 'closed', 'all']).optional().default('all').describe('Filter by status'),
    limit: z.number().min(1).max(50).optional().default(10).describe('Max results'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    feedback: z.array(z.object({
      id: z.string(),
      type: z.string(),
      title: z.string(),
      status: z.string(),
      severity: z.string().nullable(),
      createdAt: z.string(),
    })).optional(),
    count: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async (args, runCtx) => {
    const { type, status, limit } = args.context;
    
    const supabase = getSupabaseService();
    if (!supabase) {
      return { ok: false, error: 'Database service unavailable.' };
    }

    const userId = (runCtx as any)?.userId;
    if (!userId) {
      return { ok: false, error: 'User not authenticated.' };
    }

    let query = supabase
      .from('feedback')
      .select('id, type, title, status, severity, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (type !== 'all') {
      query = query.eq('type', type);
    }
    if (status !== 'all') {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) {
      return { ok: false, error: error.message };
    }

    return {
      ok: true,
      feedback: data?.map(f => ({
        id: f.id,
        type: f.type,
        title: f.title,
        status: f.status,
        severity: f.severity,
        createdAt: f.created_at,
      })) || [],
      count: data?.length || 0,
    };
  },
});

export const getFeedbackDetails = createTool({
  id: 'get_feedback_details',
  description: 'Get full details of a specific feedback item including comments.',
  inputSchema: z.object({
    feedbackId: z.string().uuid().describe('The feedback ID to retrieve'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    feedback: z.any().optional(),
    comments: z.array(z.any()).optional(),
    error: z.string().optional(),
  }),
  execute: async (args, runCtx) => {
    const { feedbackId } = args.context;
    
    const supabase = getSupabaseService();
    if (!supabase) {
      return { ok: false, error: 'Database service unavailable.' };
    }

    const userId = (runCtx as any)?.userId;

    // Get feedback (RLS will filter if not owner)
    const { data: feedback, error: feedbackError } = await supabase
      .from('feedback')
      .select('*')
      .eq('id', feedbackId)
      .single();

    if (feedbackError || !feedback) {
      return { ok: false, error: 'Feedback not found or access denied.' };
    }

    // Get comments
    const { data: comments } = await supabase
      .from('feedback_comments')
      .select('*')
      .eq('feedback_id', feedbackId)
      .order('created_at', { ascending: true });

    return {
      ok: true,
      feedback: {
        ...feedback,
        createdAt: feedback.created_at,
        updatedAt: feedback.updated_at,
      },
      comments: comments || [],
    };
  },
});

// Convenience aliases
export const reportBug = createTool({
  id: 'report_bug',
  description: 'Quick way to report a bug. Shortcut for submit_feedback with type="bug".',
  inputSchema: z.object({
    title: z.string().min(5).max(200).describe('Short bug summary'),
    description: z.string().min(10).max(5000).describe('Steps to reproduce, expected vs actual behavior'),
    severity: z.enum(['low', 'medium', 'high', 'critical']).optional().default('medium'),
    screenshots: z.array(z.string()).optional(),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    feedbackId: z.string().optional(),
    error: z.string().optional(),
    cancelled: z.boolean().optional(),
  }),
  execute: async (args, runCtx) => {
    const { title, description, severity, screenshots } = args.context;
    return submitFeedback.execute({
      context: {
        type: 'bug' as const,
        title,
        description,
        severity,
        screenshots,
        labels: ['bug'],
        skipConfirmation: false,
      },
    } as any, runCtx);
  },
});

export const suggestFeature = createTool({
  id: 'suggest_feature',
  description: 'Quick way to suggest a feature. Shortcut for submit_feedback with type="feature".',
  inputSchema: z.object({
    title: z.string().min(5).max(200).describe('Feature title'),
    description: z.string().min(10).max(5000).describe('Describe the feature, use case, and benefits'),
    screenshots: z.array(z.string()).optional().describe('Mockups or reference screenshots'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    feedbackId: z.string().optional(),
    error: z.string().optional(),
    cancelled: z.boolean().optional(),
  }),
  execute: async (args, runCtx) => {
    const { title, description, screenshots } = args.context;
    return submitFeedback.execute({
      context: {
        type: 'feature' as const,
        title,
        description,
        screenshots,
        labels: ['enhancement'],
        skipConfirmation: false,
      },
    } as any, runCtx);
  },
});

// Export all feedback tools
export const feedbackTools = {
  submit_feedback: submitFeedback,
  report_bug: reportBug,
  suggest_feature: suggestFeature,
  list_my_feedback: listMyFeedback,
  get_feedback_details: getFeedbackDetails,
};
