'use client';

import { usePathname } from 'next/navigation';
import Header from './Header';
import Footer from './Footer';

const HIDE_CHROME = ['/login', '/signup', '/auth', '/forgot-password', '/reset-password', '/verify-email', '/dashboard'];

export default function LayoutShell({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const showChrome = !HIDE_CHROME.some(p => pathname === p || pathname.startsWith(p + '/'));

    if (!showChrome) {
        return <>{children}</>;
    }

    return (
        <>
            <div className="pointer-events-none fixed inset-x-0 top-0 z-50">
                <div className="pointer-events-auto bg-gray-900 text-white text-center py-2.5 text-sm font-medium tracking-wide shadow-[0_1px_0_rgba(255,255,255,0.08)]">
                    Stuard AI is now available &mdash;{' '}
                    <a href="/signup" className="underline underline-offset-2 hover:text-blue-300 transition-colors">
                        Get started free
                    </a>
                </div>
                <div data-site-header-nav>
                    <Header />
                </div>
            </div>
            <div className="relative z-10 flex min-h-screen flex-col">
                <main id="main" className="flex-1 pt-14 lg:pt-16">
                    {children}
                </main>
                <Footer />
            </div>
        </>
    );
}
