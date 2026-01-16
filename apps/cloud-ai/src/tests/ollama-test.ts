/**
 * Test file for Mastra + Ollama local integration
 * 
 * Prerequisites:
 * 1. Install Ollama: https://ollama.com
 * 2. Start Ollama: `ollama serve`
 * 3. Pull a model: `ollama pull llama3.2` or `ollama pull phi3`
 * 4. Install package: `pnpm add ai-sdk-ollama`
 * 
 * Run: npx tsx src/tests/ollama-test.ts
 */

import { ollama } from 'ai-sdk-ollama';
import { generateText, streamText } from 'ai';
import { Agent } from '@mastra/core/agent';
import { z } from 'zod';

// ============================================
// 1. Basic text generation with Ollama
// ============================================
async function testBasicGeneration() {
  console.log('\n=== Test 1: Basic Text Generation ===');
  
  const { text } = await generateText({
    model: ollama('qwen3:0.6b'),
    prompt: 'Write a haiku about coding in TypeScript',
    temperature: 0.7,
  });
  
  console.log('Generated text:', text);
}

// ============================================
// 2. Streaming text with Ollama
// ============================================
async function testStreaming() {
  console.log('\n=== Test 2: Streaming Text ===');
  
  const { textStream } = await streamText({
    model: ollama('qwen3:0.6b'),
    prompt: 'Explain what Mastra is in 2-3 sentences.',
  });
  
  process.stdout.write('Streaming: ');
  for await (const chunk of textStream) {
    process.stdout.write(chunk);
  }
  console.log('\n');
}

// ============================================
// 3. Mastra Agent with Ollama model
// ============================================
async function testMastraAgent() {
  console.log('\n=== Test 3: Mastra Agent with Ollama ===');
  
  const agent = new Agent({
    name: 'ollama-test-agent',
    instructions: 'You are a helpful assistant running locally via Ollama. Be concise.',
    model: ollama('qwen3:0.6b'),
  });
  
  const response = await agent.generate('What is 2 + 2? Answer in one word.');
  console.log('Agent response:', response.text);
}

// ============================================
// 4. Tool calling with Ollama (if model supports it)
// ============================================
async function testToolCalling() {
  console.log('\n=== Test 4: Tool Calling ===');
  
  const agent = new Agent({
    name: 'tool-test-agent',
    instructions: 'You are a helpful assistant. Use tools when needed.',
    model: ollama('qwen3:0.6b'),
    tools: {
      getCurrentTime: {
        description: 'Get the current time',
        parameters: z.object({}),
        execute: async () => {
          return { time: new Date().toISOString() };
        },
      },
      calculate: {
        description: 'Perform a math calculation',
        parameters: z.object({
          expression: z.string().describe('Math expression like "2 + 2"'),
        }),
        execute: async ({ expression }: { expression: string }) => {
          try {
            // Simple safe eval for basic math
            const result = Function(`"use strict"; return (${expression})`)();
            return { result };
          } catch {
            return { error: 'Invalid expression' };
          }
        },
      },
    },
  });
  
  const response = await agent.generate('What is 15 * 7? Use the calculate tool.');
  console.log('Tool response:', response.text);
  if (response.toolCalls?.length) {
    console.log('Tool calls:', JSON.stringify(response.toolCalls, null, 2));
  }
}

// ============================================
// 5. Custom Ollama configuration
// ============================================
async function testCustomConfig() {
  console.log('\n=== Test 5: Custom Ollama Config ===');
  
  // You can customize the Ollama provider
  const { createOllama } = await import('ai-sdk-ollama');
  
  const customOllama = createOllama({
    baseURL: 'http://localhost:11434/api', // Default local URL
    // headers: { 'X-Custom-Header': 'value' }, // Optional custom headers
  });
  
  const { text } = await generateText({
    model: customOllama('phi3'), // Try phi3 if you have it
    prompt: 'Say "Hello from custom Ollama!" and nothing else.',
  });
  
  console.log('Custom config response:', text);
}

// ============================================
// 6. Check available models
// ============================================
async function listLocalModels() {
  console.log('\n=== Available Ollama Models ===');
  
  try {
    const response = await fetch('http://localhost:11434/api/tags');
    const data = await response.json() as { models: Array<{ name: string; size: number }> };
    
    if (data.models?.length) {
      console.log('Installed models:');
      data.models.forEach((m: { name: string; size: number }) => {
        console.log(`  - ${m.name} (${(m.size / 1e9).toFixed(1)}GB)`);
      });
    } else {
      console.log('No models found. Run: ollama pull llama3.2');
    }
  } catch (error) {
    console.log('Could not connect to Ollama. Is it running? Try: ollama serve');
  }
}

// ============================================
// Main runner
// ============================================
async function main() {
  console.log('🦙 Testing Mastra + Ollama Integration\n');
  
  // First check if Ollama is running and what models are available
  await listLocalModels();
  
  try {
    await testBasicGeneration();
  } catch (e) {
    console.error('Basic generation failed:', (e as Error).message);
  }
  
  try {
    await testStreaming();
  } catch (e) {
    console.error('Streaming failed:', (e as Error).message);
  }
  
  try {
    await testMastraAgent();
  } catch (e) {
    console.error('Mastra agent failed:', (e as Error).message);
  }
  
  try {
    await testToolCalling();
  } catch (e) {
    console.error('Tool calling failed:', (e as Error).message);
  }
  
  // Uncomment if you have phi3 installed
  // try {
  //   await testCustomConfig();
  // } catch (e) {
  //   console.error('Custom config failed:', (e as Error).message);
  // }
  
  console.log('\n✅ Tests complete!');
}

main().catch(console.error);
