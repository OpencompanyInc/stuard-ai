"use client";

import { useEffect, useState } from 'react';

interface ReadingProgressProps {
  targetSelector: string;
}

export default function ReadingProgress({ targetSelector }: ReadingProgressProps) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const handleScroll = () => {
      const el = document.querySelector<HTMLElement>(targetSelector);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
      const total = el.scrollHeight - viewportHeight;
      const distance = Math.min(Math.max(-rect.top, 0), total);
      const pct = total > 0 ? (distance / total) * 100 : 0;
      setProgress(Math.max(0, Math.min(100, pct)));
    };

    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleScroll);
    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleScroll);
    };
  }, [targetSelector]);

  return (
    <div className="fixed top-0 left-0 right-0 z-[60] h-1 bg-transparent">
      <div
        className="h-full bg-gradient-to-r from-primary to-secondary transition-[width] duration-150"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}




