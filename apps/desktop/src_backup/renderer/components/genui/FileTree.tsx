import React, { useState } from 'react';
import { ChevronRight, Folder, FolderOpen, File, FileCode, FileImage, FileText } from 'lucide-react';
import clsx from 'clsx';

export interface FileNode {
  name: string;
  type: 'file' | 'folder';
  children?: FileNode[];
  path?: string;
}

export interface FileTreeProps {
  nodes: FileNode[];
  title?: string;
  onSelect?: (node: FileNode) => void;
}

const getFileIcon = (name: string) => {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs', 'java', 'cpp', 'c', 'h'].includes(ext)) {
    return FileCode;
  }
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico'].includes(ext)) {
    return FileImage;
  }
  if (['md', 'txt', 'json', 'yaml', 'yml', 'toml', 'xml'].includes(ext)) {
    return FileText;
  }
  return File;
};

interface TreeNodeProps {
  node: FileNode;
  depth: number;
  onSelect?: (node: FileNode) => void;
}

const TreeNode: React.FC<TreeNodeProps> = ({ node, depth, onSelect }) => {
  const [expanded, setExpanded] = useState(depth < 2);
  const isFolder = node.type === 'folder';
  const hasChildren = isFolder && node.children && node.children.length > 0;
  
  const FileIcon = isFolder ? (expanded ? FolderOpen : Folder) : getFileIcon(node.name);

  const handleClick = () => {
    if (isFolder && hasChildren) {
      setExpanded(!expanded);
    }
    onSelect?.(node);
  };

  return (
    <div>
      <button
        onClick={handleClick}
        className={clsx(
          "w-full flex items-center gap-1.5 px-2 py-1 hover:bg-neutral-100 rounded text-left transition-colors group",
          "focus:outline-none focus:ring-1 focus:ring-blue-500/30"
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {isFolder && hasChildren ? (
          <ChevronRight 
            className={clsx(
              "w-3 h-3 text-neutral-400 transition-transform shrink-0",
              expanded && "rotate-90"
            )}
          />
        ) : (
          <span className="w-3" />
        )}
        
        <FileIcon className={clsx(
          "w-4 h-4 shrink-0",
          isFolder ? "text-amber-500" : "text-neutral-400"
        )} />
        
        <span className={clsx(
          "text-xs truncate",
          isFolder ? "text-neutral-800 font-medium" : "text-neutral-600"
        )}>
          {node.name}
        </span>
      </button>
      
      {isFolder && hasChildren && expanded && (
        <div>
          {node.children!.map((child, idx) => (
            <TreeNode 
              key={`${child.name}-${idx}`} 
              node={child} 
              depth={depth + 1}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export const FileTree: React.FC<FileTreeProps> = ({
  nodes,
  title,
  onSelect
}) => {
  return (
    <div className="w-full max-w-md bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden my-3">
      {title && (
        <div className="px-3 py-2 bg-neutral-50 border-b border-neutral-100 flex items-center gap-2">
          <Folder className="w-4 h-4 text-amber-500" />
          <span className="text-xs font-medium text-neutral-700">{title}</span>
        </div>
      )}
      
      <div className="py-2 max-h-[300px] overflow-y-auto custom-scrollbar">
        {nodes.map((node, idx) => (
          <TreeNode 
            key={`${node.name}-${idx}`} 
            node={node} 
            depth={0}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
};


