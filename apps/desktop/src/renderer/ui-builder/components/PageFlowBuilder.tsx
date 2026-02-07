/**
 * PageFlowBuilder - Visual flow designer for multi-page Custom UI navigation
 * Design page flows with connections, actions, and conditions
 * Supports draggable nodes, visual connections, and inline page management
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  Plus,
  Trash2,
  ArrowRight,
  Settings,
  Play,
  GitBranch,
  X,
  Check,
  GripVertical,
  MousePointer2,
  ChevronDown,
  Edit3,
  Copy,
  FileText,
} from 'lucide-react';
import type { UIPage, UIPageFlow, PageFlowNode, PageFlowDesign } from '../types';

interface PageFlowBuilderProps {
  pages: Record<string, UIPage>;
  startPage: string;
  flowDesign?: PageFlowDesign;
  onPagesChange: (pages: Record<string, UIPage>, startPage: string) => void;
  onFlowDesignChange?: (flowDesign: PageFlowDesign) => void;
  onEditPage?: (pageId: string) => void;
}

const NODE_WIDTH = 180;
const NODE_HEIGHT = 90;

// Page templates for quick creation
const PAGE_TEMPLATES = [
  { id: 'blank', name: 'Blank', html: '<div class="p-6">\n  <h2 class="text-xl font-bold text-slate-800 mb-4">New Page</h2>\n  <p class="text-slate-600">Page content here.</p>\n</div>' },
  { id: 'form', name: 'Form', html: '<div class="p-6 space-y-4">\n  <h2 class="text-xl font-bold text-slate-800">Form</h2>\n  <div class="space-y-1.5">\n    <label class="text-sm font-medium text-slate-700">Field</label>\n    <input type="text" data-bind="field" class="w-full px-3 py-2 border border-slate-300 rounded-lg" placeholder="Enter value" />\n  </div>\n  <div class="flex gap-3 justify-end pt-4 border-t border-slate-200">\n    <button data-action="cancel" class="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg font-medium">Cancel</button>\n    <button data-action="submit" class="px-4 py-2 bg-indigo-500 text-white rounded-lg font-medium">Submit</button>\n  </div>\n</div>' },
  { id: 'confirm', name: 'Confirm', html: '<div class="p-6 text-center space-y-4">\n  <div class="w-12 h-12 mx-auto rounded-full bg-amber-100 flex items-center justify-center"><svg class="w-6 h-6 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"/></svg></div>\n  <h2 class="text-lg font-bold text-slate-800">Are you sure?</h2>\n  <p class="text-slate-600">This action cannot be undone.</p>\n  <div class="flex gap-3 justify-center pt-2">\n    <button onclick="goBack()" class="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg font-medium">Cancel</button>\n    <button data-action="confirm" class="px-4 py-2 bg-red-500 text-white rounded-lg font-medium">Confirm</button>\n  </div>\n</div>' },
  { id: 'success', name: 'Success', html: '<div class="p-6 text-center space-y-4">\n  <div class="w-16 h-16 mx-auto rounded-full bg-emerald-100 flex items-center justify-center"><svg class="w-8 h-8 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg></div>\n  <h2 class="text-xl font-bold text-slate-800">Success!</h2>\n  <p class="text-slate-600" data-bind="success_message">Operation completed successfully.</p>\n  <button data-action="close" class="px-6 py-2 bg-indigo-500 text-white rounded-lg font-medium">Done</button>\n</div>' },
];

export function PageFlowBuilder({
  pages,
  startPage,
  flowDesign,
  onPagesChange,
  onFlowDesignChange,
  onEditPage,
}: PageFlowBuilderProps) {
  const [nodes, setNodes] = useState<PageFlowNode[]>(flowDesign?.nodes || []);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [showAddPage, setShowAddPage] = useState(false);
  const [newPageName, setNewPageName] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState('blank');
  const [editingPage, setEditingPage] = useState<string | null>(null);
  const [editPageName, setEditPageName] = useState('');
  const [showConnectionInput, setShowConnectionInput] = useState<{ fromId: string; toId: string } | null>(null);
  const [connectionActionName, setConnectionActionName] = useState('next');
  const canvasRef = useRef<HTMLDivElement>(null);

  // Drag state for nodes
  const [draggingNode, setDraggingNode] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  // Sync nodes with pages when pages change externally
  useEffect(() => {
    const pageIds = Object.keys(pages);
    const existingNodeIds = nodes.map(n => n.pageId);
    const newPageIds = pageIds.filter(id => !existingNodeIds.includes(id));

    if (newPageIds.length > 0 || nodes.length !== pageIds.length) {
      const newNodes: PageFlowNode[] = [...nodes];

      newPageIds.forEach((pageId) => {
        const col = newNodes.length % 3;
        const row = Math.floor(newNodes.length / 3);
        newNodes.push({
          id: `node_${pageId}`,
          pageId,
          x: 80 + col * 240,
          y: 80 + row * 160,
          connections: [],
        });
      });

      const validNodes = newNodes.filter(n => pageIds.includes(n.pageId));
      setNodes(validNodes);

      if (onFlowDesignChange) {
        onFlowDesignChange({
          nodes: validNodes,
          startNodeId: validNodes.find(n => n.pageId === startPage)?.id || validNodes[0]?.id || '',
        });
      }
    }
  }, [pages, startPage]);

  // Update flow design when nodes change
  useEffect(() => {
    if (onFlowDesignChange && nodes.length > 0) {
      onFlowDesignChange({
        nodes,
        startNodeId: nodes.find(n => n.pageId === startPage)?.id || nodes[0]?.id || '',
      });
    }
  }, [nodes, startPage, onFlowDesignChange]);

  // ─── Mouse Handlers ────────────────────────────────────────────────────────

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left + canvasRef.current.scrollLeft;
    const y = e.clientY - rect.top + canvasRef.current.scrollTop;
    setMousePos({ x, y });

    // Handle node dragging
    if (draggingNode) {
      e.preventDefault();
      setNodes(prev => prev.map(n =>
        n.id === draggingNode
          ? { ...n, x: Math.max(0, x - dragOffset.x), y: Math.max(0, y - dragOffset.y) }
          : n
      ));
    }
  }, [draggingNode, dragOffset]);

  const handleMouseUp = useCallback(() => {
    if (draggingNode) {
      setDraggingNode(null);
    }
  }, [draggingNode]);

  const handleNodeMouseDown = useCallback((nodeId: string, e: React.MouseEvent) => {
    if (isConnecting) return; // Don't drag while connecting
    e.stopPropagation();
    const node = nodes.find(n => n.id === nodeId);
    if (!node || !canvasRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left + canvasRef.current.scrollLeft;
    const y = e.clientY - rect.top + canvasRef.current.scrollTop;

    setDragOffset({ x: x - node.x, y: y - node.y });
    setDraggingNode(nodeId);
    setSelectedNode(nodeId);
  }, [nodes, isConnecting]);

  const handleNodeClick = (nodeId: string, e: React.MouseEvent) => {
    e.stopPropagation();

    if (isConnecting && connectingFrom) {
      if (connectingFrom !== nodeId) {
        // Show inline connection name input instead of prompt
        setShowConnectionInput({ fromId: connectingFrom, toId: nodeId });
        setConnectionActionName('next');
      }
      setIsConnecting(false);
      setConnectingFrom(null);
    } else {
      setSelectedNode(nodeId);
    }
  };

  const confirmConnection = () => {
    if (!showConnectionInput || !connectionActionName.trim()) return;
    const { fromId, toId } = showConnectionInput;
    setNodes(prev => prev.map(n =>
      n.id === fromId
        ? { ...n, connections: [...n.connections, { action: connectionActionName.trim(), targetNodeId: toId }] }
        : n
    ));
    setShowConnectionInput(null);
    setConnectionActionName('next');
  };

  const handleStartConnection = (nodeId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setIsConnecting(true);
    setConnectingFrom(nodeId);
  };

  const handleDeleteConnection = (nodeId: string, targetNodeId: string) => {
    setNodes(prev => prev.map(n =>
      n.id === nodeId
        ? { ...n, connections: n.connections.filter(c => c.targetNodeId !== targetNodeId) }
        : n
    ));
  };

  const handleDeleteNode = (nodeId: string) => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;

    const newPages = { ...pages };
    delete newPages[node.pageId];
    onPagesChange(newPages, Object.keys(newPages)[0] || '');

    const newNodes = nodes
      .filter(n => n.id !== nodeId)
      .map(n => ({ ...n, connections: n.connections.filter(c => c.targetNodeId !== nodeId) }));
    setNodes(newNodes);
    setSelectedNode(null);
  };

  const addPage = () => {
    if (!newPageName.trim()) return;
    const id = newPageName.trim().toLowerCase().replace(/\s+/g, '-');

    if (pages[id]) {
      alert('A page with this name already exists');
      return;
    }

    const template = PAGE_TEMPLATES.find(t => t.id === selectedTemplate) || PAGE_TEMPLATES[0];
    const newPages = {
      ...pages,
      [id]: { id, name: newPageName.trim(), html: template.html },
    };

    onPagesChange(newPages, startPage || id);
    setNewPageName('');
    setShowAddPage(false);
    setSelectedTemplate('blank');
  };

  const handleSetStartPage = (pageId: string) => {
    onPagesChange(pages, pageId);
  };

  const renamePage = (nodeId: string) => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node || !editPageName.trim()) return;

    const newPages = { ...pages };
    newPages[node.pageId] = { ...newPages[node.pageId], name: editPageName.trim() };
    onPagesChange(newPages, startPage);
    setEditingPage(null);
  };

  const duplicatePage = (nodeId: string) => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;
    const page = pages[node.pageId];
    if (!page) return;

    const newId = `${node.pageId}-copy`;
    const newPages = {
      ...pages,
      [newId]: { ...page, id: newId, name: `${page.name || page.id} (Copy)` },
    };
    onPagesChange(newPages, startPage);
  };

  const getConnectionPath = (from: PageFlowNode, to: PageFlowNode) => {
    const fromX = from.x + NODE_WIDTH;
    const fromY = from.y + NODE_HEIGHT / 2;
    const toX = to.x;
    const toY = to.y + NODE_HEIGHT / 2;

    const dx = Math.abs(toX - fromX);
    const controlOffset = Math.max(dx * 0.4, 50);

    return `M ${fromX} ${fromY} C ${fromX + controlOffset} ${fromY}, ${toX - controlOffset} ${toY}, ${toX} ${toY}`;
  };

  // Calculate canvas size based on node positions
  const canvasMinWidth = Math.max(800, ...nodes.map(n => n.x + NODE_WIDTH + 100));
  const canvasMinHeight = Math.max(600, ...nodes.map(n => n.y + NODE_HEIGHT + 100));

  return (
    <div className="flex flex-col h-full bg-slate-50">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-white shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
            <GitBranch className="w-4 h-4 text-white" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-800 text-sm">Page Flow</h3>
            <p className="text-[10px] text-slate-500">
              {Object.keys(pages).length} pages • Drag nodes to reposition • Click arrow to connect
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isConnecting ? (
            <button
              onClick={() => { setIsConnecting(false); setConnectingFrom(null); }}
              className="px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            >
              Cancel Connection
            </button>
          ) : (
            <button
              onClick={() => setShowAddPage(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Page
            </button>
          )}
        </div>
      </div>

      {/* Canvas */}
      <div
        ref={canvasRef}
        className={`flex-1 relative overflow-auto ${draggingNode ? 'cursor-grabbing' : 'cursor-default'}`}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={() => {
          if (!draggingNode) {
            setSelectedNode(null);
            setIsConnecting(false);
            setConnectingFrom(null);
          }
        }}
      >
        {/* Grid background */}
        <div
          className="absolute inset-0"
          style={{
            minWidth: canvasMinWidth,
            minHeight: canvasMinHeight,
            backgroundImage: 'radial-gradient(circle, #cbd5e1 1px, transparent 1px)',
            backgroundSize: '24px 24px',
          }}
        />

        <svg
          className="absolute inset-0 pointer-events-none"
          style={{ minWidth: canvasMinWidth, minHeight: canvasMinHeight }}
        >
          {/* Arrow marker */}
          <defs>
            <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
              <polygon points="0 0, 10 3.5, 0 7" fill="#6366f1" />
            </marker>
            <marker id="arrowhead-hover" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
              <polygon points="0 0, 10 3.5, 0 7" fill="#ef4444" />
            </marker>
          </defs>

          {/* Connection lines */}
          {nodes.map((node) =>
            node.connections.map((conn, idx) => {
              const targetNode = nodes.find(n => n.id === conn.targetNodeId);
              if (!targetNode) return null;

              const path = getConnectionPath(node, targetNode);
              const midX = (node.x + NODE_WIDTH + targetNode.x) / 2;
              const midY = (node.y + targetNode.y) / 2 + NODE_HEIGHT / 2;

              return (
                <g key={`${node.id}-${conn.targetNodeId}-${idx}`}>
                  <path d={path} fill="none" stroke="#6366f1" strokeWidth="2" markerEnd="url(#arrowhead)" />
                  {/* Clickable hit area for deletion */}
                  <path
                    d={path}
                    fill="none"
                    stroke="transparent"
                    strokeWidth="16"
                    className="cursor-pointer pointer-events-auto"
                    onClick={(e) => { e.stopPropagation(); handleDeleteConnection(node.id, conn.targetNodeId); }}
                  >
                    <title>Click to remove "{conn.action}" connection</title>
                  </path>
                  {/* Action label */}
                  <foreignObject x={midX - 35} y={midY - 12} width="70" height="24">
                    <div className="flex items-center justify-center">
                      <span className="px-2 py-0.5 bg-white text-[10px] font-semibold text-indigo-600 rounded-full shadow-sm border border-indigo-100 whitespace-nowrap">
                        {conn.action}
                      </span>
                    </div>
                  </foreignObject>
                </g>
              );
            })
          )}

          {/* Connecting line (while creating connection) */}
          {isConnecting && connectingFrom && (() => {
            const fromNode = nodes.find(n => n.id === connectingFrom);
            if (!fromNode) return null;
            return (
              <line
                x1={fromNode.x + NODE_WIDTH}
                y1={fromNode.y + NODE_HEIGHT / 2}
                x2={mousePos.x}
                y2={mousePos.y}
                stroke="#6366f1"
                strokeWidth="2"
                strokeDasharray="6,4"
                className="pointer-events-none"
              />
            );
          })()}
        </svg>

        {/* Nodes */}
        {nodes.map((node) => {
          const page = pages[node.pageId];
          if (!page) return null;

          const isStart = node.pageId === startPage;
          const isSelected = selectedNode === node.id;
          const isConnectingFromThis = connectingFrom === node.id;
          const isDragging = draggingNode === node.id;

          return (
            <div
              key={node.id}
              className={`absolute select-none ${isDragging ? 'z-20' : isSelected ? 'z-10' : 'z-1'}`}
              style={{
                left: node.x,
                top: node.y,
                width: NODE_WIDTH,
                transition: isDragging ? 'none' : 'box-shadow 0.15s',
              }}
              onMouseDown={(e) => handleNodeMouseDown(node.id, e)}
              onClick={(e) => handleNodeClick(node.id, e)}
            >
              <div
                className={`bg-white rounded-xl border-2 transition-all ${
                  isDragging
                    ? 'border-indigo-500 shadow-xl ring-2 ring-indigo-200 scale-[1.02]'
                    : isSelected
                    ? 'border-indigo-500 shadow-lg ring-2 ring-indigo-100'
                    : isConnectingFromThis
                    ? 'border-indigo-400 ring-2 ring-indigo-200 shadow-md'
                    : 'border-slate-200 hover:border-indigo-300 shadow-sm hover:shadow-md'
                }`}
              >
                {/* Header */}
                <div className={`flex items-center gap-2 px-2.5 py-2 border-b rounded-t-xl ${
                  isStart ? 'bg-gradient-to-r from-emerald-50 to-teal-50 border-emerald-100' : 'bg-slate-50 border-slate-100'
                }`}>
                  <GripVertical className="w-3 h-3 text-slate-400 cursor-grab shrink-0" />
                  {isStart && (
                    <span className="px-1.5 py-0.5 bg-emerald-500 text-white text-[8px] font-bold rounded shrink-0">
                      START
                    </span>
                  )}
                  <div className="flex-1 min-w-0">
                    {editingPage === node.id ? (
                      <input
                        type="text"
                        value={editPageName}
                        onChange={(e) => setEditPageName(e.target.value)}
                        onBlur={() => renamePage(node.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') renamePage(node.id);
                          if (e.key === 'Escape') setEditingPage(null);
                        }}
                        className="w-full text-xs font-medium px-1 py-0.5 border border-indigo-300 rounded"
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span
                        className="text-xs font-semibold text-slate-700 truncate block cursor-text"
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          setEditingPage(node.id);
                          setEditPageName(page.name || page.id);
                        }}
                        title="Double-click to rename"
                      >
                        {page.name || page.id}
                      </span>
                    )}
                  </div>
                  {/* Connect button */}
                  <button
                    onClick={(e) => { e.stopPropagation(); handleStartConnection(node.id, e); }}
                    onMouseDown={(e) => e.stopPropagation()}
                    className={`p-1 rounded transition-colors shrink-0 ${
                      isConnectingFromThis
                        ? 'text-indigo-600 bg-indigo-100'
                        : 'text-slate-400 hover:text-indigo-600 hover:bg-indigo-50'
                    }`}
                    title="Create connection to another page"
                  >
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Body */}
                <div className="px-2.5 py-2 space-y-1.5">
                  {/* Actions List */}
                  {node.connections.length > 0 && (
                    <div>
                      <div className="text-[9px] text-slate-400 uppercase font-semibold mb-1">Connections</div>
                      <div className="flex flex-wrap gap-1">
                        {node.connections.map((conn, idx) => {
                          const target = nodes.find(n => n.id === conn.targetNodeId);
                          const targetPage = target ? pages[target.pageId] : null;
                          return (
                            <span
                              key={idx}
                              className="px-1.5 py-0.5 bg-indigo-50 text-indigo-600 text-[9px] rounded flex items-center gap-0.5"
                              title={`${conn.action} → ${targetPage?.name || target?.pageId || '?'}`}
                            >
                              {conn.action} → {(targetPage?.name || target?.pageId || '?').substring(0, 8)}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Quick Actions */}
                  <div className="flex items-center gap-1">
                    <button
                      onClick={(e) => { e.stopPropagation(); onEditPage?.(page.id); }}
                      onMouseDown={(e) => e.stopPropagation()}
                      className="flex-1 px-2 py-1 text-[10px] font-medium text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors flex items-center justify-center gap-1"
                    >
                      <Edit3 className="w-3 h-3" />
                      Edit
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); duplicatePage(node.id); }}
                      onMouseDown={(e) => e.stopPropagation()}
                      className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded transition-colors"
                      title="Duplicate page"
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                    {!isStart && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleSetStartPage(page.id); }}
                        onMouseDown={(e) => e.stopPropagation()}
                        className="p-1 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded transition-colors"
                        title="Set as start page"
                      >
                        <Play className="w-3 h-3" />
                      </button>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Delete page "${page.name || page.id}"?`)) handleDeleteNode(node.id);
                      }}
                      onMouseDown={(e) => e.stopPropagation()}
                      className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                      title="Delete page"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        {/* Empty state */}
        {Object.keys(pages).length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center text-slate-400">
              <FileText className="w-12 h-12 mx-auto mb-3 text-slate-300" />
              <div className="text-sm font-medium mb-1">No pages yet</div>
              <div className="text-xs mb-4">Add pages to create a multi-step UI flow</div>
              <button
                onClick={() => setShowAddPage(true)}
                className="px-4 py-2 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
              >
                <Plus className="w-3.5 h-3.5 inline mr-1" />
                Add First Page
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Add Page Modal */}
      {showAddPage && (
        <div className="absolute inset-0 bg-black/20 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-5 w-80" onClick={(e) => e.stopPropagation()}>
            <h4 className="font-semibold text-slate-800 mb-4">Add New Page</h4>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">Page Name</label>
                <input
                  type="text"
                  value={newPageName}
                  onChange={(e) => setNewPageName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') addPage();
                    if (e.key === 'Escape') setShowAddPage(false);
                  }}
                  placeholder="e.g. settings, confirm, success"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
                  autoFocus
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-600 mb-1.5 block">Template</label>
                <div className="grid grid-cols-2 gap-2">
                  {PAGE_TEMPLATES.map(t => (
                    <button
                      key={t.id}
                      onClick={() => setSelectedTemplate(t.id)}
                      className={`px-3 py-2 text-xs font-medium rounded-lg border transition-all ${
                        selectedTemplate === t.id
                          ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                          : 'border-slate-200 text-slate-600 hover:border-indigo-200'
                      }`}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => { setShowAddPage(false); setNewPageName(''); }}
                className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={addPage}
                disabled={!newPageName.trim()}
                className="px-4 py-1.5 text-sm text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Add Page
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Connection Name Input Modal */}
      {showConnectionInput && (
        <div className="absolute inset-0 bg-black/20 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-5 w-72" onClick={(e) => e.stopPropagation()}>
            <h4 className="font-semibold text-slate-800 mb-1">Name this connection</h4>
            <p className="text-xs text-slate-500 mb-3">
              This action name triggers navigation between pages.
            </p>
            <input
              type="text"
              value={connectionActionName}
              onChange={(e) => setConnectionActionName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmConnection();
                if (e.key === 'Escape') setShowConnectionInput(null);
              }}
              placeholder="e.g. next, submit, cancel"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-200 mb-2"
              autoFocus
            />
            <div className="flex flex-wrap gap-1 mb-3">
              {['next', 'submit', 'cancel', 'confirm', 'back', 'skip'].map(a => (
                <button
                  key={a}
                  onClick={() => setConnectionActionName(a)}
                  className={`px-2 py-0.5 text-[10px] font-mono rounded transition-all ${
                    connectionActionName === a
                      ? 'bg-indigo-100 text-indigo-700'
                      : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowConnectionInput(null)}
                className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={confirmConnection}
                disabled={!connectionActionName.trim()}
                className="px-4 py-1.5 text-sm text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50 transition-colors"
              >
                Connect
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Instructions */}
      {isConnecting && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-indigo-600 text-white text-xs font-medium rounded-lg shadow-lg">
          Click on another page node to create a connection
        </div>
      )}
    </div>
  );
}
