'use client';

import { useEffect, useRef } from 'react';
import Lenis from 'lenis';
import { usePathname } from 'next/navigation';

/**
 * Wraps the app in a Lenis-driven smooth scroll instance.
 * Disabled on routes that need native scroll (dashboards, auth flows, etc.)
 * to keep keyboard / form UX snappy.
 */
const DISABLE_SMOOTH_ROUTES = [
    '/login',
    '/signup',
    '/auth',
    '/forgot-password',
    '/reset-password',
    '/verify-email',
    '/dashboard',
];

export default function SmoothScrollProvider({ children }: { children: React.ReactNode }) {
    const lenisRef = useRef<Lenis | null>(null);
    const pathname = usePathname();

    const smoothDisabled = DISABLE_SMOOTH_ROUTES.some(
        (p) => pathname === p || pathname.startsWith(p + '/'),
    );

    useEffect(() => {
        if (smoothDisabled) return;

        if (typeof window !== 'undefined') {
            const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            if (reduce) return;
        }

        const lenis = new Lenis({
            duration: 1.15,
            // Custom ease — feels like Apple / Linear: fast onset, gentle settle.
            easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
            wheelMultiplier: 1.05,
            touchMultiplier: 1.3,
            smoothWheel: true,
            syncTouch: false,
        });

        lenisRef.current = lenis;

        let rafId = 0;
        const raf = (time: number) => {
            lenis.raf(time);
            rafId = requestAnimationFrame(raf);
        };
        rafId = requestAnimationFrame(raf);

        // Smooth in-page #anchor jumps (header nav, etc.) so they ride Lenis.
        const onAnchorClick = (event: MouseEvent) => {
            if (event.defaultPrevented) return;
            if (event.button !== 0) return;
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

            const target = event.target as HTMLElement | null;
            const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null;
            if (!anchor) return;

            const href = anchor.getAttribute('href') ?? '';
            if (!href.startsWith('#') || href === '#') return;

            const id = href.slice(1);
            const el = document.getElementById(id);
            if (!el) return;

            event.preventDefault();
            lenis.scrollTo(el, { offset: -80, duration: 1.4 });
            history.pushState(null, '', href);
        };

        document.addEventListener('click', onAnchorClick);

        return () => {
            cancelAnimationFrame(rafId);
            document.removeEventListener('click', onAnchorClick);
            lenis.destroy();
            lenisRef.current = null;
        };
    }, [smoothDisabled]);

    // Snap to top instantly on route changes so the next page's reveal
    // animations play from a clean slate.
    useEffect(() => {
        if (smoothDisabled) return;
        const lenis = lenisRef.current;
        if (lenis) {
            lenis.scrollTo(0, { immediate: true });
        } else if (typeof window !== 'undefined') {
            window.scrollTo({ top: 0, behavior: 'auto' });
        }
    }, [pathname, smoothDisabled]);

    return <>{children}</>;
}
