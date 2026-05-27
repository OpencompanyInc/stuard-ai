export type ScheduleInterval = '10m' | '15m' | '30m' | '1h' | '2h' | 'random' | 'manual';
export type ExecutionTarget = 'local' | 'cloud';
export type ProactiveModelMode = 'auto' | 'fast' | 'balanced' | 'smart';
export type NotificationChannel = 'app' | 'sms' | 'call';

export const EXECUTION_TARGET_LABELS: Record<ExecutionTarget, { label: string; description: string }> = {
  local: { label: 'Local Agent', description: 'Runs on your machine' },
  cloud: { label: 'Cloud VM', description: 'Runs on your cloud engine' },
};

export const PROACTIVE_MODEL_MODE_LABELS: Record<ProactiveModelMode, { label: string; description: string }> = {
  auto: { label: 'Auto', description: 'Route model automatically' },
  fast: { label: 'Fast', description: 'Lower latency responses' },
  balanced: { label: 'Balanced', description: 'Good speed and quality' },
  smart: { label: 'Smart', description: 'Best reasoning quality' },
};

export const NOTIFICATION_CHANNEL_LABELS: Record<NotificationChannel, { label: string; description: string }> = {
  app: { label: 'In-App', description: 'Desktop notification popup' },
  sms: { label: 'SMS', description: 'Text message to verified phone' },
  call: { label: 'Phone Call', description: 'Voice call with TTS message' },
};

export const SCHEDULE_LABELS: Record<ScheduleInterval, string> = {
  '10m': 'Every 10 minutes',
  '15m': 'Every 15 minutes',
  '30m': 'Every 30 minutes',
  '1h': 'Every hour',
  '2h': 'Every 2 hours',
  random: 'Random check-ins',
  manual: 'Manual only',
};
