import { z } from 'zod';
import { makeLocalTool } from './shared';

const desktopControlResultSchema = z.object({
  ok: z.boolean().optional(),
  platform: z.string().optional(),
  backend: z.string().optional(),
  error: z.string().optional(),
}).passthrough();

export const describe_desktop_control_capabilities = makeLocalTool(
  'describe_desktop_control_capabilities',
  'Describe which desktop software controls are available on the current laptop/desktop: wallpaper, volume, Bluetooth, brightness, and battery/power. Use this before attempting platform-sensitive desktop control.',
  z.object({}),
  desktopControlResultSchema,
);

export const get_desktop_wallpaper = makeLocalTool(
  'get_desktop_wallpaper',
  'Get the current desktop wallpaper path(s) when the platform exposes them.',
  z.object({}),
  desktopControlResultSchema,
);

export const set_desktop_wallpaper = makeLocalTool(
  'set_desktop_wallpaper',
  'Set the desktop wallpaper from a local image path. Cross-platform: Windows native API, macOS System Events, Linux desktop-environment CLIs when available.',
  z.object({
    path: z.string().optional().describe('Local image path to set as wallpaper.'),
    imagePath: z.string().optional().describe('Alias for path.'),
    filePath: z.string().optional().describe('Alias for path.'),
    style: z.enum(['fill', 'fit', 'stretch', 'center', 'tile', 'span']).optional().describe('Wallpaper display style where supported.'),
  }),
  desktopControlResultSchema,
);

export const get_system_volume = makeLocalTool(
  'get_system_volume',
  'Get current system output volume and mute state.',
  z.object({}),
  desktopControlResultSchema,
);

export const set_system_volume = makeLocalTool(
  'set_system_volume',
  'Set or adjust system output volume and mute state. Pass level/volume/percent for absolute volume, delta for relative change, and muted/mute for mute state.',
  z.object({
    level: z.number().min(0).max(100).optional(),
    volume: z.number().min(0).max(100).optional(),
    percent: z.number().min(0).max(100).optional(),
    delta: z.number().min(-100).max(100).optional(),
    muted: z.boolean().optional(),
    mute: z.boolean().optional(),
  }),
  desktopControlResultSchema,
);

export const list_bluetooth_devices = makeLocalTool(
  'list_bluetooth_devices',
  'List known or paired Bluetooth devices using the best available platform backend. Linux uses bluetoothctl; macOS prefers blueutil; Windows lists paired Bluetooth PnP devices.',
  z.object({}),
  desktopControlResultSchema,
);

const bluetoothTargetSchema = z.object({
  address: z.string().optional().describe('Bluetooth MAC address when known.'),
  id: z.string().optional().describe('Backend-specific device ID.'),
  deviceId: z.string().optional().describe('Alias for id.'),
  mac: z.string().optional().describe('Alias for address.'),
  openSettings: z.boolean().optional().describe('Windows only: open Bluetooth settings when direct connection is unavailable.'),
});

export const connect_bluetooth_device = makeLocalTool(
  'connect_bluetooth_device',
  'Connect a Bluetooth device when the platform backend supports it. Linux requires bluetoothctl; macOS requires blueutil. Windows reports unsupported unless a future backend is installed.',
  bluetoothTargetSchema,
  desktopControlResultSchema,
);

export const disconnect_bluetooth_device = makeLocalTool(
  'disconnect_bluetooth_device',
  'Disconnect a Bluetooth device when the platform backend supports it. Linux requires bluetoothctl; macOS requires blueutil. Windows reports unsupported unless a future backend is installed.',
  bluetoothTargetSchema,
  desktopControlResultSchema,
);

export const get_display_brightness = makeLocalTool(
  'get_display_brightness',
  'Get laptop or display brightness when the OS/backend exposes it.',
  z.object({}),
  desktopControlResultSchema,
);

export const set_display_brightness = makeLocalTool(
  'set_display_brightness',
  'Set laptop or display brightness where supported. Windows uses WMI; Linux uses brightnessctl/sysfs; macOS requires the brightness CLI.',
  z.object({
    percent: z.number().min(0).max(100).optional(),
    brightness: z.number().min(0).max(100).optional(),
  }),
  desktopControlResultSchema,
);

export const get_power_status = makeLocalTool(
  'get_power_status',
  'Get battery and charging status for laptops when available.',
  z.object({}),
  desktopControlResultSchema,
);
