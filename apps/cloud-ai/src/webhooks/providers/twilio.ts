/**
 * Twilio Webhook Handler
 * Handles SMS, voice calls, and messaging events
 */

import { verifyTwilioSignature, getProviderConfig, logWebhookEvent, updateWebhookEvent } from '../core';
import { writeLog } from '../../utils/logger';

// Twilio webhook types
export const TWILIO_EVENTS = {
  // SMS
  SMS_RECEIVED: 'sms.received',
  SMS_STATUS: 'sms.status',
  
  // Voice
  CALL_INCOMING: 'call.incoming',
  CALL_STATUS: 'call.status',
  
  // WhatsApp
  WHATSAPP_RECEIVED: 'whatsapp.received',
  WHATSAPP_STATUS: 'whatsapp.status',
} as const;

export interface TwilioSmsWebhook {
  MessageSid: string;
  AccountSid: string;
  From: string;
  To: string;
  Body: string;
  NumMedia?: string;
  MediaUrl0?: string;
  MediaContentType0?: string;
  FromCity?: string;
  FromState?: string;
  FromCountry?: string;
  ToCity?: string;
  ToState?: string;
  ToCountry?: string;
}

export interface TwilioStatusCallback {
  MessageSid: string;
  MessageStatus: 'accepted' | 'queued' | 'sending' | 'sent' | 'delivered' | 'undelivered' | 'failed' | 'read';
  ErrorCode?: string;
  ErrorMessage?: string;
  To: string;
  From: string;
}

export interface TwilioCallWebhook {
  CallSid: string;
  AccountSid: string;
  From: string;
  To: string;
  CallStatus: 'queued' | 'ringing' | 'in-progress' | 'completed' | 'busy' | 'failed' | 'no-answer' | 'canceled';
  Direction: 'inbound' | 'outbound-api' | 'outbound-dial';
  CallerName?: string;
  FromCity?: string;
  FromState?: string;
  FromCountry?: string;
}

export interface TwilioHandlerResult {
  ok: boolean;
  eventId?: string;
  action?: string;
  error?: string;
  twiml?: string; // Response TwiML for voice/messaging
  workflowTriggered?: string;
  smsContent?: {
    from: string;
    to: string;
    body: string;
    messageSid: string;
  };
}

/**
 * Process a Twilio SMS webhook (incoming message)
 */
export async function handleTwilioSmsWebhook(
  userId: string,
  params: Record<string, string>,
  fullUrl: string,
  signature: string,
  headers: Record<string, string>,
  sourceIp?: string
): Promise<TwilioHandlerResult> {
  // Get user's Twilio provider config
  const config = await getProviderConfig(userId, 'twilio');
  
  if (!config || !config.is_active) {
    writeLog('twilio_webhook_no_config', { userId });
    return { ok: false, error: 'twilio_not_configured' };
  }
  
  // Verify signature if auth token is configured
  const authToken = config.webhook_secret || process.env.TWILIO_AUTH_TOKEN;
  if (authToken && signature) {
    if (!verifyTwilioSignature(fullUrl, params, signature, authToken)) {
      writeLog('twilio_webhook_invalid_signature', { userId });
      return { ok: false, error: 'invalid_signature' };
    }
  }
  
  // Parse the SMS data
  const sms: TwilioSmsWebhook = params as any;
  
  // Log the event
  const eventId = await logWebhookEvent({
    user_id: userId,
    source_ip: sourceIp,
    method: 'POST',
    path: '/webhooks/twilio/sms',
    headers,
    query_params: {},
    body: params,
    raw_body: JSON.stringify(params),
    status: 'verified',
    delivery_attempts: 0,
  });
  
  writeLog('twilio_sms_received', {
    userId,
    from: sms.From,
    to: sms.To,
    messageSid: sms.MessageSid,
    hasMedia: parseInt(sms.NumMedia || '0') > 0,
  });
  
  // Check if user has mapped SMS to a workflow
  let workflowId: string | undefined;
  const mapping = config.event_mappings?.['sms.received'];
  if (mapping?.workflow_id) {
    workflowId = mapping.workflow_id;
  }
  
  // Update event status
  if (eventId) {
    await updateWebhookEvent(eventId, {
      status: 'delivered',
      delivered_to: workflowId ? `workflow:${workflowId}` : 'system',
      delivered_at: new Date().toISOString(),
      processed_at: new Date().toISOString(),
    });
  }
  
  return {
    ok: true,
    eventId: eventId || undefined,
    action: 'sms_received',
    workflowTriggered: workflowId,
    smsContent: {
      from: sms.From,
      to: sms.To,
      body: sms.Body,
      messageSid: sms.MessageSid,
    },
    // Default TwiML response (empty - no auto-reply)
    twiml: '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
  };
}

/**
 * Process a Twilio status callback
 */
export async function handleTwilioStatusCallback(
  userId: string,
  params: Record<string, string>,
  fullUrl: string,
  signature: string,
  headers: Record<string, string>,
  sourceIp?: string
): Promise<TwilioHandlerResult> {
  const config = await getProviderConfig(userId, 'twilio');
  
  if (!config || !config.is_active) {
    return { ok: false, error: 'twilio_not_configured' };
  }
  
  const status: TwilioStatusCallback = params as any;
  
  // Log the event
  const eventId = await logWebhookEvent({
    user_id: userId,
    source_ip: sourceIp,
    method: 'POST',
    path: '/webhooks/twilio/status',
    headers,
    query_params: {},
    body: params,
    raw_body: JSON.stringify(params),
    status: 'verified',
    delivery_attempts: 0,
  });
  
  writeLog('twilio_status_callback', {
    userId,
    messageSid: status.MessageSid,
    status: status.MessageStatus,
    errorCode: status.ErrorCode,
  });
  
  // Check for workflow mapping on specific statuses
  let workflowId: string | undefined;
  if (status.MessageStatus === 'delivered') {
    const mapping = config.event_mappings?.['sms.delivered'];
    if (mapping?.workflow_id) workflowId = mapping.workflow_id;
  } else if (status.MessageStatus === 'failed' || status.MessageStatus === 'undelivered') {
    const mapping = config.event_mappings?.['sms.failed'];
    if (mapping?.workflow_id) workflowId = mapping.workflow_id;
  }
  
  if (eventId) {
    await updateWebhookEvent(eventId, {
      status: 'delivered',
      delivered_to: 'system',
      delivered_at: new Date().toISOString(),
      processed_at: new Date().toISOString(),
    });
  }
  
  return {
    ok: true,
    eventId: eventId || undefined,
    action: `sms_status_${status.MessageStatus}`,
    workflowTriggered: workflowId,
  };
}

/**
 * Process a Twilio voice webhook (incoming call)
 */
export async function handleTwilioVoiceWebhook(
  userId: string,
  params: Record<string, string>,
  fullUrl: string,
  signature: string,
  headers: Record<string, string>,
  sourceIp?: string
): Promise<TwilioHandlerResult> {
  const config = await getProviderConfig(userId, 'twilio');
  
  if (!config || !config.is_active) {
    return { ok: false, error: 'twilio_not_configured' };
  }
  
  const call: TwilioCallWebhook = params as any;
  
  // Log the event
  const eventId = await logWebhookEvent({
    user_id: userId,
    source_ip: sourceIp,
    method: 'POST',
    path: '/webhooks/twilio/voice',
    headers,
    query_params: {},
    body: params,
    raw_body: JSON.stringify(params),
    status: 'verified',
    delivery_attempts: 0,
  });
  
  writeLog('twilio_call_received', {
    userId,
    from: call.From,
    to: call.To,
    callSid: call.CallSid,
    status: call.CallStatus,
    direction: call.Direction,
  });
  
  // Check for workflow mapping
  let workflowId: string | undefined;
  const mapping = config.event_mappings?.['call.incoming'];
  if (mapping?.workflow_id) {
    workflowId = mapping.workflow_id;
  }
  
  if (eventId) {
    await updateWebhookEvent(eventId, {
      status: 'delivered',
      delivered_to: workflowId ? `workflow:${workflowId}` : 'system',
      delivered_at: new Date().toISOString(),
      processed_at: new Date().toISOString(),
    });
  }
  
  // Get custom TwiML from config or use default
  const twiml = config.config?.voiceTwiml || 
    '<?xml version="1.0" encoding="UTF-8"?><Response><Say>This number is not accepting calls at this time.</Say></Response>';
  
  return {
    ok: true,
    eventId: eventId || undefined,
    action: 'call_incoming',
    workflowTriggered: workflowId,
    twiml,
  };
}

/**
 * Generate TwiML for SMS auto-reply
 */
export function generateSmsReplyTwiml(message: string): string {
  const escaped = message
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`;
}

/**
 * Generate TwiML for voice response
 */
export function generateVoiceTwiml(options: {
  say?: string;
  play?: string;
  gather?: {
    action: string;
    method?: string;
    numDigits?: number;
    timeout?: number;
    say?: string;
  };
  redirect?: string;
  hangup?: boolean;
}): string {
  let content = '';
  
  if (options.say) {
    const escaped = options.say.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    content += `<Say>${escaped}</Say>`;
  }
  
  if (options.play) {
    content += `<Play>${options.play}</Play>`;
  }
  
  if (options.gather) {
    const attrs = [
      `action="${options.gather.action}"`,
      options.gather.method ? `method="${options.gather.method}"` : '',
      options.gather.numDigits ? `numDigits="${options.gather.numDigits}"` : '',
      options.gather.timeout ? `timeout="${options.gather.timeout}"` : '',
    ].filter(Boolean).join(' ');
    
    const innerSay = options.gather.say 
      ? `<Say>${options.gather.say.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</Say>` 
      : '';
    
    content += `<Gather ${attrs}>${innerSay}</Gather>`;
  }
  
  if (options.redirect) {
    content += `<Redirect>${options.redirect}</Redirect>`;
  }
  
  if (options.hangup) {
    content += '<Hangup/>';
  }
  
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${content}</Response>`;
}
