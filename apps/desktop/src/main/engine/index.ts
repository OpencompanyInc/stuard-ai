import * as fs from 'fs';
import * as path from 'path';
import { EngineContext, StuardSpec, StuardStep, StuardEdge, LoopConfig, StreamWireConfig } from './types';
import { emitStepEvent, emitFlowEvent, emitStreamEvent } from './events';
import { safeStuardId, summarizeOutput, interpolateForTool, getAtPath, evalIfGuard, pathResolveOptions } from './utils';
import { execTool, getToolKind, execLocalTool, getVariable } from '../tool-router';
import { executeStep } from './execution';
import { executeLoop as coreExecuteLoop } from '@stuardai/workflow-core/runtime';

export * from './types';
export * from './events';

const activeRunControllers = new Map<string, Set<AbortController>>();

// Convergence tracking for waitForAll nodes
interface ConvergenceState {
  pendingBranches: Map<string, Set<string>>; // stepId -> set of pending source branch IDs
  completedBranches: Map<string, Map<string, any>>; // stepId -> map of (branchId -> result)
  resolvers: Map<string, () => void>; // stepId -> resolver function for waiting
}

function getRunSet(flowId: string): Set<AbortController> {
  const safe = safeStuardId(flowId);
  let set = activeRunControllers.get(safe);
  if (!set) {
    set = new Set<AbortController>();
    activeRunControllers.set(safe, set);
  }
  return set;
}

export function isStuardEngineRunning(flowId: string): boolean {
  try {
    const safe = safeStuardId(flowId);
    const set = activeRunControllers.get(safe);
    return !!set && set.size > 0;
  } catch {
    return false;
  }
}

export function stopStuardEngineRuns(flowId: string): { ok: boolean; stopped?: number; error?: string } {
  try {
    const safe = safeStuardId(flowId);
    const set = activeRunControllers.get(safe);
    if (!set || set.size === 0) return { ok: false, error: 'not_running' };
    const controllers = Array.from(set.values());
    for (const c of controllers) {
      try { c.abort(); } catch { }
    }
    return { ok: true, stopped: controllers.length };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || 'failed') };
  }
}

function pickStartStep(spec: StuardSpec): StuardStep | null {
  const steps = Array.isArray(spec.steps) ? spec.steps : [];
  if (!steps.length) return null;
  if (spec.start) return steps.find(s => s.id === spec.start) || steps[0];
  return steps[0];
}

export function getStuardPathById(id: string, dir: string) {
  return path.join(dir, `${id}.json`);
}

export async function runStuardEngine(id: string, payload: any, engineCtx: EngineContext) {
  const safe = safeStuardId(id);
  const p = getStuardPathById(safe, engineCtx.stuardsDir);

  if (!fs.existsSync(p)) throw new Error('not_found');

  const spec: StuardSpec = JSON.parse(fs.readFileSync(p, 'utf-8'));
  engineCtx.logFn('Run started');

  const controller = new AbortController();
  const runSet = getRunSet(safe);
  runSet.add(controller);

  const steps = Array.isArray(spec.steps) ? spec.steps : [];
  const map = new Map<string, StuardStep>();
  for (const s of steps) map.set(s.id, s);

  let current = pickStartStep(spec);
  const ctx: any = {};
  let hasReturn = false;
  let returnValue: any = undefined;

  const varsProxy: any = new Proxy({}, {
    get(_t, prop: any) {
      if (typeof prop !== 'string') return undefined;
      const direct = getVariable(prop, undefined, safe);
      if (direct !== undefined) return direct;
      const wf = getVariable(`workflow.${prop}`, undefined, safe);
      return wf;
    },
  });

  const workflowProxy: any = new Proxy({}, {
    get(_t, prop: any) {
      if (typeof prop !== 'string') return undefined;
      return getVariable(`workflow.${prop}`, undefined, safe);
    },
  });

  // Make workflow variables accessible in both styles:
  // - workflow.foo
  // - $vars.foo (auto-falls back to workflow.foo)
  ctx.workflow = workflowProxy;
  ctx.$vars = varsProxy;
  // Stash the flow id so deeper resolvers (engine/utils.ts getAtPath) can scope
  // variable lookups even when they don't have direct access to `safe`.
  ctx.$flowId = safe;

  // Inject $workspace context for workspace-based workflows
  // Lazy require to avoid circular dependency (engine <-> workflows)
  try {
    const { getWorkspaceDir } = require('../workflows/workflows');
    const wsDir = getWorkspaceDir(safe);
    if (wsDir) {
      ctx.$workspace = {
        path: wsDir.replace(/\\/g, '/'),
        data: (wsDir + '/data').replace(/\\/g, '/'),
        scripts: (wsDir + '/scripts').replace(/\\/g, '/'),
        assets: (wsDir + '/assets').replace(/\\/g, '/'),
        id: safe,
      };
      engineCtx.logFn(`Workspace: ${wsDir}`);
    }
  } catch { }

  // Initialize payload (webhook, Gmail, Drive, etc.)
  if (payload !== undefined) {
    try {
      if (payload && typeof payload === 'object' && ('input' in payload || 'webhook' in payload || 'args' in payload)) {
        if (payload.input !== undefined) ctx.input = payload.input;
        if (payload.webhook !== undefined) ctx.webhook = payload.webhook;
        if (payload.args !== undefined) ctx.args = payload.args;
      } else {
        // Raw webhook/provider data (Gmail, Drive, etc.) — expose as input, webhook, and args
        ctx.input = payload;
        ctx.webhook = payload;
        ctx.args = payload;
      }
    } catch { }
  }

  // Ensure trigger context is available for templates (fixes {{trigger.data.X}})
  // Also spread payload fields to top level so {{trigger.event}} works alongside {{trigger.data.event}}
  if (!ctx.trigger) {
    const triggerData = ctx.args || ctx.input || {};
    ctx.trigger = {
      data: triggerData,
      ...(triggerData && typeof triggerData === 'object' ? triggerData : {}),
    };
  }

  // Build incoming edges map for convergence detection
  const incomingEdges = new Map<string, string[]>();
  for (const step of steps) {
    for (const edge of step.next || []) {
      if (edge.to) {
        const existing = incomingEdges.get(edge.to) || [];
        existing.push(step.id);
        incomingEdges.set(edge.to, existing);
      }
    }
  }

  // Convergence state for waitForAll nodes
  const convergence: ConvergenceState = {
    pendingBranches: new Map(),
    completedBranches: new Map(),
    resolvers: new Map(),
  };

  // Initialize convergence tracking for waitForAll nodes
  for (const step of steps) {
    if (step.waitForAll) {
      const sources = incomingEdges.get(step.id) || [];
      if (sources.length > 1) {
        convergence.pendingBranches.set(step.id, new Set(sources));
        convergence.completedBranches.set(step.id, new Map());
        engineCtx.logFn(`[${step.id}] WaitForAll: expecting ${sources.length} branches: ${sources.join(', ')}`);
      }
    }
  }

  // Track stream consumer promises so we wait for them before emitting flow-done
  const streamConsumerPromises: Promise<void>[] = [];

  // Emit flow started
  emitFlowEvent(safe, true);

  // Helper to check and handle convergence for a step
  async function handleConvergence(stepId: string, branchSourceId: string, branchCtx: any): Promise<boolean> {
    const step = map.get(stepId);
    if (!step?.waitForAll) return true; // Not a waitForAll node, proceed immediately

    const pending = convergence.pendingBranches.get(stepId);
    const completed = convergence.completedBranches.get(stepId);

    if (!pending || !completed) return true; // No convergence tracking, proceed

    // Mark this branch as completed
    pending.delete(branchSourceId);
    completed.set(branchSourceId, { ...branchCtx });

    engineCtx.logFn(`[${stepId}] WaitForAll: branch '${branchSourceId}' arrived (${pending.size} remaining)`);

    // Check if all branches have arrived
    if (pending.size === 0) {
      engineCtx.logFn(`[${stepId}] WaitForAll: all branches arrived, proceeding`);

      // Merge all branch contexts
      for (const [, branchResult] of completed) {
        Object.assign(branchCtx, branchResult);
      }

      // Wake up any waiting resolver
      const resolver = convergence.resolvers.get(stepId);
      if (resolver) {
        resolver();
        convergence.resolvers.delete(stepId);
      }

      return true; // Proceed with execution
    }

    return false; // Still waiting for other branches
  }

  // Helper to run a single branch from a starting step
  async function runBranch(startStep: StuardStep, branchCtx: any, prevId?: string): Promise<void> {
    let current: StuardStep | undefined = startStep;
    let prevStepId = prevId;
    let guard = 0;

    while (current && guard < 500) {
      guard++;

      if (controller.signal.aborted) break;

      // Check convergence for waitForAll nodes
      if (current.waitForAll && prevStepId) {
        const shouldProceed = await handleConvergence(current.id, prevStepId, branchCtx);
        if (!shouldProceed) {
          engineCtx.logFn(`[${current.id}] WaitForAll: branch '${prevStepId}' waiting for others`);
          // This branch is done - it merged its context into the convergence point
          // Another branch (the last one) will continue from here
          return;
        }
      }

      const stepTool = current.tool || 'unknown';
      engineCtx.logFn(`[${current.id}] Starting (tool: ${stepTool})`);

      emitStepEvent(safe, current.id, 'running', { wireFromId: prevStepId });

      const startTime = Date.now();
      const out = await executeStep(spec, current, branchCtx, engineCtx);
      const duration = Date.now() - startTime;

      if (controller.signal.aborted) break;

      if (!out.ok) {
        emitStepEvent(safe, current.id, 'error', { error: out.error });
        engineCtx.logFn(`[${current.id}] ❌ Failed (${duration}ms): ${out.error || 'unknown error'}`);
        break;
      }

      const outputSummary = summarizeOutput(out.ctx?.[current.id]);
      engineCtx.logFn(`[${current.id}] ✓ Completed (${duration}ms)${outputSummary ? ': ' + outputSummary : ''}`);
      emitStepEvent(safe, current.id, 'completed', { result: out.ctx?.[current.id] });
      prevStepId = current.id;

      if (out.ctx && (out.ctx as any).__terminated) {
        if ((out.ctx as any).__return !== undefined && !hasReturn) {
          hasReturn = true;
          returnValue = (out.ctx as any).__return;
        }
        try { controller.abort(); } catch { }
        break;
      }

      // ── NEW: Edge-based routing using out.edges ──
      // Split edges into stream (parallel, non-blocking) and flow (sequential/parallel blocking)
      const streamEdges = (out.edges || []).filter(e => e.stream);
      const flowEdges = (out.edges || []).filter(e => !e.stream);

      // 1. Spawn stream consumers for all stream edges (non-blocking)
      for (const streamEdge of streamEdges) {
        const consumerStep = map.get(streamEdge.to);
        if (!consumerStep) {
          engineCtx.logFn(`[${current.id}] ⚠️ Stream edge target not found: ${streamEdge.to}`);
          continue;
        }

        const streamCfg = streamEdge.stream!;
        const sourceField = streamCfg.sourceField || 'streamId';
        const streamId = branchCtx[current.id]?.[sourceField] || branchCtx[current.id];

        if (streamId && typeof streamId === 'string') {
          engineCtx.logFn(`[${current.id}] 📡 Stream wire to ${streamEdge.to} (streamId: ${streamId})`);
          // Spawn async consumer loop — does not block main branch but is tracked for completion
          const consumerPromise = runStreamConsumer(consumerStep, branchCtx, streamId, streamCfg, current.id).catch(err => {
            engineCtx.logFn(`[${streamEdge.to}] ❌ Stream consumer error: ${err}`);
          });
          streamConsumerPromises.push(consumerPromise);
        } else {
          engineCtx.logFn(`[${current.id}] ⚠️ Stream wire to ${streamEdge.to} but no streamId found in output.${sourceField}`);
        }
      }

      // 2. Process flow edges
      if (flowEdges.length === 0) {
        // No flow edges — end of this branch (stream consumers may still be running)
        engineCtx.logFn(`[${current.id}] End of flow (no flow edges)`);
        break;
      }

      if (flowEdges.length === 1) {
        // Single flow edge — check for loop vs regular
        const edge = flowEdges[0];
        const next = map.get(edge.to);
        
        if (!next) {
          engineCtx.logFn(`Next step not found: ${edge.to}`);
          break;
        }

        // Handle loop execution if edge has loop configuration
        if (edge.loop && edge.loop.type) {
          const loopResult = await executeLoop(spec, next, branchCtx, edge.loop, engineCtx, map, current.id);
          
          // After loop completes, continue to the break edge target (or end)
          if (loopResult.breakEdge && loopResult.breakEdge.to) {
            engineCtx.logFn(`[${next.id}] 🔄 Loop done → continuing to: ${loopResult.breakEdge.to}`);
            current = map.get(loopResult.breakEdge.to);
          } else {
            engineCtx.logFn(`[${next.id}] 🔄 Loop done → end of flow`);
            current = undefined;
          }
          if (!current) break;
          continue;
        }

        // Regular single edge — continue to next step
        engineCtx.logFn(`[${current.id}] → Next: ${edge.to}`);
        current = next;
        continue;
      }

      // Multiple flow edges — check for loop edge precedence, otherwise run parallel
      const loopEdge = flowEdges.find(e => e.loop?.type);
      if (loopEdge) {
        // Loop edge takes precedence
        const next = map.get(loopEdge.to);
        if (!next) {
          engineCtx.logFn(`Loop target step not found: ${loopEdge.to}`);
          break;
        }

        const loopResult = await executeLoop(spec, next, branchCtx, loopEdge.loop!, engineCtx, map, current.id);
        
        if (loopResult.breakEdge && loopResult.breakEdge.to) {
          engineCtx.logFn(`[${next.id}] 🔄 Loop done → continuing to: ${loopResult.breakEdge.to}`);
          current = map.get(loopResult.breakEdge.to);
        } else {
          engineCtx.logFn(`[${next.id}] 🔄 Loop done → end of flow`);
          current = undefined;
        }
        if (!current) break;
        continue;
      }

      // Multiple regular flow edges — run parallel branches
      engineCtx.logFn(`[${current.id}] ⚡ Executing ${flowEdges.length} parallel branches`);
      const parallelSteps = flowEdges.map(e => map.get(e.to)).filter(Boolean) as StuardStep[];

      // Run all parallel branches concurrently
      await Promise.all(parallelSteps.map(step =>
        runBranch(step, { ...branchCtx }, current!.id)
      ));
      break; // All branches handled
    }
  }

  // Run a reactive stream consumer — polls stream and executes consumer step for each chunk
  // Chunk data is injected into ctx[sourceStepId] so consumer can use:
  //   {{sourceStepId.text}}       — chunk content (string)
  //   {{sourceStepId.chunk}}      — alias for chunk content
  //   {{sourceStepId.chunkIndex}} — 0-based index of this chunk
  async function runStreamConsumer(
    consumerStep: StuardStep,
    baseCtx: any,
    streamId: string,
    _streamCfg: StreamWireConfig,
    sourceStepId: string
  ): Promise<void> {
    // Use long server-side blocking reads to minimize latency.
    // The Python agent's stream_read will block up to waitMs waiting for data,
    // so chunks are delivered as soon as they arrive without wasteful polling.
    const serverWaitMs = 2000;   // Server blocks up to 2s waiting for data
    const maxIdleMs = 30000;
    
    // Subscribe to the stream
    const subResult = await execLocalTool('stream_subscribe', {
      streamId,
      label: `consumer:${consumerStep.id}`,
      fromStart: false,
    }, engineCtx);
    
    if (!subResult?.ok || !subResult?.subscriberId) {
      engineCtx.logFn(`[${consumerStep.id}] 📡 Failed to subscribe to stream ${streamId}`);
      return;
    }
    
    const subscriberId = subResult.subscriberId;
    engineCtx.logFn(`[${consumerStep.id}] 📡 Subscribed to stream (subscriberId: ${subscriberId})`);
    
    // Emit stream active event for UI animation
    emitStreamEvent(safe, sourceStepId, consumerStep.id, true);
    
    // Save original source step output so we can restore after streaming ends
    const originalSourceOutput = baseCtx[sourceStepId];
    
    let lastDataTime = Date.now();
    let chunkIndex = 0;
    let accumulatedText = '';
    const preferLatestOnly = (consumerStep as any).type === 'local.tool' && /^mediapipe_/.test(String((consumerStep as any).tool || ''));
    // Auto-detect optimal stream format based on consumer tool type:
    // - Python tools (mediapipe, run_python_script, etc.) benefit from zero-copy refs
    // - UI tools (custom_ui, browser) need base64 data URLs
    // - User can always override via explicit stream.format on the wire
    const consumerTool = String((consumerStep as any).tool || '');
    const isPythonConsumer = (consumerStep as any).type === 'local.tool' && (
      consumerTool.startsWith('mediapipe_')
    );
    const streamFormat = _streamCfg?.format || (isPythonConsumer ? 'ref' : 'base64');
    
    while (!controller.signal.aborted) {
      // Server-side blocking read: the Python agent polls internally at 20ms
      // intervals and returns as soon as data is available (or after waitMs).
      // This eliminates the ~30 empty round-trips seen in the logs.
      const readResult = await execLocalTool('stream_read', {
        streamId,
        subscriberId,
        maxChunks: preferLatestOnly ? 1 : 10,
        waitMs: serverWaitMs,
        latestOnly: preferLatestOnly,
        format: streamFormat,
      }, engineCtx);
      
      if (!readResult?.ok) {
        if (readResult?.closed) {
          engineCtx.logFn(`[${consumerStep.id}] 📡 Stream closed`);
          break;
        }
        // Brief pause on error before retrying
        await new Promise(r => setTimeout(r, 100));
        continue;
      }
      
      const chunks = readResult.chunks || [];
      
      if (chunks.length > 0) {
        lastDataTime = Date.now();
        
        // ── Real-time optimization: skip to latest frame for video streams ──
        // When multiple chunks are buffered (producer faster than consumer),
        // only process the LAST chunk to stay close to real-time.
        // Without this, a 30fps camera + 3fps consumer = ever-growing lag.
        let chunksToProcess = chunks;
        if (chunks.length > 1) {
          const lastChunk = chunks[chunks.length - 1];
          const lastData = lastChunk?.data !== undefined ? lastChunk.data : lastChunk;
          const isVideoFrame = (typeof lastData === 'string' && lastData.startsWith('data:image/'))
            || (typeof lastData === 'object' && lastData !== null && '__ref' in lastData);
          if (isVideoFrame) {
            const skipped = chunks.length - 1;
            if (skipped > 0) {
              engineCtx.logFn(`[${consumerStep.id}] 📡 Dropping ${skipped} stale frame(s), processing latest`);
            }
            chunksToProcess = [lastChunk];
            chunkIndex += skipped; // Keep index accurate
          }
        }
        
        for (const chunk of chunksToProcess) {
          if (controller.signal.aborted) break;
          
          const chunkData = chunk?.data !== undefined ? chunk.data : chunk;
          const chunkStr = typeof chunkData === 'string' ? chunkData : JSON.stringify(chunkData);
          const chunkFields = chunkData && typeof chunkData === 'object' && !Array.isArray(chunkData) && !('__ref' in (chunkData as any))
            ? chunkData
            : {};
          // Extract chunk-level metadata (e.g. volume from audio streams)
          // These are fields on the chunk object itself, not inside chunk.data
          const chunkMeta: Record<string, any> = {};
          if (chunk && typeof chunk === 'object') {
            for (const key of Object.keys(chunk)) {
              if (key !== 'data' && key !== 'index' && key !== 'timestamp') {
                chunkMeta[key] = (chunk as any)[key];
                // Also expose volumePercent alias for volume field
                if (key === 'volume') {
                  chunkMeta['volumePercent'] = (chunk as any)[key];
                }
              }
            }
          }
          accumulatedText += chunkStr;
          
          // Override source step's output in ctx so {{sourceStepId.text}} resolves to chunk
          // This is the key UX improvement — consumers just use {{sourceStep.text}}
          baseCtx[sourceStepId] = {
            ...originalSourceOutput,
            ...chunkFields,
            ...chunkMeta,
            text: chunkStr,
            chunk: chunkData,
            chunkIndex,
            fullText: accumulatedText,
            streamId,
          };
          // Also expose as top-level variables for simpler access in Python/templates:
          // {{stream_chunk}}, {{stream_chunk_index}}, {{stream_full_text}}
          baseCtx.stream_chunk = chunkStr;
          baseCtx.stream_chunk_index = chunkIndex;
          baseCtx.stream_full_text = accumulatedText;

          emitStepEvent(safe, consumerStep.id, 'running', { 
            wireFromId: sourceStepId,
          } as any);
          
          const out = await executeStep(spec, consumerStep, baseCtx, engineCtx);
          
          if (!out.ok) {
            engineCtx.logFn(`[${consumerStep.id}] ❌ Chunk ${chunkIndex} failed: ${out.error}`);
          } else {
            emitStepEvent(safe, consumerStep.id, 'completed', { 
              result: out.ctx?.[consumerStep.id],
            } as any);
            
            // ── Continuous flow: follow consumer step's flow edges per-chunk ──
            // This lets downstream steps (e.g. custom_ui) run for every frame
            // in a pipeline like: capture_media →(stream)→ mediapipe →(flow)→ custom_ui
            const downstreamFlowEdges = (out.edges || []).filter(e => !e.stream);
            if (downstreamFlowEdges.length === 1) {
              // Single downstream edge — run inline
              const nextStep = map.get(downstreamFlowEdges[0].to);
              if (nextStep) {
                try {
                  await runBranch(nextStep, baseCtx, consumerStep.id);
                } catch (err) {
                  engineCtx.logFn(`[${consumerStep.id}] ⚠️ Downstream error on chunk ${chunkIndex}: ${err}`);
                }
              }
            } else if (downstreamFlowEdges.length > 1) {
              // Multiple downstream edges — run in parallel so fast side-effects
              // (e.g. set_variable for UI) don't wait for slow processing chains
              await Promise.all(downstreamFlowEdges.map(async (edge) => {
                const nextStep = map.get(edge.to);
                if (nextStep) {
                  try {
                    await runBranch(nextStep, { ...baseCtx }, consumerStep.id);
                  } catch (err) {
                    engineCtx.logFn(`[${consumerStep.id}] ⚠️ Downstream error on chunk ${chunkIndex}: ${err}`);
                  }
                }
              }));
            }
          }
          
          chunkIndex++;
        }
      }
      
      if (readResult.closed) {
        engineCtx.logFn(`[${consumerStep.id}] 📡 Stream closed after ${chunkIndex} chunks`);
        break;
      }
      
      if (Date.now() - lastDataTime > maxIdleMs) {
        engineCtx.logFn(`[${consumerStep.id}] 📡 Stream idle timeout (${maxIdleMs}ms)`);
        break;
      }
      
      // No extra sleep needed — the server-side waitMs handles pacing.
      // If we got data, immediately loop to get more.
      // If we got nothing, the server already waited serverWaitMs before returning.
    }
    
    // Restore source output with final accumulated text
    baseCtx[sourceStepId] = {
      ...originalSourceOutput,
      text: accumulatedText,
      fullText: accumulatedText,
      streamId,
    };
    // Clean up top-level stream variables
    delete baseCtx.stream_chunk;
    delete baseCtx.stream_chunk_index;
    baseCtx.stream_full_text = accumulatedText;
    
    // Emit stream inactive event for UI animation
    emitStreamEvent(safe, sourceStepId, consumerStep.id, false);
    
    // Unsubscribe from stream
    await execLocalTool('stream_unsubscribe', { streamId, subscriberId }, engineCtx).catch(() => {});
    engineCtx.logFn(`[${consumerStep.id}] 📡 Stream consumer finished`);
  }

  // Execute a chain of steps within a loop iteration, stopping at loopBreak edge or loop back edge
  async function executeLoopChain(
    spec: StuardSpec,
    startStep: StuardStep,
    ctx: any,
    engineCtx: EngineContext,
    map: Map<string, StuardStep>,
    loopStartStepId?: string
  ): Promise<{ ok: boolean; error?: string; breakEdge?: { to: string } }> {
    let current: StuardStep | undefined = startStep;
    const visitedInIteration = new Set<string>();
    
    while (current) {
      if (controller.signal.aborted) return { ok: false, error: 'aborted' };
      
      // Prevent infinite loops within a single iteration
      if (visitedInIteration.has(current.id)) {
        engineCtx.logFn(`[${current.id}] 🔄 Iteration complete (back to start)`);
        return { ok: true };
      }
      visitedInIteration.add(current.id);
      
      // Execute current step - this calls decideNext which properly evaluates guards
      const out = await executeStep(spec, current, ctx, engineCtx);
      if (!out.ok) {
        return { ok: false, error: out.error };
      }
      
      // Use the result from executeStep (which uses decideNext) for consistent edge selection
      // No next step - end of loop chain
      if (!out.nextId) {
        // Handle parallel branches emitted from inside the loop body.
        // executeStep puts multi-edge results in nextIds (not nextId), so they'd otherwise
        // be silently dropped. Spawn escape branches (those that don't eventually loop back
        // to loopStartStepId) as detached fire-and-forget tasks — same as top-level parallel.
        const nextIds = (out as any).nextIds as string[] | undefined;
        if (nextIds && nextIds.length > 0) {
          const escapeBranchIds: string[] = [];
          for (const branchId of nextIds) {
            const branchStep = map.get(branchId);
            if (!branchStep) continue;
            // Skip branches that have a loop-back edge pointing to the loop start —
            // those are loop-path nodes and the loop controller already handles re-entry.
            const hasLoopBack = loopStartStepId &&
              branchStep.next?.some(e => e.loop?.type && e.to === loopStartStepId);
            if (!hasLoopBack) escapeBranchIds.push(branchId);
          }
          if (escapeBranchIds.length > 0) {
            engineCtx.logFn(`[${current.id}] ⚡ Spawning ${escapeBranchIds.length} detached branch(es) from loop body`);
            for (const branchId of escapeBranchIds) {
              const branchStep = map.get(branchId);
              if (branchStep) {
                runBranch(branchStep, { ...ctx }, current.id).catch((err: any) => {
                  engineCtx.logFn(`[${branchId}] ❌ Detached branch error in loop: ${err?.message || err}`);
                });
              }
            }
          }
        }
        return { ok: true };
      }
      
      // Check if this edge is a loopBreak (from decideNext result)
      if ((out as any).loopBreak) {
        engineCtx.logFn(`[${current.id}] 🔄 Hit loop break → ${out.nextId}`);
        return { ok: true, breakEdge: { to: out.nextId } };
      }
      
      // Check if this edge has a loop config - indicates end of loop body for this iteration
      // The loop config on the edge means "this is a loop-back edge", not "start a new loop"
      if ((out as any).loop && (out as any).loop.type) {
        engineCtx.logFn(`[${current.id}] 🔄 End of loop body (loop edge detected)`);
        return { ok: true };
      }
      
      // Check if we're going back to the loop start (self-loop or cycle)
      if (loopStartStepId && out.nextId === loopStartStepId) {
        engineCtx.logFn(`[${current.id}] 🔄 End of iteration (back to loop start)`);
        return { ok: true };
      }
      
      // Continue to next step in chain
      const nextStep = map.get(out.nextId);
      if (!nextStep) {
        return { ok: true };
      }
      
      engineCtx.logFn(`[${current.id}] 🔄 → ${nextStep.id} (in loop)`);
      current = nextStep;
    }
    
    return { ok: true };
  }

  // Execute a loop on a step — driver shared with the VM engine via
  // @stuardai/workflow-core (desktop semantics). Desktop keeps its own
  // executeLoopChain closure as the per-iteration body runner, supplies its
  // abort signal + $vars resolver, and emits the completion event via onComplete.
  async function executeLoop(
    spec: StuardSpec,
    step: StuardStep,
    ctx: any,
    loop: LoopConfig,
    engineCtx: EngineContext,
    map: Map<string, StuardStep>,
    prevStepId: string
  ): Promise<{ breakEdge?: { to: string } }> {
    return coreExecuteLoop(step, ctx, loop, map, prevStepId, {
      logFn: engineCtx.logFn,
      isAborted: () => controller.signal.aborted,
      pathOpts: pathResolveOptions,
      runChain: (bodyStep, c) => executeLoopChain(spec, bodyStep, c, engineCtx, map, bodyStep.id),
      onComplete: (stepId, iterations, results) => {
        emitStepEvent(spec.id, stepId, 'completed', { result: { iterations, results } } as any);
      },
    });
  }

  try {
    // Start the main branch
    await runBranch(current!, ctx, undefined);

    // Wait for any stream consumers that were spawned during execution
    if (streamConsumerPromises.length > 0) {
      engineCtx.logFn(`Waiting for ${streamConsumerPromises.length} stream consumer(s) to finish...`);
      await Promise.allSettled(streamConsumerPromises);
    }

    return hasReturn ? { ok: true, returnValue } : { ok: true };
  } finally {
    try {
      const set = activeRunControllers.get(safe);
      if (set) {
        set.delete(controller);
        if (set.size === 0) activeRunControllers.delete(safe);
      }
    } catch { }

    // Emit flow completed
    emitFlowEvent(safe, false);
    engineCtx.logFn(controller.signal.aborted ? 'Run aborted' : 'Run completed');
  }
}

