'use client';

import React, { useState, useEffect } from 'react';
import { listSnapshots, createSnapshot, restoreSnapshot, deleteSnapshot } from '@/lib/cloudApi';

interface Snapshot {
  id: string;
  name: string;
  description?: string;
  status: string;
  size_bytes?: number;
  created_at: string;
}

export function CloudSnapshots() {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const data = await listSnapshots();
      if (data.ok) setSnapshots(data.snapshots || []);
    } catch (e) {
      console.error('Failed to load snapshots:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await createSnapshot(newName.trim());
      setNewName('');
      load();
    } catch (e) {
      console.error('Failed to create snapshot:', e);
    } finally {
      setCreating(false);
    }
  };

  const handleRestore = async (id: string) => {
    if (!confirm('Restore this snapshot? Current VM data will be overwritten.')) return;
    await restoreSnapshot(id);
    load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this snapshot permanently?')) return;
    await deleteSnapshot(id);
    load();
  };

  const formatSize = (bytes?: number) => {
    if (!bytes) return '—';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  return (
    <div className="space-y-6">
      {/* Create snapshot */}
      <div className="flex gap-3">
        <input
          type="text"
          placeholder="Snapshot name..."
          value={newName}
          onChange={e => setNewName(e.target.value)}
          className="flex-1 px-4 py-2.5 text-sm bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all"
          onKeyDown={e => e.key === 'Enter' && handleCreate()}
        />
        <button
          onClick={handleCreate}
          disabled={creating || !newName.trim()}
          className="px-5 py-2.5 text-sm font-medium bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-all"
        >
          {creating ? 'Creating...' : 'Create Snapshot'}
        </button>
      </div>

      {/* Snapshot list */}
      {loading ? (
        <div className="text-center text-gray-500 py-8">Loading snapshots...</div>
      ) : snapshots.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-2xl border border-gray-200">
          <p className="text-gray-500 text-sm">No snapshots yet.</p>
          <p className="text-gray-400 text-xs mt-1">Create one to save your VM state.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {snapshots.map(snap => (
            <div key={snap.id} className="flex items-center justify-between p-4 bg-white rounded-xl border border-gray-200">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900 text-sm">{snap.name}</span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                    snap.status === 'ready' ? 'bg-green-100 text-green-700' :
                    snap.status === 'creating' ? 'bg-blue-100 text-blue-700 animate-pulse' :
                    snap.status === 'failed' ? 'bg-red-100 text-red-700' :
                    'bg-gray-100 text-gray-600'
                  }`}>
                    {snap.status}
                  </span>
                </div>
                <div className="flex gap-4 mt-1 text-xs text-gray-500">
                  <span>{new Date(snap.created_at).toLocaleString()}</span>
                  <span>{formatSize(snap.size_bytes)}</span>
                </div>
              </div>
              <div className="flex gap-2">
                {snap.status === 'ready' && (
                  <button
                    onClick={() => handleRestore(snap.id)}
                    className="px-3 py-1.5 text-xs font-medium bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-all"
                  >
                    Restore
                  </button>
                )}
                <button
                  onClick={() => handleDelete(snap.id)}
                  className="px-3 py-1.5 text-xs font-medium bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-all"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
