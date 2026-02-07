import { BrowserWindow } from 'electron';

// Emit step execution events to all windows for UI highlighting
export function emitStepEvent(flowId: string, stepId: string, status: 'pending' | 'running' | 'completed' | 'error', opts?: { error?: string; wireFromId?: string; result?: any }) {
  const payload = { flowId, stepId, status, ts: new Date().toISOString(), ...opts };
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      try { win.webContents.send('workflows:step', payload); } catch { }
    }
  } catch { }
}

export function emitFlowEvent(flowId: string, isRunning: boolean) {
  const payload = { flowId, isRunning, ts: new Date().toISOString() };
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      try { win.webContents.send('workflows:execution', payload); } catch { }
    }
  } catch { }
}

// Emit stream wire activity events for UI animation control
export function emitStreamEvent(flowId: string, sourceStepId: string, consumerStepId: string, isActive: boolean) {
  const payload = { flowId, sourceStepId, consumerStepId, isActive, ts: new Date().toISOString() };
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      try { win.webContents.send('workflows:stream', payload); } catch { }
    }
  } catch { }
}
