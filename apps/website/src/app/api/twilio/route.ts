import { NextRequest, NextResponse } from 'next/server';

// This route handles incoming SMS webhooks from Twilio
// It is a public route (no auth required) so Twilio can reach it
export async function POST(req: NextRequest) {
  try {
    // 1. Parse the incoming form data from Twilio
    const formData = await req.formData();
    const Body = formData.get('Body')?.toString().trim().toUpperCase() || '';
    const From = formData.get('From')?.toString() || '';

    console.log(`Received SMS from ${From}: ${Body}`);

    // 2. Handle standard keywords (STOP, START, HELP)
    // Note: Twilio handles STOP/START/HELP automatically at the carrier/gateway level for many numbers,
    // but handling it here allows us to sync our database state.
    
    let message = '';

    if (Body === 'STOP') {
      // TODO: Update DB to set sms_opt_in = false for this phone number
      console.log(`User ${From} opted out via SMS`);
      message = 'You have been unsubscribed from Stuard AI updates. No further messages will be sent.';
    } else if (Body === 'START' || Body === 'UNSTOP') {
      // TODO: Update DB to set sms_opt_in = true
      console.log(`User ${From} opted back in via SMS`);
      message = 'You have resubscribed to Stuard AI updates. Msg & data rates may apply.';
    } else if (Body === 'HELP') {
      message = 'Stuard AI Help: Contact support@stuard.ai for assistance. Reply STOP to cancel.';
    } else {
      // Handle other incoming messages (e.g. triggering a workflow via SMS)
      // TODO: Lookup user by phone number and trigger associated agent action
      message = 'Thanks for your message. Your Stuard agent has received it.';
    }

    // 3. Respond with TwiML
    // We return XML so Twilio knows how to reply (if at all)
    const twiml = `
      <?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Message>${message}</Message>
      </Response>
    `.trim();

    return new NextResponse(twiml, {
      headers: {
        'Content-Type': 'text/xml',
      },
    });

  } catch (error) {
    console.error('Error handling Twilio webhook:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}

// Allow GET requests too for easy testing/debugging if needed
export async function GET(req: NextRequest) {
  return new NextResponse('Twilio Webhook Endpoint Active', { status: 200 });
}
