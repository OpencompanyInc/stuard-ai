/**
 * Canvas Document Tool Handlers
 * 
 * These handlers manage sidebar canvas documents using the same
 * storage as the IPC handlers (canvas-documents.json).
 */

import { app, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { RouterContext } from '../types';

// Canvas document storage path
const canvasDocsPath = (): string => {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'canvas-documents.json');
};

// Load documents from disk
const loadCanvasDocs = (): any[] => {
  try {
    const p = canvasDocsPath();
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf-8'));
    }
  } catch (e) {
    console.warn('[canvas] Failed to load canvas documents:', e);
  }
  return [];
};

// Save documents to disk
const saveCanvasDocs = (docs: any[]): void => {
  try {
    fs.writeFileSync(canvasDocsPath(), JSON.stringify(docs, null, 2), 'utf-8');
  } catch (e) {
    console.warn('[canvas] Failed to save canvas documents:', e);
  }
};

// Get sidebar window for sending updates
const getSidebarWindow = (): BrowserWindow | null => {
  try {
    const { getSidebarWindow: getSidebar } = require('../../windows');
    return getSidebar();
  } catch {
    return null;
  }
};

/**
 * List all canvas documents
 */
export async function execCanvasList(_args: any, _ctx: RouterContext): Promise<any> {
  const documents = loadCanvasDocs();
  return { ok: true, documents };
}

/**
 * Read a canvas document by ID, or the most recent if no ID provided
 */
export async function execCanvasRead(args: any, _ctx: RouterContext): Promise<any> {
  const docId = args?.documentId;
  const docs = loadCanvasDocs();

  if (docId) {
    const doc = docs.find((d: any) => d.id === docId);
    if (!doc) {
      return { ok: false, error: 'Document not found', document: null };
    }
    return { ok: true, document: doc };
  }

  // Return most recent document if no ID specified
  if (docs.length === 0) {
    return { ok: true, document: null };
  }

  // Sort by updatedAt descending and return first
  const sorted = [...docs].sort((a, b) => {
    const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime();
    const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime();
    return bTime - aTime;
  });

  return { ok: true, document: sorted[0] };
}

/**
 * Write to a canvas document (replace, append, or insert content)
 */
export async function execCanvasWrite(args: any, _ctx: RouterContext): Promise<any> {
  const docId = args?.documentId;
  const content = args?.content;
  const title = args?.title;
  const action = args?.action || 'replace';
  const position = args?.position || 0;

  const docs = loadCanvasDocs();
  let doc: any;
  let docIndex: number;

  if (docId) {
    docIndex = docs.findIndex((d: any) => d.id === docId);
    if (docIndex < 0) {
      return { ok: false, error: 'Document not found' };
    }
    doc = docs[docIndex];
  } else {
    // Use most recent document or create new one
    if (docs.length === 0) {
      // Auto-create a document
      const newId = `canvas_${Date.now()}`;
      const now = new Date().toISOString();
      doc = {
        id: newId,
        title: title || 'Untitled',
        content: '',
        createdAt: now,
        updatedAt: now,
      };
      docs.unshift(doc);
      docIndex = 0;
    } else {
      // Sort by updatedAt and use most recent
      const sorted = docs.map((d, i) => ({ doc: d, idx: i })).sort((a, b) => {
        const aTime = new Date(a.doc.updatedAt || a.doc.createdAt || 0).getTime();
        const bTime = new Date(b.doc.updatedAt || b.doc.createdAt || 0).getTime();
        return bTime - aTime;
      });
      docIndex = sorted[0].idx;
      doc = docs[docIndex];
    }
  }

  // Apply content changes
  if (content !== undefined && content !== null) {
    const currentContent = doc.content || '';
    if (action === 'replace') {
      doc.content = content;
    } else if (action === 'append') {
      doc.content = currentContent + content;
    } else if (action === 'insert') {
      const pos = Math.max(0, Math.min(position, currentContent.length));
      doc.content = currentContent.slice(0, pos) + content + currentContent.slice(pos);
    }
  }

  // Update title if provided
  if (title !== undefined && title !== null) {
    doc.title = title;
  }

  doc.updatedAt = new Date().toISOString();
  docs[docIndex] = doc;
  saveCanvasDocs(docs);

  // Notify sidebar to update UI
  const sidebar = getSidebarWindow();
  if (sidebar && !sidebar.isDestroyed()) {
    sidebar.webContents.send('canvas:update', {
      documentId: doc.id,
      content: doc.content,
      title: doc.title,
      action,
      position,
    });
  }

  return { ok: true };
}

/**
 * Create a new canvas document
 */
export async function execCanvasCreate(args: any, _ctx: RouterContext): Promise<any> {
  const title = args?.title || 'Untitled';
  const content = args?.content || '';

  const newId = `canvas_${Date.now()}`;
  const now = new Date().toISOString();

  const doc = {
    id: newId,
    title,
    content,
    createdAt: now,
    updatedAt: now,
  };

  const docs = loadCanvasDocs();
  docs.unshift(doc);
  saveCanvasDocs(docs);

  return { ok: true, documentId: newId };
}

/**
 * Delete a canvas document by ID
 */
export async function execCanvasDelete(args: any, _ctx: RouterContext): Promise<any> {
  const docId = args?.documentId;

  if (!docId) {
    return { ok: false, error: 'documentId is required' };
  }

  const docs = loadCanvasDocs();
  const idx = docs.findIndex((d: any) => d.id === docId);

  if (idx < 0) {
    return { ok: false, error: 'Document not found' };
  }

  docs.splice(idx, 1);
  saveCanvasDocs(docs);

  return { ok: true };
}
