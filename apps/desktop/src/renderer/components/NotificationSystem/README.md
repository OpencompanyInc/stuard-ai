# Stuard AI Notification System

A custom, highly flexible notification system designed to match the Stuard Overlay UI.

## Features

- **Glassmorphism UI**: Matches the application's premium aesthetic
- **Multiple Positions**: Top-left, top-right, bottom-left, bottom-right
- **Rich Content**: Supports images, icons, and progress bars
- **Interactive**: Support for input fields and action buttons
- **Sounds**: Custom sounds for different notification variants
- **Animations**: Smooth slide-in/out and fade-out animations

## Usage

### 1. Basic Notification
```tsx
import { useNotification } from './components/NotificationSystem';

const MyComponent = () => {
    const { show } = useNotification();

    const handleNotify = () => {
        show({
            title: 'Task Completed',
            message: 'Your workflow has finished successfully.',
            variant: 'success'
        });
    };

    return <button onClick={handleNotify}>Notify</button>;
};
```

### 2. With Input Field
```tsx
show({
    title: 'Rename File',
    message: 'Enter a new name for the file:',
    variant: 'neutral',
    input: {
        placeholder: 'New filename',
        defaultValue: 'untitled.txt',
        submitText: 'Rename',
        onSubmit: (value) => console.log('Renamed to:', value)
    },
    duration: 0 // Keep open until interaction
});
```

### 3. With Actions
```tsx
show({
    title: 'Update Available',
    message: 'A new version of Stuard AI is available.',
    variant: 'info',
    actions: [
        {
            label: 'Update Now',
            onClick: () => startUpdate(),
            variant: 'primary'
        },
        {
            label: 'Later',
            onClick: () => dismiss(),
            variant: 'secondary'
        }
    ]
});
```

### 4. With Image
```tsx
show({
    title: 'Image Generated',
    message: 'Here is your generated asset.',
    image: 'data:image/png;base64,...', // or URL
    variant: 'success'
});
```

## Configuration

The `NotificationProvider` in `App.tsx` accepts global defaults:

```tsx
<NotificationProvider 
    defaultDuration={5000} 
    defaultPosition="bottom-left" 
    maxNotifications={5}
>
    {/* App Content */}
</NotificationProvider>
```
