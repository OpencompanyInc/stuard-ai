/**
 * Stripe Webhook Handler
 * Handles payment events: charges, subscriptions, invoices, etc.
 */

import { verifyStripeSignature, getProviderConfig, logWebhookEvent, updateWebhookEvent } from '../core';
import { writeLog } from '../../utils/logger';
import { getSupabaseService } from '../../supabase';

// Common Stripe event types we handle
export const STRIPE_EVENTS = {
  // Payments
  CHARGE_SUCCEEDED: 'charge.succeeded',
  CHARGE_FAILED: 'charge.failed',
  CHARGE_REFUNDED: 'charge.refunded',
  
  // Payment Intents
  PAYMENT_INTENT_SUCCEEDED: 'payment_intent.succeeded',
  PAYMENT_INTENT_FAILED: 'payment_intent.payment_failed',
  PAYMENT_INTENT_CANCELED: 'payment_intent.canceled',
  
  // Subscriptions
  SUBSCRIPTION_CREATED: 'customer.subscription.created',
  SUBSCRIPTION_UPDATED: 'customer.subscription.updated',
  SUBSCRIPTION_DELETED: 'customer.subscription.deleted',
  SUBSCRIPTION_TRIAL_ENDING: 'customer.subscription.trial_will_end',
  
  // Invoices
  INVOICE_PAID: 'invoice.paid',
  INVOICE_PAYMENT_FAILED: 'invoice.payment_failed',
  INVOICE_UPCOMING: 'invoice.upcoming',
  
  // Checkout
  CHECKOUT_COMPLETED: 'checkout.session.completed',
  CHECKOUT_EXPIRED: 'checkout.session.expired',
  
  // Customer
  CUSTOMER_CREATED: 'customer.created',
  CUSTOMER_UPDATED: 'customer.updated',
  CUSTOMER_DELETED: 'customer.deleted',
} as const;

export interface StripeEvent {
  id: string;
  type: string;
  created: number;
  livemode: boolean;
  data: {
    object: any;
    previous_attributes?: any;
  };
  request?: {
    id: string;
    idempotency_key?: string;
  };
}

export interface StripeHandlerResult {
  ok: boolean;
  eventId?: string;
  action?: string;
  error?: string;
  workflowTriggered?: string;
}

/**
 * Process a Stripe webhook event
 */
export async function handleStripeWebhook(
  userId: string,
  rawBody: string,
  signature: string,
  headers: Record<string, string>,
  sourceIp?: string
): Promise<StripeHandlerResult> {
  // Get user's Stripe provider config
  const config = await getProviderConfig(userId, 'stripe');
  
  if (!config || !config.is_active) {
    writeLog('stripe_webhook_no_config', { userId });
    return { ok: false, error: 'stripe_not_configured' };
  }
  
  // Verify signature
  const secret = config.webhook_secret || process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    writeLog('stripe_webhook_no_secret', { userId });
    return { ok: false, error: 'missing_webhook_secret' };
  }
  
  if (!verifyStripeSignature(rawBody, signature, secret)) {
    writeLog('stripe_webhook_invalid_signature', { userId });
    return { ok: false, error: 'invalid_signature' };
  }
  
  // Parse the event
  let event: StripeEvent;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return { ok: false, error: 'invalid_json' };
  }
  
  // Log the event
  const eventId = await logWebhookEvent({
    user_id: userId,
    source_ip: sourceIp,
    method: 'POST',
    path: '/webhooks/stripe',
    headers,
    query_params: {},
    body: event,
    raw_body: rawBody,
    status: 'verified',
    delivery_attempts: 0,
  });
  
  writeLog('stripe_webhook_received', { 
    userId, 
    eventType: event.type, 
    eventId: event.id,
    livemode: event.livemode 
  });
  
  // Process the event based on type
  let action: string | undefined;
  let workflowId: string | undefined;
  
  try {
    // Check if user has mapped this event to a workflow
    const mapping = config.event_mappings?.[event.type];
    if (mapping?.workflow_id) {
      workflowId = mapping.workflow_id;
      action = 'trigger_workflow';
    }
    
    // Handle specific events
    switch (event.type) {
      case STRIPE_EVENTS.PAYMENT_INTENT_SUCCEEDED:
      case STRIPE_EVENTS.CHARGE_SUCCEEDED:
        action = action || 'payment_succeeded';
        await handlePaymentSucceeded(userId, event);
        break;
        
      case STRIPE_EVENTS.PAYMENT_INTENT_FAILED:
      case STRIPE_EVENTS.CHARGE_FAILED:
        action = action || 'payment_failed';
        await handlePaymentFailed(userId, event);
        break;
        
      case STRIPE_EVENTS.SUBSCRIPTION_CREATED:
        action = action || 'subscription_created';
        await handleSubscriptionCreated(userId, event);
        break;
        
      case STRIPE_EVENTS.SUBSCRIPTION_UPDATED:
        action = action || 'subscription_updated';
        await handleSubscriptionUpdated(userId, event);
        break;
        
      case STRIPE_EVENTS.SUBSCRIPTION_DELETED:
        action = action || 'subscription_deleted';
        await handleSubscriptionDeleted(userId, event);
        break;
        
      case STRIPE_EVENTS.INVOICE_PAID:
        action = action || 'invoice_paid';
        break;
        
      case STRIPE_EVENTS.INVOICE_PAYMENT_FAILED:
        action = action || 'invoice_payment_failed';
        break;
        
      case STRIPE_EVENTS.CHECKOUT_COMPLETED:
        action = action || 'checkout_completed';
        await handleCheckoutCompleted(userId, event);
        break;
        
      default:
        action = 'logged';
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
      action,
      workflowTriggered: workflowId,
    };
    
  } catch (e: any) {
    writeLog('stripe_webhook_error', { userId, eventType: event.type, error: e?.message });
    
    if (eventId) {
      await updateWebhookEvent(eventId, {
        status: 'failed',
        error_message: e?.message || 'processing_error',
        processed_at: new Date().toISOString(),
      });
    }
    
    return { ok: false, error: e?.message || 'processing_error', eventId: eventId || undefined };
  }
}

// Event handlers
async function handlePaymentSucceeded(userId: string, event: StripeEvent) {
  const payment = event.data.object;
  writeLog('stripe_payment_succeeded', {
    userId,
    amount: payment.amount,
    currency: payment.currency,
    customerId: payment.customer,
  });
  
  // Could update user credits, send notifications, etc.
}

async function handlePaymentFailed(userId: string, event: StripeEvent) {
  const payment = event.data.object;
  writeLog('stripe_payment_failed', {
    userId,
    amount: payment.amount,
    currency: payment.currency,
    customerId: payment.customer,
    failureReason: payment.failure_message || payment.last_payment_error?.message,
  });
}

async function handleSubscriptionCreated(userId: string, event: StripeEvent) {
  const subscription = event.data.object;
  writeLog('stripe_subscription_created', {
    userId,
    subscriptionId: subscription.id,
    status: subscription.status,
    priceId: subscription.items?.data?.[0]?.price?.id,
  });
  
  // Update user plan in database
  await updateUserPlanFromSubscription(userId, subscription);
}

async function handleSubscriptionUpdated(userId: string, event: StripeEvent) {
  const subscription = event.data.object;
  writeLog('stripe_subscription_updated', {
    userId,
    subscriptionId: subscription.id,
    status: subscription.status,
    cancelAt: subscription.cancel_at,
  });
  
  await updateUserPlanFromSubscription(userId, subscription);
}

async function handleSubscriptionDeleted(userId: string, event: StripeEvent) {
  const subscription = event.data.object;
  writeLog('stripe_subscription_deleted', {
    userId,
    subscriptionId: subscription.id,
  });
  
  // Downgrade to free plan
  const supabase = getSupabaseService();
  if (supabase) {
    try {
      await supabase
        .from('profiles')
        .update({ plan: 'free' })
        .eq('user_id', userId);
    } catch {}
  }
}

async function handleCheckoutCompleted(userId: string, event: StripeEvent) {
  const session = event.data.object;
  writeLog('stripe_checkout_completed', {
    userId,
    sessionId: session.id,
    mode: session.mode,
    paymentStatus: session.payment_status,
  });
}

async function updateUserPlanFromSubscription(userId: string, subscription: any) {
  const supabase = getSupabaseService();
  if (!supabase) return;
  
  // Map price/product IDs to plans (configure via env or config)
  const priceId = subscription.items?.data?.[0]?.price?.id;
  const productId = subscription.items?.data?.[0]?.price?.product;
  
  let plan = 'free';
  if (subscription.status === 'active' || subscription.status === 'trialing') {
    // Check product/price mappings
    const starterProductId = process.env.STRIPE_PRODUCT_STARTER;
    const proProductId = process.env.STRIPE_PRODUCT_PRO;
    const powerProductId = process.env.STRIPE_PRODUCT_POWER;
    
    if (productId === powerProductId) plan = 'power';
    else if (productId === proProductId) plan = 'pro';
    else if (productId === starterProductId) plan = 'starter';
    else plan = 'starter'; // Default paid plan
  }
  
  try {
    await supabase
      .from('profiles')
      .update({ 
        plan,
        stripe_subscription_id: subscription.id,
        stripe_customer_id: subscription.customer,
      })
      .eq('user_id', userId);
  } catch {}
}

/**
 * Get the user ID from Stripe customer metadata
 */
export function extractUserIdFromStripeEvent(event: StripeEvent): string | null {
  const obj = event.data.object;
  
  // Check various locations for user ID
  const candidates = [
    obj?.metadata?.userId,
    obj?.metadata?.user_id,
    obj?.customer_metadata?.userId,
    obj?.customer_metadata?.user_id,
    obj?.client_reference_id,
  ];
  
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) {
      return c.trim();
    }
  }
  
  return null;
}
