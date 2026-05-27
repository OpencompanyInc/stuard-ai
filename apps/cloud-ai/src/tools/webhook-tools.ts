/**
 * Webhook Tools for AI
 * Tools that let the AI create and manage webhooks for users
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getBridgeSecrets } from './bridge';
import { 
  createWebhook, 
  getWebhooksByUser, 
  updateWebhook, 
  deleteWebhook,
  getProviderConfig,
  upsertProviderConfig,
} from '../webhooks/core';

const CLOUD_PUBLIC_URL = process.env.CLOUD_PUBLIC_URL || 'https://api.stuard.ai';

/**
 * Create a webhook endpoint
 */
export const create_webhook = createTool({
  id: 'create_webhook',
  description: 'Create a cloud webhook endpoint that external services can POST to in order to trigger workflows or receive events. For local website request/response calls, use a workflow webhook trigger with mode "local" and the desktop /webhooks/call/:flowId URL from workflow docs.',
  inputSchema: z.object({
    name: z.string().describe('A descriptive name for the webhook'),
    description: z.string().optional().describe('Optional description of what this webhook does'),
    type: z.enum(['workflow', 'custom', 'integration']).default('workflow').describe('Type of webhook'),
    workflowId: z.string().optional().describe('ID of the workflow to trigger when webhook is called'),
    triggerId: z.string().optional().describe('Specific trigger ID within the workflow'),
    requireSignature: z.boolean().default(false).describe('Require HMAC signature verification'),
    allowedIps: z.array(z.string()).optional().describe('Optional list of allowed IP addresses'),
    isActive: z.boolean().optional().describe('Enable or disable the public cloud incoming URL. Local-only registry rows may be inactive but still used for Supabase discovery/history.'),
    metadata: z.record(z.string(), z.any()).optional().describe('Optional metadata such as local endpoint descriptors or integration context.'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    error: z.string().optional(),
    webhook: z.object({
      id: z.string(),
      name: z.string(),
      slug: z.string(),
      type: z.string(),
      url: z.string(),
      secret: z.string(),
      requireSignature: z.boolean(),
    }).optional(),
    message: z.string().optional(),
  }),
  execute: async (inputData, context) => {
    const { name, description, type, workflowId, triggerId, requireSignature, allowedIps, isActive, metadata  } = inputData as any;
    const secrets = getBridgeSecrets();
    const userId = secrets?.userId;
    
    if (!userId) {
      return { ok: false, error: 'not_authenticated' };
    }
    
    const webhook = await createWebhook(userId, {
      name,
      description,
      type,
      target_workflow_id: workflowId,
      target_workflow_trigger_id: triggerId,
      require_signature: requireSignature,
      allowed_ips: allowedIps,
      is_active: isActive,
      metadata,
    });
    
    if (!webhook) {
      return { ok: false, error: 'create_failed' };
    }
    
    return {
      ok: true,
      webhook: {
        id: webhook.id,
        name: webhook.name,
        slug: webhook.slug,
        type: webhook.type,
        url: `${CLOUD_PUBLIC_URL}/webhooks/incoming/${webhook.slug}`,
        secret: webhook.secret,
        requireSignature: webhook.require_signature,
      },
      message: `Webhook created! External services can POST to: ${CLOUD_PUBLIC_URL}/webhooks/incoming/${webhook.slug}`,
    };
  },
});

/**
 * List user's webhooks
 */
export const list_webhooks = createTool({
  id: 'list_webhooks',
  description: 'List all webhooks configured for the user, including cloud endpoints and Supabase-synced local webhook metadata/history rows.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    ok: z.boolean(),
    error: z.string().optional(),
    webhooks: z.array(z.object({
      id: z.string(),
      name: z.string(),
      slug: z.string(),
      type: z.string(),
      url: z.string(),
      isActive: z.boolean(),
      triggerCount: z.number(),
      lastTriggeredAt: z.string().optional(),
      workflowId: z.string().optional(),
      metadata: z.any().optional(),
    })).optional(),
    count: z.number().optional(),
  }),
  execute: async () => {
    const secrets = getBridgeSecrets();
    const userId = secrets?.userId;
    
    if (!userId) {
      return { ok: false, error: 'not_authenticated' };
    }
    
    const webhooks = await getWebhooksByUser(userId);
    
    return {
      ok: true,
      webhooks: webhooks.map(w => ({
        id: w.id,
        name: w.name,
        slug: w.slug,
        type: w.type,
        url: `${CLOUD_PUBLIC_URL}/webhooks/incoming/${w.slug}`,
        isActive: w.is_active,
        triggerCount: w.trigger_count,
        lastTriggeredAt: w.last_triggered_at,
        workflowId: w.target_workflow_id,
        metadata: w.metadata,
      })),
      count: webhooks.length,
    };
  },
});

/**
 * Update a webhook
 */
export const update_webhook = createTool({
  id: 'update_webhook',
  description: 'Update an existing webhook configuration',
  inputSchema: z.object({
    webhookId: z.string().describe('ID of the webhook to update'),
    name: z.string().optional().describe('New name'),
    description: z.string().optional().describe('New description'),
    isActive: z.boolean().optional().describe('Enable or disable the webhook'),
    workflowId: z.string().optional().describe('New workflow ID to trigger'),
    triggerId: z.string().optional().describe('New trigger ID'),
    requireSignature: z.boolean().optional().describe('Require signature verification'),
    allowedIps: z.array(z.string()).optional().describe('New IP whitelist'),
    metadata: z.record(z.string(), z.any()).optional().describe('Replace webhook metadata, including synced local endpoint descriptors.'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    error: z.string().optional(),
    message: z.string().optional(),
  }),
  execute: async (inputData, context) => {
    const { webhookId, name, description, isActive, workflowId, triggerId, requireSignature, allowedIps, metadata  } = inputData as any;
    const secrets = getBridgeSecrets();
    const userId = secrets?.userId;
    
    if (!userId) {
      return { ok: false, error: 'not_authenticated' };
    }
    
    const updates: any = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (isActive !== undefined) updates.is_active = isActive;
    if (workflowId !== undefined) updates.target_workflow_id = workflowId;
    if (triggerId !== undefined) updates.target_workflow_trigger_id = triggerId;
    if (requireSignature !== undefined) updates.require_signature = requireSignature;
    if (allowedIps !== undefined) updates.allowed_ips = allowedIps;
    if (metadata !== undefined) updates.metadata = metadata;
    
    const success = await updateWebhook(userId, webhookId, updates);
    
    return { ok: success, message: success ? 'Webhook updated' : 'Update failed' };
  },
});

/**
 * Delete a webhook
 */
export const delete_webhook = createTool({
  id: 'delete_webhook',
  description: 'Delete a webhook endpoint',
  inputSchema: z.object({
    webhookId: z.string().describe('ID of the webhook to delete'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    error: z.string().optional(),
    message: z.string().optional(),
  }),
  execute: async (inputData, context) => {
    const { webhookId  } = inputData as any;
    const secrets = getBridgeSecrets();
    const userId = secrets?.userId;
    
    if (!userId) {
      return { ok: false, error: 'not_authenticated' };
    }
    
    const success = await deleteWebhook(userId, webhookId);
    
    return { ok: success, message: success ? 'Webhook deleted' : 'Delete failed' };
  },
});

/**
 * Configure a payment/SMS provider (Stripe, Twilio)
 */
export const configure_webhook_provider = createTool({
  id: 'configure_webhook_provider',
  description: 'Configure a webhook provider like Stripe (payments) or Twilio (SMS/calls). This sets up the credentials and event mappings.',
  inputSchema: z.object({
    provider: z.enum(['stripe', 'twilio', 'github', 'sendgrid', 'slack']).describe('The provider to configure'),
    webhookSecret: z.string().optional().describe('The webhook signing secret from the provider'),
    config: z.record(z.string(), z.any()).optional().describe('Provider-specific configuration'),
    eventMappings: z.record(z.string(), z.object({
      workflow_id: z.string().optional(),
      action: z.string().optional(),
    })).optional().describe('Map provider events to workflows'),
    isActive: z.boolean().default(true).describe('Enable or disable this provider'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    error: z.string().optional(),
    provider: z.string().optional(),
    isActive: z.boolean().optional(),
    instructions: z.string().optional(),
  }),
  execute: async (inputData, context) => {
    const { provider, webhookSecret, config, eventMappings, isActive  } = inputData as any;
    const secrets = getBridgeSecrets();
    const userId = secrets?.userId;
    
    if (!userId) {
      return { ok: false, error: 'not_authenticated' };
    }
    
    const success = await upsertProviderConfig(userId, provider, {
      webhook_secret: webhookSecret,
      config: config || {},
      event_mappings: eventMappings || {},
      is_active: isActive,
    });
    
    if (!success) {
      return { ok: false, error: 'configure_failed' };
    }
    
    // Return provider-specific setup instructions
    let instructions = '';
    switch (provider) {
      case 'stripe':
        instructions = `Stripe configured! Set your Stripe webhook URL to: ${CLOUD_PUBLIC_URL}/webhooks/stripe\nAdd your user ID to the metadata when creating charges/subscriptions: metadata: { userId: "your-user-id" }`;
        break;
      case 'twilio':
        instructions = `Twilio configured! Set your Twilio webhook URLs:\n- SMS: ${CLOUD_PUBLIC_URL}/webhooks/twilio/sms?user_id=${userId}\n- Status Callback: ${CLOUD_PUBLIC_URL}/webhooks/twilio/status?user_id=${userId}\n- Voice: ${CLOUD_PUBLIC_URL}/webhooks/twilio/voice?user_id=${userId}`;
        break;
      default:
        instructions = `${provider} configured successfully.`;
    }
    
    return {
      ok: true,
      provider,
      isActive,
      instructions,
    };
  },
});

/**
 * Get provider configuration
 */
export const get_webhook_provider = createTool({
  id: 'get_webhook_provider',
  description: 'Get the current configuration for a webhook provider',
  inputSchema: z.object({
    provider: z.enum(['stripe', 'twilio', 'github', 'sendgrid', 'slack']).describe('The provider to check'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    error: z.string().optional(),
    configured: z.boolean().optional(),
    message: z.string().optional(),
    provider: z.string().optional(),
    isActive: z.boolean().optional(),
    hasSecret: z.boolean().optional(),
    eventMappings: z.record(z.string(), z.any()).optional(),
    eventCount: z.number().optional(),
    lastEventAt: z.string().optional(),
  }),
  execute: async (inputData, context) => {
    const { provider  } = inputData as any;
    const secrets = getBridgeSecrets();
    const userId = secrets?.userId;
    
    if (!userId) {
      return { ok: false, error: 'not_authenticated' };
    }
    
    const config = await getProviderConfig(userId, provider);
    
    if (!config) {
      return { ok: false, configured: false, message: `${provider} is not configured` };
    }
    
    return {
      ok: true,
      configured: true,
      provider: config.provider,
      isActive: config.is_active,
      hasSecret: !!config.webhook_secret,
      eventMappings: config.event_mappings,
      eventCount: config.event_count,
      lastEventAt: config.last_event_at,
    };
  },
});

// Export all webhook tools
export const webhookTools = {
  create_webhook,
  list_webhooks,
  update_webhook,
  delete_webhook,
  configure_webhook_provider,
  get_webhook_provider,
};
