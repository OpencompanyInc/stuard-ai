// Notification System - Custom UI notifications for Stuard AI
// Solid card design with colored accent stripes

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
