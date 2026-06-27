/**
 * Shared icon/color catalog for function nodes published to the marketplace.
 * Used by the publish wizard (MarketplaceModal), the tool palette's "Installed
 * Functions" section, and the canvas node renderer so a downloaded function
 * shows up everywhere with the design its publisher chose.
 */
import {
  Box, Zap, Brain, Database, Mail, Code, Globe, Wand2, Terminal, FileText,
  MessageSquare, Image as ImageIcon, Cloud, Sparkles, type LucideIcon,
} from 'lucide-react';

export interface FunctionNodeIconEntry { id: string; icon: LucideIcon }
export interface FunctionNodeColorEntry {
  id: string;
  /** Solid swatch (used in the publish designer + canvas node header). */
  bg: string;
  border: string;
  fg: string;
  ring: string;
  /** Mapped key into PALETTE_CATEGORIES color buckets so node cards reuse
   *  the existing dark/light category styling instead of inventing one. */
  paletteColorKey: string;
}

export const FUNCTION_NODE_ICONS: FunctionNodeIconEntry[] = [
  { id: 'Box',           icon: Box },
  { id: 'Zap',           icon: Zap },
  { id: 'Brain',         icon: Brain },
  { id: 'Database',      icon: Database },
  { id: 'Mail',          icon: Mail },
  { id: 'Code',          icon: Code },
  { id: 'Globe',         icon: Globe },
  { id: 'Wand2',         icon: Wand2 },
  { id: 'Terminal',      icon: Terminal },
  { id: 'FileText',      icon: FileText },
  { id: 'MessageSquare', icon: MessageSquare },
  { id: 'Image',         icon: ImageIcon },
  { id: 'Cloud',         icon: Cloud },
  { id: 'Sparkles',      icon: Sparkles },
];

export const FUNCTION_NODE_COLORS: FunctionNodeColorEntry[] = [
  { id: 'indigo',  bg: '#6366f1', border: '#a5b4fc', fg: '#eef2ff', ring: 'ring-indigo-300', paletteColorKey: 'indigo'  },
  { id: 'blue',    bg: '#3b82f6', border: '#93c5fd', fg: '#eff6ff', ring: 'ring-blue-300',   paletteColorKey: 'blue'    },
  { id: 'violet',  bg: '#8b5cf6', border: '#c4b5fd', fg: '#f5f3ff', ring: 'ring-violet-300', paletteColorKey: 'violet'  },
  { id: 'emerald', bg: '#10b981', border: '#6ee7b7', fg: '#ecfdf5', ring: 'ring-emerald-300', paletteColorKey: 'emerald' },
  { id: 'amber',   bg: '#f59e0b', border: '#fcd34d', fg: '#fffbeb', ring: 'ring-amber-300',  paletteColorKey: 'amber'   },
  { id: 'rose',    bg: '#f43f5e', border: '#fda4af', fg: '#fff1f2', ring: 'ring-rose-300',   paletteColorKey: 'rose'    },
  { id: 'cyan',    bg: '#06b6d4', border: '#67e8f9', fg: '#ecfeff', ring: 'ring-cyan-300',   paletteColorKey: 'cyan'    },
  { id: 'slate',   bg: '#475569', border: '#94a3b8', fg: '#f8fafc', ring: 'ring-slate-400',  paletteColorKey: 'slate'   },
];

const ICON_BY_ID: Record<string, LucideIcon> = Object.fromEntries(
  FUNCTION_NODE_ICONS.map((entry) => [entry.id, entry.icon])
);
const COLOR_BY_ID: Record<string, FunctionNodeColorEntry> = Object.fromEntries(
  FUNCTION_NODE_COLORS.map((entry) => [entry.id, entry])
);

export function getFunctionNodeIcon(id: string | undefined | null): LucideIcon {
  if (id && ICON_BY_ID[id]) return ICON_BY_ID[id];
  return Box;
}

export function getFunctionNodeColor(id: string | undefined | null): FunctionNodeColorEntry {
  if (id && COLOR_BY_ID[id]) return COLOR_BY_ID[id];
  return COLOR_BY_ID.indigo;
}
