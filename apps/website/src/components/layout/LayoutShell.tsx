'use client';

import { usePathname } from 'next/navigation';
import Header from './Header';
import Footer from './Footer';
import SmoothScrollProvider from './SmoothScrollProvider';
import PageTransition from './PageTransition';

const HIDE_CHROME = ['/login', '/signup', '/auth', '/forgot-password', '/reset-password', '/verify-email', '/dashboard'];

export default function LayoutShell({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const showChrome = !HIDE_CHROME.some(p => pathname === p || pathname.startsWith(p + '/'));

    if (!showChrome) {
        return (
            <SmoothScrollProvider>
                <PageTransition>{children}</PageTransition>
            </SmoothScrollProvider>
        );
    }

    return (
        <SmoothScrollProvider>
            <div className="pointer-events-none fixed inset-x-0 top-3 sm:top-4 lg:top-6 z-50 flex justify-center px-3 sm:px-4">
                <div data-site-header-nav className="pointer-events-auto w-full max-w-[1300px]">
                    <Header />
                </div>
            </div>
            <div className="relative z-10 flex min-h-screen flex-col">
                <main id="main" className="flex-1">
                    <PageTransition>{children}</PageTransition>
                </main>
                <Footer />
            </div>
        </SmoothScrollProvider>
    );
}
