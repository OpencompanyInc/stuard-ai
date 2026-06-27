export type WebsiteMediaKind = 'video' | 'image';

export type WebsiteMediaAsset = {
  id: string;
  /** Path under /public, e.g. /media/workflow-demo.mp4 */
  path: string;
  label: string;
  section: string;
  kind: WebsiteMediaKind;
};

/** Canonical list of homepage marketing assets (from section placeholders). */
export const WEBSITE_MEDIA_ASSETS: WebsiteMediaAsset[] = [
  {
    id: 'workflow-demo',
    path: '/media/workflow-demo.mp4',
    label: 'Build demo — chat → workflow → mini-app',
    section: 'Demo (#demo)',
    kind: 'video',
  },
  {
    id: 'toolbelt-browser-form',
    path: '/media/toolbelt/browser-form.mp4',
    label: 'Browser auto-filling a form',
    section: 'Toolbelt',
    kind: 'video',
  },
  {
    id: 'toolbelt-ffmpeg-trim',
    path: '/media/toolbelt/ffmpeg-trim.mp4',
    label: 'ffmpeg trimming a clip',
    section: 'Toolbelt',
    kind: 'video',
  },
  {
    id: 'toolbelt-file-search',
    path: '/media/toolbelt/file-search.mp4',
    label: 'Semantic file search',
    section: 'Toolbelt',
    kind: 'video',
  },
  {
    id: 'toolbelt-gmail-draft',
    path: '/media/toolbelt/gmail-draft.mp4',
    label: 'Gmail draft writing itself',
    section: 'Toolbelt',
    kind: 'video',
  },
  {
    id: 'toolbelt-window-control',
    path: '/media/toolbelt/window-control.mp4',
    label: 'Screen & windows control',
    section: 'Toolbelt',
    kind: 'video',
  },
  {
    id: 'marketplace-grid',
    path: '/media/marketplace-grid.png',
    label: 'Marketplace grid screenshot',
    section: 'Marketplace',
    kind: 'image',
  },
  {
    id: 'ladder-chat-overlay',
    path: '/media/ladder/chat-overlay.png',
    label: 'Overlay mid-task',
    section: 'Ladder',
    kind: 'image',
  },
  {
    id: 'ladder-workflow-builder',
    path: '/media/ladder/workflow-builder.png',
    label: 'Workflow builder canvas',
    section: 'Ladder',
    kind: 'image',
  },
  {
    id: 'ladder-mini-app-panel',
    path: '/media/ladder/mini-app-panel.png',
    label: 'Mini-app panel in workspace',
    section: 'Ladder',
    kind: 'image',
  },
  {
    id: 'ladder-agent-schedule',
    path: '/media/ladder/agent-schedule.png',
    label: 'Agent schedule / kanban',
    section: 'Ladder',
    kind: 'image',
  },
];

export const WEBSITE_VIDEO_ASSETS = WEBSITE_MEDIA_ASSETS.filter((a) => a.kind === 'video');
