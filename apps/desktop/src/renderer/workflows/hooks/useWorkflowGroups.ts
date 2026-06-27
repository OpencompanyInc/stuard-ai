/**
 * useWorkflowGroups — editor-only visual node grouping.
 *
 * Groups are stored in a sidecar keyed by workflow id (localStorage) and are
 * NEVER part of DesignerModel. They never reach the engine or the AI: the
 * cloud agent's inspect/modify operate on the unchanged triggers/nodes/wires.
 * Member positions stay in the model; the sidecar only stores membership +
 * name + collapsed state, and self-heals when the model changes underneath it.
 */
import { useCallback, useEffect, useState } from "react";
import type { DesignerModel } from "../types";

export interface NodeGroup {
  id: string;
  name: string;
  memberIds: string[];
  collapsed: boolean;
  color?: string;
}

const storageKey = (workflowId: string) => `wf.groups.${workflowId}`;
const genGroupId = () => `grp_${Math.random().toString(36).slice(2, 8)}`;

function loadGroups(workflowId: string): NodeGroup[] {
  if (!workflowId) return [];
  try {
    const raw = localStorage.getItem(storageKey(workflowId));
    const parsed = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (g): g is NodeGroup =>
        !!g && typeof g.id === "string" && typeof g.name === "string" && Array.isArray(g.memberIds),
    );
  } catch {
    return [];
  }
}

export interface WorkflowGroupsApi {
  groups: NodeGroup[];
  /** Create a group from ≥2 member ids. Returns the new group id (or null). */
  createGroup: (memberIds: string[], name?: string) => string | null;
  ungroup: (groupId: string) => void;
  renameGroup: (groupId: string, name: string) => void;
  setCollapsed: (groupId: string, collapsed: boolean) => void;
  toggleCollapsed: (groupId: string) => void;
  groupOf: (nodeId: string) => NodeGroup | undefined;
}

export function useWorkflowGroups(workflowId: string, model: DesignerModel | null): WorkflowGroupsApi {
  const [groups, setGroups] = useState<NodeGroup[]>(() => loadGroups(workflowId));

  // Reload the sidecar when the active workflow changes.
  useEffect(() => {
    setGroups(loadGroups(workflowId));
  }, [workflowId]);

  // Persist on every change (sidecar is small).
  useEffect(() => {
    if (!workflowId) return;
    try {
      localStorage.setItem(storageKey(workflowId), JSON.stringify(groups));
    } catch {
      /* ignore quota / serialization errors */
    }
  }, [workflowId, groups]);

  // Self-heal against model edits (including AI rebuilds): drop missing members,
  // enforce single membership, and dissolve groups that fall below 2 members.
  useEffect(() => {
    if (!model) return;
    const valid = new Set<string>([
      ...model.triggers.map((t) => t.id),
      ...model.nodes.map((n) => n.id),
    ]);
    setGroups((prev) => {
      const seen = new Set<string>();
      let changed = false;
      const next: NodeGroup[] = [];
      for (const g of prev) {
        const members = g.memberIds.filter((id) => valid.has(id) && !seen.has(id));
        for (const id of members) seen.add(id);
        if (members.length !== g.memberIds.length) changed = true;
        if (members.length < 2) {
          changed = true;
          continue;
        }
        next.push(members.length === g.memberIds.length ? g : { ...g, memberIds: members });
      }
      return changed ? next : prev;
    });
  }, [model]);

  const createGroup = useCallback((memberIds: string[], name?: string) => {
    const ids = Array.from(new Set(memberIds)).filter(Boolean);
    if (ids.length < 2) return null;
    const id = genGroupId();
    setGroups((prev) => {
      // Single membership: strip these ids from any other group first.
      const stripped = prev
        .map((g) => ({ ...g, memberIds: g.memberIds.filter((m) => !ids.includes(m)) }))
        .filter((g) => g.memberIds.length >= 2);
      return [
        ...stripped,
        { id, name: name?.trim() || `Group ${prev.length + 1}`, memberIds: ids, collapsed: false },
      ];
    });
    return id;
  }, []);

  const ungroup = useCallback((groupId: string) => {
    setGroups((prev) => prev.filter((g) => g.id !== groupId));
  }, []);

  const renameGroup = useCallback((groupId: string, name: string) => {
    setGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, name: name.trim() || g.name } : g)));
  }, []);

  const setCollapsed = useCallback((groupId: string, collapsed: boolean) => {
    setGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, collapsed } : g)));
  }, []);

  const toggleCollapsed = useCallback((groupId: string) => {
    setGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, collapsed: !g.collapsed } : g)));
  }, []);

  const groupOf = useCallback(
    (nodeId: string) => groups.find((g) => g.memberIds.includes(nodeId)),
    [groups],
  );

  return { groups, createGroup, ungroup, renameGroup, setCollapsed, toggleCollapsed, groupOf };
}
