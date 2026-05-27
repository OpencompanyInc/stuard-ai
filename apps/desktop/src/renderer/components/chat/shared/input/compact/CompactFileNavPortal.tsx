import React from 'react';

import { FileNavigator, type ContextItem, type FileNavRef } from '../../../../FileNavigator';
import { CompactOverlayPortal } from './CompactOverlayPortal';

interface CompactFileNavPortalProps {
  placement: 'top' | 'bottom';
  inputBarHeight: number;
  maxHeight: number;
  fileNavRef: React.Ref<FileNavRef>;
  filter: string;
  onSelect: (item: ContextItem) => void;
  onClose: () => void;
  onNavigate: (path: string) => void;
}

/**
 * Compact-mode @-mention file navigator, portaled to document.body and
 * positioned above (or below) the input pill.
 */
export const CompactFileNavPortal: React.FC<CompactFileNavPortalProps> = ({
  placement,
  inputBarHeight,
  maxHeight,
  fileNavRef,
  filter,
  onSelect,
  onClose,
  onNavigate,
}) => {
  return (
    <CompactOverlayPortal
      placement={placement}
      inputBarHeight={inputBarHeight}
    >
      <div style={{ maxHeight }} className="overflow-hidden">
        <FileNavigator
          ref={fileNavRef}
          compact
          onSelect={onSelect}
          onClose={onClose}
          onNavigate={onNavigate}
          filter={filter}
        />
      </div>
    </CompactOverlayPortal>
  );
};

export default CompactFileNavPortal;
