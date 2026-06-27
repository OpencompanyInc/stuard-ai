import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { anyJsonObject } from './schema-utils';
import { getHeadlessAgent } from '../agents/headless-agent';
import { generateWithToolRecovery } from '../routes/proactive-utils';

export const executeAgenticTask = createTool({
  id: 'execute_agentic_task',
  description: 'Spawns a temporary, autonomous agent to perform a multi-step task. Use this for complex, unpredictable UI interactions or goals that require reasoning and tool use (e.g., "Log in and find the invoice").',
  inputSchema: z.object({
    instruction: z.string().describe('The goal or instruction for the agent (e.g., "Find the weekly report and summarize it")'),
    timeoutMs: z.number().default(60000).describe('Maximum time in milliseconds to allow the agent to work'),
    context: anyJsonObject.optional().describe('Any additional context data to pass to the agent'),
    outputSchema: anyJsonObject.optional().describe('Optional JSON schema describing the desired structured output'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    result: z.any().optional(),
    error: z.string().optional(),
    logs: z.array(z.any()).optional(),
  }),
  execute: async (inputData, context) => {
    const { instruction, timeoutMs, context: taskContext, outputSchema  } = inputData;

    // Initialize the headless agent
    const agent = getHeadlessAgent('fast', [], {}); // Default to fast model, no extra integrations for now unless passed
    
    // Construct the prompt
    let prompt = `Task Instruction: ${instruction}`;
    
    if (taskContext) {
      prompt += `\n\nContext Data:\n${JSON.stringify(taskContext, null, 2)}`;
    }
    
    if (outputSchema) {
      prompt += `\n\nCRITICAL: You must return the final result as a valid JSON object matching this schema:\n${JSON.stringify(outputSchema, null, 2)}\n\nRespond ONLY with the JSON object.`;
    }

    try {
      // Create a timeout promise
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Agent execution timed out')), timeoutMs);
      });

      // Run the agent
      const runPromise = generateWithToolRecovery({
        agent: agent as any,
        baseMessages: [
          { role: 'user', content: prompt }
        ],
        maxSteps: 20,
        maxRetries: 3,
      });

      // Race against timeout
      const response: any = await Promise.race([runPromise, timeoutPromise]);
      
      const text = response?.text || '';
      
      let result = text;
      
      // If schema was requested, try to parse JSON
      if (outputSchema) {
        try {
          // Basic JSON extraction if mixed with text
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            result = JSON.parse(jsonMatch[0]);
          } else {
            result = JSON.parse(text);
          }
        } catch (e) {
          // Fallback: return text but indicate parsing failed
          return {
            ok: false,
            error: 'Failed to parse structured output from agent response',
            result: text,
          };
        }
      }

      return {
        ok: true,
        result: result,
      };

    } catch (error: any) {
      return {
        ok: false,
        error: error.message || 'Agent execution failed',
      };
    }
  },
});



