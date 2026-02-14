import { useEffect, useState } from "react";
import type { ExecutionState } from "../layout/types";

export function useWorkflowRuntime() {
  const [logs, setLogs] = useState<Array<{ ts: string; msg: string }>>([]);
  const [executionState, setExecutionState] = useState<ExecutionState | null>(null);
  const [runningIds, setRunningIds] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const unsub = (window as any).desktopAPI?.onWorkflowsLog?.((d: any) => {
      setLogs((prev) => [...prev.slice(-100), { ts: new Date().toISOString(), msg: String(d?.message || "") }]);
    });

    return () => {
      try {
        unsub?.();
      } catch {
        // no-op
      }
    };
  }, []);

  useEffect(() => {
    const unsubStep = (window as any).desktopAPI?.onWorkflowsStep?.((d: any) => {
      const { flowId, stepId, status, wireFromId } = d || {};
      if (!flowId || !stepId) return;

      setExecutionState((prev) => {
        if (!prev) return prev;

        if (prev.flowId !== flowId) {
          return {
            flowId,
            isRunning: true,
            stepStates: { [stepId]: status },
            activeWireFrom: wireFromId,
            activeWireTo: status === "running" ? stepId : undefined,
          };
        }

        return {
          ...prev,
          stepStates: { ...prev.stepStates, [stepId]: status },
          activeWireFrom: status === "running" ? wireFromId : prev.activeWireFrom,
          activeWireTo: status === "running" ? stepId : prev.activeWireTo,
        };
      });
    });

    const unsubExec = (window as any).desktopAPI?.onWorkflowsExecution?.((d: any) => {
      const { flowId, isRunning } = d || {};
      if (!flowId) return;

      if (isRunning) {
        setExecutionState({
          flowId,
          isRunning: true,
          stepStates: {},
          activeStreams: new Set(),
        });
        setRunningIds((prev) => ({ ...prev, [flowId]: true }));
        return;
      }

      setExecutionState((prev) => {
        if (!prev || prev.flowId !== flowId) return prev;
        return { ...prev, isRunning: false, activeStreams: new Set() };
      });

      setTimeout(() => {
        setExecutionState((prev) => {
          if (prev?.flowId === flowId) return null;
          return prev;
        });
      }, 1500);

      setRunningIds((prev) => ({ ...prev, [flowId]: false }));
    });

    const unsubStream = (window as any).desktopAPI?.onWorkflowsStream?.((d: any) => {
      const { flowId, sourceStepId, consumerStepId, isActive } = d || {};
      if (!flowId || !sourceStepId || !consumerStepId) return;

      const streamKey = `${sourceStepId}->${consumerStepId}`;
      setExecutionState((prev) => {
        if (!prev || prev.flowId !== flowId) return prev;
        if (isActive && !prev.isRunning) return prev;

        const activeStreams = new Set(prev.activeStreams || []);
        if (isActive) activeStreams.add(streamKey);
        else activeStreams.delete(streamKey);

        return { ...prev, activeStreams };
      });
    });

    return () => {
      try {
        unsubStep?.();
      } catch {
        // no-op
      }
      try {
        unsubExec?.();
      } catch {
        // no-op
      }
      try {
        unsubStream?.();
      } catch {
        // no-op
      }
    };
  }, []);

  return {
    logs,
    setLogs,
    executionState,
    setExecutionState,
    runningIds,
    setRunningIds,
  };
}
