import type React from 'react';

export const FIGMA_ROW_BASE: React.CSSProperties = {
  height: 48,
  padding: '6px 8px',
  background: 'transparent',
  borderRadius: 8,
};
export const FIGMA_ROW_PRIMARY: React.CSSProperties = {
  ...FIGMA_ROW_BASE,
  background: '#262626',
};
export const FIGMA_ROW_WITH_ICON: React.CSSProperties = {
  ...FIGMA_ROW_BASE,
  padding: '6px 8px 6px 6px',
};
export const FIGMA_KBD: React.CSSProperties = {
  padding: '3px 6px',
  color: '#A3A3A3',
};
