"use client";

import { useEffect, useMemo, useState, useSyncExternalStore, useCallback } from 'react';

interface TocItem {
  id: string;
  text: string;
  level: number;
}

function getHeadingsSnapshot(rootSelector: string): TocItem[] {
  if (typeof document === 'undefined') return [];
  const root = document.querySelector(rootSelector);
  if (!root) return [];
  const headings = Array.from(root.querySelectorAll('h1, h2, h3')) as HTMLHeadingElement[];
  return headings.map((h) => ({
    id: h.id,
    text: h.textContent || '',
    level: Number(h.tagName.substring(1)),
  }));
}

export default function TableOfContents({ rootSelector = '#article-root' }: { rootSelector?: string }) {
  const subscribe = useCallback((callback: () => void) => {
    // Re-check headings after initial render and any mutations
    const timer = setTimeout(callback, 100);
    return () => clearTimeout(timer);
  }, []);
  const getSnapshot = useCallback(() => JSON.stringify(getHeadingsSnapshot(rootSelector)), [rootSelector]);
  const getServerSnapshot = useCallback(() => '[]', []);
  
  const itemsJson = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const items = useMemo<TocItem[]>(() => JSON.parse(itemsJson), [itemsJson]);
  const [activeId, setActiveId] = useState<string>('');

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => (a.target as HTMLElement).offsetTop - (b.target as HTMLElement).offsetTop);
        if (visible[0]) setActiveId((visible[0].target as HTMLElement).id);
      },
      { rootMargin: '0px 0px -70% 0px', threshold: [0, 1] }
    );
    items.forEach((i) => {
      const el = document.getElementById(i.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [items]);

  if (items.length === 0) return null;

  return (
    <nav className="hidden lg:block sticky top-28 max-h-[70vh] overflow-auto p-4 bg-[#111111] rounded-xl border border-white/10">
      <div className="text-sm font-semibold text-white mb-3">On this page</div>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.id} className="truncate">
            <a
              href={`#${item.id}`}
              className={`block text-sm transition-colors hover:text-[#FF6B6E] ${
                activeId === item.id ? 'text-[#FF6B6E]' : 'text-[#A3A3A3]'
              }`}
              style={{ paddingLeft: `${(item.level - 1) * 12}px` }}
            >
              {item.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}




