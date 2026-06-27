import { useEffect, useState } from "react";
import type { WorkflowItem } from "../types";
import { getMarketplaceApi, MarketplaceUpdate } from "../../utils/cloud";
import { getValidAccessToken } from "../../auth/authManager";

export function useWorkflows() {
  const [items, setItems] = useState<WorkflowItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [updates, setUpdates] = useState<Record<string, MarketplaceUpdate>>({});

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await (window as any).desktopAPI?.workflowsList?.();
      if (res && res.ok && Array.isArray(res.items)) {
        // Sort by last modified (updatedAt desc), then by name/id
        const sorted = [...res.items].sort((a: WorkflowItem, b: WorkflowItem) => {
          const ta = a.updatedAt ? Date.parse(a.updatedAt) : 0;
          const tb = b.updatedAt ? Date.parse(b.updatedAt) : 0;
          if (tb !== ta) return tb - ta;
          const na = (a.name || a.id || '').toLowerCase();
          const nb = (b.name || b.id || '').toLowerCase();
          return na.localeCompare(nb);
        });
        setItems(sorted);

        // Check for updates
        const toCheck = sorted
          .filter(i => i.marketplaceSlug && i.version)
          .map(i => ({ slug: i.marketplaceSlug!, version: i.version! }));

        if (toCheck.length > 0) {
          try {
            // Best effort token fetch, checkUpdates might work publicly
            const token = await getValidAccessToken().catch(() => null);
            const api = getMarketplaceApi(() => token || null);
            const updateRes = await api.checkUpdates(toCheck);

            if (updateRes.ok && updateRes.updates) {
              const updateMap: Record<string, MarketplaceUpdate> = {};
              for (const u of updateRes.updates) {
                updateMap[u.slug] = u;
              }
              setUpdates(updateMap);
            }
          } catch (e) {
            console.error("Failed to check for updates", e);
          }
        }
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  return { items, loading, refresh, updates };
}
