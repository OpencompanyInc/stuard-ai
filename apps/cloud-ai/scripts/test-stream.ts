/**
 * Standalone test for xAI streaming with AI SDK (no Mastra)
 * Run with: npx tsx scripts/test-stream.ts
 */
import 'dotenv/config';
import { streamText } from 'ai';
import { xai } from '@ai-sdk/xai';

const TEST_PROMPT = `You are given 3 boxes: one contains only apples, one contains only oranges, and one contains both apples and oranges. The boxes are labeled "Apples", "Oranges", and "Mixed" - but ALL labels are wrong (every box has the wrong label).

You can pick ONE fruit from ONE box without looking inside. After picking that one fruit, you must correctly label all three boxes.

Which box should you pick from, and how do you figure out all three labels from that single pick? Explain your complete reasoning.`;

async function testXaiStream() {
  console.log('\n========== TEST: xAI with AI SDK (no Mastra) ==========');
  
  const result = await streamText({
    model: xai('grok-4-1-fast'),
    system: 'You are a helpful assistant. Think through problems step by step.',
    prompt: TEST_PROMPT,
  });

  let text = '';
  let reasoning = '';
  
  console.log('\n--- STREAMING CHUNKS ---');
  for await (const part of result.fullStream) {
    const type = (part as any).type;
    
    // Log ALL chunks to see what's coming through
    console.log(`[${type}]`, JSON.stringify(part).slice(0, 200));
    
    if (type === 'text-delta') {
      const delta = (part as any).text || (part as any).textDelta || '';
      text += delta;
    } else if (type === 'reasoning' || type === 'reasoning-delta') {
      const delta = (part as any).text || (part as any).textDelta || '';
      reasoning += delta;
    }
  }
  
  console.log('\n\n========== RESULTS ==========');
  console.log('\n--- NORMAL TEXT ---');
  console.log(text);
  console.log('\n--- REASONING ---');
  console.log(reasoning || '(none)');
  console.log('\n--- USAGE ---');
  console.log(await result.usage);
}

// Run test
async function main() {
  console.log('Starting xAI SDK test...\n');
  console.log('XAI_API_KEY set:', !!process.env.XAI_API_KEY);
  
  try {
    await testXaiStream();
  } catch (e) {
    console.error('Test failed:', e);
  }
  
  console.log('\n\n========== TEST COMPLETE ==========');
}

main().catch(console.error);

