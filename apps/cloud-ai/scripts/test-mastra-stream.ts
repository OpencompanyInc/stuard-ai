/**
 * Test Mastra Agent streaming with reasoning support
 * Run with: npx tsx scripts/test-mastra-stream.ts
 * 
 * This mirrors how server.ts handles reasoning:
 * 1. stream.reasoning promise (resolves to full reasoning text)
 * 2. reasoning-delta / thinking-delta chunks in fullStream
 */
import 'dotenv/config';
import { Agent } from '@mastra/core/agent';
import { openai } from '@ai-sdk/openai';

const TEST_PROMPT = `how many rs in strawberry`;

async function testMastraStream() {
  console.log('\n========== TEST: Mastra Agent with GPT-5.1 ==========');
  
  const agent = new Agent({
    name: 'reasoning-tester',
    instructions: [
      {
        role: 'system',
        content: 'You are a helpful assistant. Solve problems step by step.',
        providerOptions: {
          openai: { reasoningEffort: 'high' },
        },
      },
    ] as any,
    model: "openai/o3-mini",
  });

  const stream = await agent.stream(TEST_PROMPT);

  let text = '';
  let reasoningFromChunks = '';
  let reasoningFromPromise = '';

  // Method 1: Mastra exposes reasoning via a promise (how server.ts does it)
  (async () => {
    try {
      const r = await (stream as any).reasoning;
      if (r && typeof r === 'string' && r.trim()) {
        reasoningFromPromise = r.trim();
        console.log('\n🧠 [Reasoning Promise Resolved]:', r.slice(0, 200), r.length > 200 ? '...' : '');
      }
    } catch (e) {
      // Model may not support reasoning promise
    }
  })();

  // Method 2: Stream chunks (reasoning-delta, thinking-delta)
  console.log('\n--- STREAMING CHUNKS ---');
  const fullStream = (stream as any).fullStream;
  let usage: any = null;
  
  for await (const chunk of fullStream) {
    const type = (chunk as any).type;
    const payload = (chunk as any).payload;

    // Debug: log every chunk type and first 200 chars of payload/chunk
    try {
      const preview = JSON.stringify(payload ?? chunk).slice(0, 200);
      console.log(`[${type}]`, preview);
    } catch {
      console.log(`[${type}]`, '(unserializable chunk)');
    }

    switch (type) {
      case 'text-delta':
        // Handle both payload.text and direct properties (varies by provider)
        const textDelta = payload?.text || (chunk as any).textDelta || (chunk as any).text || '';
        if (textDelta) {
          process.stdout.write(textDelta);
          text += textDelta;
        }
        break;

      case 'reasoning-delta':
      case 'thinking-delta':
        const rDelta = payload?.text || (chunk as any).textDelta || '';
        if (rDelta) {
          console.log('\n🧠 [Reasoning Delta]:', rDelta.slice(0, 100));
          reasoningFromChunks += rDelta;
        }
        break;

      case 'reasoning-start':
      case 'thinking-start':
        console.log('\n🧠 [Reasoning Start]');
        break;

      case 'reasoning-end':
      case 'thinking-end':
        console.log('\n🧠 [Reasoning End]');
        break;

      case 'reasoning-signature':
        console.log('\n🧠 [Reasoning Signature]:', payload?.signature || (chunk as any).signature);
        break;

      case 'tool-call':
        console.log(`\n🛠️ [Tool Call]: ${payload?.toolName}`);
        break;

      case 'finish':
        console.log('\n\n🏁 [Finish]');
        if (payload?.output?.usage) {
          usage = payload.output.usage;
          console.log('Usage:', payload.output.usage);
        }
        break;

      case 'error':
        console.error('\n❌ [Error]:', payload?.error);
        break;

      default:
        // Uncomment to see all chunk types
        // console.log(`\n[${type}]`, JSON.stringify(payload || chunk).slice(0, 100));
        break;
    }
  }

  // Wait for reasoning promise to resolve
  await new Promise(r => setTimeout(r, 1000));

  console.log('\n\n========== RESULTS ==========');
  console.log('\n--- NORMAL TEXT ---');
  console.log(text || '(none)');
  console.log('\n--- REASONING (from chunks) ---');
  console.log(reasoningFromChunks || '(none)');
  console.log('\n--- REASONING (from promise) ---');
  console.log(reasoningFromPromise || '(none)');

  if (usage && typeof usage.reasoningTokens === 'number') {
    console.log('\n--- REASONING TOKENS ---');
    console.log('reasoningTokens:', usage.reasoningTokens);
    if (
      usage.reasoningTokens > 0 &&
      !reasoningFromChunks.trim() &&
      !reasoningFromPromise.trim()
    ) {
      console.log(
        '\nNote: Model used reasoning tokens but did not expose reasoning text. ' +
        'This is expected for some models that hide chain-of-thought.'
      );
    }
  }
}

async function main() {
  console.log('Starting Mastra Agent streaming test...\n');
  console.log('OPENAI_API_KEY set:', !!process.env.OPENAI_API_KEY);

  try {
    await testMastraStream();
  } catch (e) {
    console.error('Test failed:', e);
  }

  console.log('\n\n========== TEST COMPLETE ==========');
}

main().catch(console.error);
