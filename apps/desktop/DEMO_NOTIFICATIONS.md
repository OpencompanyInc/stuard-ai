# How to Run the Notification System Demo

The notification system has been fully integrated into the desktop application. Since you are running `npm run dev:stack`, the changes should be live.

## Running the Demo Script

We have exposed a global function `runNotificationDemo()` for testing purposes.

1. **Open the Desktop App** (if not already open).
2. **Open Developer Tools**:
   - Press `Ctrl+Shift+I` (Windows/Linux) or `Cmd+Option+I` (Mac).
   - Or look for "Toggle Developer Tools" in the View menu.
3. **Go to the Console tab**.
4. **Type the following command and press Enter:**
   ```javascript
   window.runNotificationDemo()
   ```

## What you will see:
1. **Success Notification**: "System Online" (with success sound).
2. **Progress Notification**: A simulated file analysis with a real-time progress bar.
3. **Interactive Notification**: A warning dialog asking for permission (Allow/Deny), which triggers follow-up notifications.
4. **Input Notification**: A prompt asking to "Rename Project" with an input field.
5. **Rich Media Notification**: A notification displaying an image.

## Integration Details
The system automatically handles incoming agent events:
- `notification` events are displayed using the new UI.
- `reminder_triggered` events are displayed with a persistent alarm style.
