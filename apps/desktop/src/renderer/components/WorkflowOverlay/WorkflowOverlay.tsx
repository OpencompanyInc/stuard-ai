import React, { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import DOMPurify from 'dompurify';

interface UiSpec {
  uiId: string;
  title: string;
  position: 'center' | 'top-right' | 'bottom-right' | 'bottom-center' | { x: number; y: number };
  width: number;
  height: number;
  frameless: boolean;
  mode: 'html' | 'native';
  content: any;
  css?: string;
  data: any;
}

interface WorkflowOverlayProps { }

export const WorkflowOverlay: React.FC<WorkflowOverlayProps & { isDedicatedWindow?: boolean }> = ({ isDedicatedWindow }) => {
  const [instances, setInstances] = useState<UiSpec[]>([]);

  useEffect(() => {
    console.log('[WorkflowOverlay] Mounted. API available:', !!window.desktopAPI);

    const handleShow = (spec: UiSpec) => {
      console.log('[WorkflowOverlay] Received ui-show:', spec);
      if (!spec) return;
      setInstances((prev) => [...prev.filter((i) => i.uiId !== spec.uiId), spec]);
    };

    const handleUpdate = ({ uiId, data, content }: { uiId: string; data?: any; content?: any }) => {
      console.log('[WorkflowOverlay] Received ui-update:', uiId);
      if (!uiId) return;
      setInstances((prev) =>
        prev.map((inst) => {
          if (inst.uiId !== uiId) return inst;
          return {
            ...inst,
            data: data ? { ...inst.data, ...data } : inst.data,
            content: content !== undefined ? content : inst.content,
          };
        })
      );
    };

    const handleClose = ({ uiId }: { uiId: string }) => {
      if (!uiId) return;
      setInstances((prev) => prev.filter((i) => i.uiId !== uiId));
    };

    const unsubShow = window.desktopAPI?.onStuardsUiShow?.(handleShow);
    const unsubUpdate = window.desktopAPI?.onStuardsUiUpdate?.(handleUpdate);
    const unsubClose = window.desktopAPI?.onStuardsUiClose?.(handleClose);

    return () => {
      if (typeof unsubShow === 'function') unsubShow();
      if (typeof unsubUpdate === 'function') unsubUpdate();
      if (typeof unsubClose === 'function') unsubClose();
    };
  }, []);

  return (
    <>
      {instances.map((inst) => (
        <UiWindow key={inst.uiId} spec={inst} onClose={() => setInstances(prev => prev.filter(i => i.uiId !== inst.uiId))} isDedicatedWindow={isDedicatedWindow} />
      ))}
    </>
  );
};

const UiWindow: React.FC<{ spec: UiSpec; onClose: () => void; isDedicatedWindow?: boolean }> = ({ spec, onClose, isDedicatedWindow }) => {
  const handleEvent = (event: string, payload: any = {}) => {
    window.desktopAPI?.sendStuardsUiEvent?.(spec.uiId, event, payload);
  };

  const close = () => {
    handleEvent('close');
    onClose();
  };

  // Calculate position style
  const getPositionStyle = () => {
    const base: React.CSSProperties = {
      position: 'fixed',
      zIndex: 10000,
      backgroundColor: spec.frameless ? 'transparent' : 'var(--background, #1e1e1e)',
      color: 'var(--foreground, #fff)',
      borderRadius: (spec.frameless || isDedicatedWindow) ? 0 : '8px',
      boxShadow: (spec.frameless && !isDedicatedWindow) ? 'none' : (isDedicatedWindow ? 'none' : '0 4px 20px rgba(0,0,0,0.5)'),
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
    };

    if (isDedicatedWindow) {
      base.top = 0;
      base.left = 0;
      base.right = 0;
      base.bottom = 0;
    } else {
      base.width = spec.width;
      base.height = spec.height;
      base.borderRadius = spec.frameless ? 0 : '8px';

      if (typeof spec.position === 'object' && 'x' in spec.position) {
        base.left = spec.position.x;
        base.top = spec.position.y;
      } else {
        switch (spec.position) {
          case 'top-right':
            base.top = 20;
            base.right = 20;
            break;
          case 'bottom-right':
            base.bottom = 20;
            base.right = 20;
            break;
          case 'bottom-center':
            base.bottom = 20;
            base.left = '50%';
            base.transform = 'translateX(-50%)';
            break;
          case 'center':
          default:
            base.top = '50%';
            base.left = '50%';
            base.transform = 'translate(-50%, -50%)';
            break;
        }
      }
    }
    return base;
  };

  return createPortal(
    <div style={getPositionStyle()} className="ui-window-container">
      {!spec.frameless && (
        <div
          style={{
            padding: '8px 12px',
            background: 'rgba(255,255,255,0.05)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            cursor: 'move',
            userSelect: 'none',
          }}
        >
          <span style={{ fontWeight: 500, fontSize: 14 }}>{spec.title}</span>
          <button
            onClick={close}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'inherit',
              cursor: 'pointer',
              opacity: 0.7,
              fontSize: 16,
            }}
          >
            ×
          </button>
        </div>
      )}
      <div style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
        <div style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
          <UnifiedUiRenderer spec={spec} onEvent={handleEvent} />
        </div>
      </div>
    </div>,
    document.body
  );
};

// File type presets matching the backend
type FileTypePreset = 'all' | 'documents' | 'images' | 'videos' | 'audio' | 'media' | 'code' | 'data';

// Helper to pick files with configurable options
async function pickFileWithOptions(
  options: {
    fileType?: FileTypePreset;
    multiple?: boolean;
    title?: string;
  },
  handleInputChange: (key: string, value: any) => void,
  key: string,
  onEvent: (e: string, p?: any) => void
) {
  if (!window.desktopAPI?.pickFiles) return;
  try {
    const result = await window.desktopAPI.pickFiles({
      type: options.fileType || 'all',
      multiple: options.multiple || false,
      title: options.title,
      includeData: false, // We only need paths for workflow automations
    });
    if (!result?.ok || !result.files?.length) return;
    
    const paths = result.files.map((f: { path: string }) => f.path);
    const value = options.multiple ? paths : paths[0];
    handleInputChange(key, value);
    
    // Emit file selection event for workflow reactions
    onEvent('emit', { event: 'file_selected', key, value, files: result.files });
  } catch {}
}

// Helper to pick folder
async function pickFolderWithOptions(
  options: { title?: string; multiple?: boolean },
  handleInputChange: (key: string, value: any) => void,
  key: string,
  onEvent: (e: string, p?: any) => void
) {
  if (!window.desktopAPI?.pickFolder) return;
  try {
    const result = await window.desktopAPI.pickFolder({
      title: options.title,
      multiple: options.multiple || false,
    });
    if (!result?.ok || !result.folders?.length) return;
    
    const paths = result.folders.map((f: { path: string }) => f.path);
    const value = options.multiple ? paths : paths[0];
    handleInputChange(key, value);
    
    // Emit folder selection event
    onEvent('emit', { event: 'folder_selected', key, value, folders: result.folders });
  } catch {}
}

const UnifiedUiRenderer: React.FC<{
  spec: UiSpec;
  onEvent: (e: string, p?: any) => void;
}> = ({ spec, onEvent }) => {
  const { content, css, data } = spec;

  // Local state for inputs to prevent round-trip lag
  const [localData, setLocalData] = useState<any>({});

  // Sync prop data to local data when it changes
  useEffect(() => {
    setLocalData((prev: any) => ({ ...prev, ...data }));
  }, [data]);

  const handleInputChange = (key: string, value: any) => {
    setLocalData((prev: any) => ({ ...prev, [key]: value }));
    onEvent('emit', { event: 'input', key, value });
  };

  const resolveValue = (val: any) => {
    if (typeof val === 'string' && val.startsWith('$')) {
      const key = val.slice(1);
      if (localData[key] !== undefined) return localData[key];
      if (data[key] !== undefined) return data[key];
      return '';
    }
    return val;
  };

  // Dedicated file-input component renderer
  const renderFileInput = (node: any, idx: number): React.ReactNode => {
    const {
      bind,
      label,
      placeholder,
      buttonText,
      fileType = 'all',
      multiple = false,
      accept, // For folder selection: accept="folder"
      className,
      style,
    } = node;

    const key = bind || `file_${idx}`;
    const currentValue = localData[key] !== undefined ? localData[key] : (data[key] || '');
    const isFolder = accept === 'folder';

    const handleBrowse = async () => {
      if (isFolder) {
        await pickFolderWithOptions({ multiple }, handleInputChange, key, onEvent);
      } else {
        await pickFileWithOptions({ fileType, multiple }, handleInputChange, key, onEvent);
      }
    };

    return (
      <div key={idx} className={className} style={{ display: 'flex', flexDirection: 'column', gap: 4, ...style }}>
        {label && <label style={{ fontSize: 13, opacity: 0.8 }}>{label}</label>}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="text"
            value={Array.isArray(currentValue) ? currentValue.join(', ') : currentValue}
            placeholder={placeholder || (isFolder ? 'Select folder...' : 'Select file...')}
            readOnly
            style={{
              flex: 1,
              padding: '8px 12px',
              borderRadius: 6,
              border: '1px solid rgba(255,255,255,0.1)',
              background: 'rgba(255,255,255,0.05)',
              color: 'inherit',
              fontSize: 14,
            }}
          />
          <button
            type="button"
            onClick={handleBrowse}
            style={{
              padding: '8px 16px',
              borderRadius: 6,
              border: 'none',
              background: 'rgba(255,255,255,0.1)',
              color: 'inherit',
              cursor: 'pointer',
              fontSize: 14,
              whiteSpace: 'nowrap',
            }}
          >
            {buttonText || 'Browse...'}
          </button>
        </div>
      </div>
    );
  };

  const renderNode = (node: any, idx: number): React.ReactNode => {
    if (!node) return null;
    // Allow simple "$key" bindings in text nodes (resolved against data/localData)
    if (typeof node === 'string') return resolveValue(node);
    if (Array.isArray(node)) return node.map((n, i) => renderNode(n, i));

    const { type, children, props = {}, bind, on, className, style, fileType, accept, multiple } = node;

    // Handle dedicated file-input component
    if (type === 'file-input') {
      return renderFileInput(node, idx);
    }

    // Base props for React element
    const elemProps: any = { key: idx, className, style };

    // Data Binding
    if (bind) {
      elemProps.value = localData[bind] !== undefined ? localData[bind] : (data[bind] || '');
      elemProps.onChange = (e: any) => {
        const val = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
        handleInputChange(bind, val);
      };
    }

    // Event Handling (on="click:submit" or on="click:emit:myEvent" or on="click:file:key" etc.)
    if (on) {
      const parts = on.split(':');
      const evtName = parts[0];
      const action = parts[1];
      const payload = parts[2];
      const extra = parts[3]; // For file:videos:video_path format
      
      const reactEvt = `on${evtName.charAt(0).toUpperCase() + evtName.slice(1)}`;
      elemProps[reactEvt] = async (e: any) => {
        if (action === 'submit') {
          if (payload) {
            onEvent('submit', { ...localData, __action: payload });
          } else {
            onEvent('submit', localData);
          }
        } else if (action === 'emit') {
          onEvent('emit', { event: payload || evtName, value: localData });
        } else if (action === 'close') {
          onEvent('close');
        } else if (action === 'file') {
          // Syntax: on="click:file:KEY" or on="click:file:TYPE:KEY"
          // TYPE can be: all, documents, images, videos, audio, media, code, data
          const validTypes = ['all', 'documents', 'images', 'videos', 'audio', 'media', 'code', 'data'];
          let targetKey = payload || bind;
          let targetType: FileTypePreset = (fileType as FileTypePreset) || 'all';
          
          if (payload && validTypes.includes(payload)) {
            targetType = payload as FileTypePreset;
            targetKey = extra || bind;
          }
          
          if (!targetKey) return;
          await pickFileWithOptions(
            { fileType: targetType, multiple: !!multiple },
            handleInputChange,
            targetKey,
            onEvent
          );
        } else if (action === 'folder') {
          // Syntax: on="click:folder:KEY"
          const targetKey = payload || bind;
          if (!targetKey) return;
          await pickFolderWithOptions({ multiple: !!multiple }, handleInputChange, targetKey, onEvent);
        } else if (action === 'image' || action === 'images') {
          // Shorthand for on="click:file:images:KEY"
          const targetKey = payload || bind;
          if (!targetKey) return;
          await pickFileWithOptions(
            { fileType: 'images', multiple: action === 'images' || !!multiple },
            handleInputChange,
            targetKey,
            onEvent
          );
        } else if (action === 'video' || action === 'videos') {
          // Shorthand for on="click:file:videos:KEY"
          const targetKey = payload || bind;
          if (!targetKey) return;
          await pickFileWithOptions(
            { fileType: 'videos', multiple: action === 'videos' || !!multiple },
            handleInputChange,
            targetKey,
            onEvent
          );
        } else if (action === 'audio') {
          // Shorthand for on="click:file:audio:KEY"
          const targetKey = payload || bind;
          if (!targetKey) return;
          await pickFileWithOptions(
            { fileType: 'audio', multiple: !!multiple },
            handleInputChange,
            targetKey,
            onEvent
          );
        }
      };
    }

    // Special handling for specific types
    if (type === 'input' || type === 'textarea') {
      // Ensure value is controlled
      if (!elemProps.value) elemProps.value = '';
    }

    // Recursive rendering
    const renderedChildren = children
      ? (Array.isArray(children)
        ? children.map((child, i) => renderNode(child, i))
        : renderNode(children, 0))
      : null;

    // Allow standard HTML tags
    return React.createElement(type, elemProps, renderedChildren);
  };

  // If content is a string, treat as raw HTML (legacy support or simple text)
  if (typeof content === 'string') {
    return (
      <div className="unified-ui-root">
        {css && <style>{css}</style>}
        <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(content) }} />
      </div>
    );
  }

  return (
    <div className="unified-ui-root">
      {css && <style>{css}</style>}
      {renderNode(content, 0)}
    </div>
  );
};

