/**
 * @stuardai/bots-core — shared bot/proactive logic single-sourced between the
 * desktop engine and the VM agent (and cloud-ai where applicable). Platform
 * concerns (storage, transports, scheduling I/O) are injected by each host.
 */
export * from './bot-memory';
export * from './schedule';
export * from './proactive-tools';
