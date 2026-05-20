import React, { forwardRef } from 'react';
import { createPortal } from 'react-dom';
import { ContextItem, FileNavigator, FileNavRef } from '../../../../FileNavigator';

interface FileNavigatorOverlayProps {
  showFileNav: boolean;
  fileNavOverlay: {
    left: number;
    top: number;
    placement: 'top' | 'bottom';
    width: number;
  } | null;
  fileNavFilter: string;
  onSelect: (item: ContextItem) => void;
  onClose: () => void;
  onNavigate: (path: string) => void;
}

export const FileNavigatorOverlay = forwardRef<FileNavRef, FileNavigatorOverlayProps>(({
  showFileNav,
  fileNavOverlay,
  fileNavFilter,
  onSelect,
  onClose,
  onNavigate,
}, ref) => {
  if (!showFileNav || !fileNavOverlay) return null;

  return createPortal(
    <div
      style={{
        position: 'fixed',
        left: fileNavOverlay.left,
        top: fileNavOverlay.top,
        width: fileNavOverlay.width,
        transform: fileNavOverlay.placement === 'top' ? 'translateY(-100%)' : undefined,
        zIndex: 100000,
      }}
    >
      <FileNavigator
        ref={ref}
        onSelect={onSelect}
        onClose={onClose}
        onNavigate={onNavigate}
        filter={fileNavFilter}
      />
    </div>,
    document.body
  );
});

