// Notification System - Custom UI notifications for Stuard AI
// Matches the Stuard overlay UI theme with glassmorphism effects

export * from './types';
export * from './NotificationProvider';
export { NotificationItem } from './NotificationItem';
export { NotificationController } from './NotificationController';
export * from './sounds';

// Convenience type exports
export type {
    NotificationConfig,
    NotificationPosition,
    NotificationVariant,
    NotificationSound,
    NotificationInputConfig,
    NotificationAction,
    NotificationContextValue,
} from './types';
