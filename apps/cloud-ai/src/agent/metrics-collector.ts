/**
 * VM Agent — Metrics Collector
 * 
 * Collects CPU/RAM/disk/network metrics from the VM using Node.js os module
 * and /proc filesystem parsing (Linux).
 */

import os from 'os';
import fs from 'fs';

export interface VMMetricsSnapshot {
  cpu_percent: number;
  memory_percent: number;
  memory_used_mb: number;
  memory_total_mb: number;
  disk_percent: number;
  disk_used_gb: number;
  disk_total_gb: number;
  network_rx_bytes: number;
  network_tx_bytes: number;
  timestamp: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// CPU Measurement
// ─────────────────────────────────────────────────────────────────────────────

interface CpuTimes { idle: number; total: number; }

function getCpuTimes(): CpuTimes {
  const cpus = os.cpus();
  let idle = 0, total = 0;
  for (const cpu of cpus) {
    const t = cpu.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total };
}

let prevCpu: CpuTimes | null = null;

function measureCpuPercent(): number {
  const cur = getCpuTimes();
  if (!prevCpu) {
    prevCpu = cur;
    return 0;
  }
  const idleDelta = cur.idle - prevCpu.idle;
  const totalDelta = cur.total - prevCpu.total;
  prevCpu = cur;
  if (totalDelta === 0) return 0;
  return Math.round((1 - idleDelta / totalDelta) * 10000) / 100;
}

// ─────────────────────────────────────────────────────────────────────────────
// Memory
// ─────────────────────────────────────────────────────────────────────────────

function measureMemory(): { percent: number; usedMb: number; totalMb: number } {
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const usedBytes = totalBytes - freeBytes;
  const totalMb = Math.round(totalBytes / (1024 * 1024));
  const usedMb = Math.round(usedBytes / (1024 * 1024));
  const percent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 10000) / 100 : 0;
  return { percent, usedMb, totalMb };
}

// ─────────────────────────────────────────────────────────────────────────────
// Disk (reads /proc/mounts and uses statfs-like approach via df)
// ─────────────────────────────────────────────────────────────────────────────

function measureDisk(): { percent: number; usedGb: number; totalGb: number } {
  try {
    // Use child_process to run df for the root filesystem
    const { execSync } = require('child_process');
    const output = execSync('df -B1 / | tail -1', { encoding: 'utf-8', timeout: 5000 });
    const parts = output.trim().split(/\s+/);
    // df output: Filesystem 1B-blocks Used Available Use% Mounted-on
    if (parts.length >= 5) {
      const totalBytes = parseInt(parts[1], 10) || 0;
      const usedBytes = parseInt(parts[2], 10) || 0;
      const totalGb = Math.round((totalBytes / (1024 ** 3)) * 100) / 100;
      const usedGb = Math.round((usedBytes / (1024 ** 3)) * 100) / 100;
      const percent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 10000) / 100 : 0;
      return { percent, usedGb, totalGb };
    }
  } catch {}
  return { percent: 0, usedGb: 0, totalGb: 0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Network (reads /proc/net/dev on Linux)
// ─────────────────────────────────────────────────────────────────────────────

function measureNetwork(): { rxBytes: number; txBytes: number } {
  try {
    const content = fs.readFileSync('/proc/net/dev', 'utf-8');
    const lines = content.split('\n');
    let rxTotal = 0, txTotal = 0;
    for (const line of lines) {
      // Skip header lines and loopback
      if (line.includes('|') || line.trim().startsWith('lo:')) continue;
      const match = line.match(/^\s*\S+:\s*(\d+)\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+(\d+)/);
      if (match) {
        rxTotal += parseInt(match[1], 10) || 0;
        txTotal += parseInt(match[2], 10) || 0;
      }
    }
    return { rxBytes: rxTotal, txBytes: txTotal };
  } catch {}
  // Fallback: use os.networkInterfaces()
  const ifaces = os.networkInterfaces();
  // os.networkInterfaces() doesn't provide byte counts, return 0
  return { rxBytes: 0, txBytes: 0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export function collectMetrics(): VMMetricsSnapshot {
  const cpu = measureCpuPercent();
  const mem = measureMemory();
  const disk = measureDisk();
  const net = measureNetwork();

  return {
    cpu_percent: cpu,
    memory_percent: mem.percent,
    memory_used_mb: mem.usedMb,
    memory_total_mb: mem.totalMb,
    disk_percent: disk.percent,
    disk_used_gb: disk.usedGb,
    disk_total_gb: disk.totalGb,
    network_rx_bytes: net.rxBytes,
    network_tx_bytes: net.txBytes,
    timestamp: Date.now(),
  };
}

/**
 * Initialize CPU measurement baseline.
 * Call once at startup so the first real measurement has a delta.
 */
export function initMetrics(): void {
  prevCpu = getCpuTimes();
}
