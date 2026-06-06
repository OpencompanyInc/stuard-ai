// Notification System Types

export type NotificationPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export type NotificationVariant = 'info' | 'success' | 'warning' | 'error' | 'neutral';

export interface NotificationSound {
    /** URL or path to the sound file */
    src: string;
    /** Volume from 0 to 1 */
    volume?: number;
}

export interface NotificationInputConfig {
    /** Placeholder text for the input */
    placeholder?: string;
    /** Initial value */
    defaultValue?: string;
    /** Submit button text */
    submitText?: string;
    /** Cancel button text */
    cancelText?: string;
    /** Input type */
    type?: 'text' | 'password' | 'email' | 'number';
    /** Callback when input is submitted */
    onSubmit?: (value: string) => void;
    /** Callback when input is cancelled */
    onCancel?: () => void;
    /** If true, don't dismiss notification after submit (for multi-turn conversations) */
    keepAfterSubmit?: boolean;
}

export interface NotificationAction {
    /** Button label */
    label: string;
    /** Button action */
    onClick: () => void;
    /** Button variant */
    variant?: 'primary' | 'secondary' | 'danger';
    /** If true, don't dismiss notification when clicked */
    keepNotification?: boolean;
}

export interface NotificationConfig {
    /** Unique identifier */
    id?: string;
    /** Notification title */
    title: string;
    /** Notification message/body */
    message?: string;
    /** Optional structured GenUI payload rendered below the message */
    structuredContent?: {
        toolName: string;
        args: any;
    };
    /** Visual variant */
    variant?: NotificationVariant;
    /** Duration in milliseconds (0 for persistent) */
    duration?: number;
    /** Position on screen */
    position?: NotificationPosition;
    /** Image URL or data URI to display */
    image?: string;
    /** Sound configuration or boolean to use default sound */
    sound?: NotificationSound | boolean;
    /** Input configuration for interactive notifications */
    input?: NotificationInputConfig;
    /** Action buttons */
    actions?: NotificationAction[];
    /** Whether the notification can be dismissed */
    dismissible?: boolean;
    /** Custom icon component */
    icon?: React.ReactNode;
    /** Callback when notification is dismissed */
    onDismiss?: () => void;
    /** Progress value (0-100) for progress notifications */
    progress?: number;
    /** Custom CSS class */
    className?: string;
    /** Orchestrator finished — injects an Open Chat action in the notification overlay */
    orchestratorDone?: boolean;
}

export interface NotificationState extends Required<Pick<NotificationConfig, 'id' | 'title' | 'variant' | 'position' | 'dismissible'>> {
    message?: string;
    structuredContent?: {
        toolName: string;
        args: any;
    };
    image?: string;
    sound?: NotificationSound | boolean;
    input?: NotificationInputConfig;
    actions?: NotificationAction[];
    icon?: React.ReactNode;
    onDismiss?: () => void;
    progress?: number;
    className?: string;
    orchestratorDone?: boolean;
    createdAt: number;
    duration: number;
}

export interface NotificationContextValue {
    notifications: NotificationState[];
    show: (config: NotificationConfig) => string;
    dismiss: (id: string) => void;
    dismissAll: () => void;
    update: (id: string, config: Partial<NotificationConfig>) => void;
}
