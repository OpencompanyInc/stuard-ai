'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useAuthContext } from '@/components/providers/AuthProvider';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const { user, logout } = useAuthContext();
    const [mobileOpen, setMobileOpen] = useState(false);

    useEffect(() => {
        document.body.classList.add('dashboard-shell');
        return () => document.body.classList.remove('dashboard-shell');
    }, []);

    const displayEmail = user?.email || 'demo@stuard.ai';
    const displayName = user?.user_metadata?.fullName || displayEmail.split('@')[0];
    const initial = displayName.charAt(0).toUpperCase();

    const nav = [
        { name: 'Overview', href: '/dashboard', icon: DashboardIcon },
        { name: 'Cloud Computer', href: '/dashboard/cloud', icon: CloudIcon },
        { name: 'Billings', href: '/dashboard/billing', icon: CreditCardIcon },
        { name: 'Settings', href: '/dashboard/settings', icon: SettingsIcon },
    ];

    const active = (href: string) => {
        if (href === '/dashboard') return pathname === '/dashboard';
        return pathname === href || pathname.startsWith(href + '/');
    };
    const activeItem = nav.find((n) => active(n.href));

    const handleLogout = async () => {
        await logout();
        window.location.href = '/';
    };

    const sidebar = (
        <div className="flex h-full flex-col justify-between gap-3 px-3 pt-4 overflow-y-auto dash-scroll">
            {/* Top: Logo + Nav */}
            <div className="flex flex-col gap-6 min-h-0">
                {/* Brand row */}
                <div className="flex items-center justify-between px-1">
                    <Link href="/" className="flex items-center gap-2">
                        <Image
                            src="/stuard-mark.png"
                            alt="Stuard"
                            width={20}
                            height={20}
                            className="h-5 w-5"
                            priority
                        />
                        <span className="text-[15px] font-medium leading-5 text-white">Stuard AI</span>
                    </Link>
                    <button
                        type="button"
                        onClick={() => setMobileOpen(false)}
                        className="hidden lg:flex h-6 w-6 items-center justify-center text-white/70 hover:text-white"
                        aria-label="Toggle sidebar"
                    >
                        <PanelLeftIcon className="h-4 w-4" />
                    </button>
                </div>

                {/* Nav */}
                <nav className="flex flex-col gap-1">
                    {nav.map((item) => (
                        <Link
                            key={item.name}
                            href={item.href}
                            onClick={() => setMobileOpen(false)}
                            className={`dash-nav-item ${active(item.href) ? 'dash-nav-item--active' : ''}`}
                        >
                            <item.icon className="h-4 w-4" />
                            <span>{item.name}</span>
                        </Link>
                    ))}
                </nav>
            </div>

            {/* Bottom: Desktop CTA */}
            <div className="pb-3">
                <div className="dash-desktop-cta">
                    <h3 className="dash-desktop-cta__title">
                        Get More from<br />Stuard on Desktop
                    </h3>
                    <Link href="/download" className="dash-desktop-cta__button">
                        <DesktopDownloadIcon className="h-4 w-4" />
                        <span>Download Desktop</span>
                    </Link>
                </div>
            </div>
        </div>
    );

    return (
        <div className="dashboard-shell-layout flex min-h-screen flex-col bg-[#0A0A0A] text-white">
            {/* Mobile Top Bar */}
            <div className="lg:hidden sticky top-0 z-40 bg-[#0A0A0A]/95 backdrop-blur border-b border-neutral-800 h-14 flex items-center justify-between px-4">
                <Link href="/" className="flex items-center gap-2">
                    <Image src="/stuard-mark.png" alt="Stuard" width={24} height={24} className="h-6 w-6" />
                    <span className="text-[15px] font-medium text-white">Stuard AI</span>
                </Link>
                <button
                    onClick={() => setMobileOpen(!mobileOpen)}
                    className="p-2 text-white/80 hover:text-white hover:bg-neutral-800/60 rounded-lg"
                    aria-label="Toggle menu"
                >
                    {mobileOpen ? <CloseIcon className="w-5 h-5" /> : <MenuIcon className="w-5 h-5" />}
                </button>
            </div>

            {/* Mobile Drawer */}
            {mobileOpen && (
                <div className="lg:hidden fixed inset-0 z-50">
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
                    <div className="dash-sidebar absolute left-3 right-3 top-16 bottom-3 overflow-hidden flex flex-col">
                        {sidebar}
                    </div>
                </div>
            )}

            {/* Desktop layout: sticky sidebar + main */}
            <div className="dashboard-shell-row lg:flex lg:items-start lg:gap-3 lg:p-3 flex-1 min-h-0">
                {/* Sticky Sidebar (uses sticky so it works inside the motion.div containing block) */}
                <aside className="hidden lg:block w-[220px] flex-shrink-0 sticky top-3 self-start" style={{ height: 'calc(100vh - 1.5rem)' }}>
                    <div className="dash-sidebar h-full overflow-hidden flex flex-col">
                        {sidebar}
                    </div>
                </aside>

                {/* Main Content */}
                <main className="flex-1 min-w-0 flex flex-col min-h-0">
                    {/* Top bar (page title + user) — hidden while VM workspace is active */}
                    <div className="dashboard-main-chrome flex items-center justify-between px-3 lg:px-1 h-10 mb-1 lg:mb-2 shrink-0">
                        <p className="text-[13px] text-neutral-400">{activeItem?.name ?? 'Overview'}</p>
                        <div className="flex items-center gap-2 rounded-full bg-neutral-900/70 border border-neutral-800 pl-1 pr-2.5 py-0.5">
                            <div className="h-6 w-6 rounded-full bg-gradient-to-br from-amber-200 to-amber-600 flex items-center justify-center text-[11px] font-semibold text-neutral-900">
                                {initial}
                            </div>
                            <span className="text-[12px] font-medium text-neutral-200">{displayName}</span>
                            <button
                                onClick={handleLogout}
                                className="ml-0.5 text-neutral-500 hover:text-white"
                                title="Sign out"
                                aria-label="Sign out"
                            >
                                <LogoutIcon className="w-3 h-3" />
                            </button>
                        </div>
                    </div>

                    <div className="dashboard-main-content flex-1 min-h-0 px-3 lg:px-1 pb-6">
                        {children}
                    </div>
                </main>
            </div>
        </div>
    );
}

// ── Icons ────────────────────────────────────────────────────────────────────

function DashboardIcon({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <rect x="2.5" y="2.5" width="6" height="6" rx="1.5" />
            <rect x="11.5" y="2.5" width="6" height="6" rx="1.5" />
            <rect x="11.5" y="11.5" width="6" height="6" rx="1.5" />
            <rect x="2.5" y="11.5" width="6" height="6" rx="1.5" />
        </svg>
    );
}

function CloudIcon({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
            <path d="M5.5 14.5h9a3.5 3.5 0 0 0 .5-6.96A5 5 0 0 0 5.1 9.1 3.5 3.5 0 0 0 5.5 14.5Z" />
            <path d="M10 11.5v5" />
            <path d="m8.5 15 1.5 1.5 1.5-1.5" />
        </svg>
    );
}

function CreditCardIcon({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
            <rect x="1.667" y="3.333" width="16.667" height="13.333" rx="2" />
            <path d="M1.667 7.5h16.667" />
            <path d="M4.167 13.333h2.083" />
            <path d="M8.333 13.333h2.917" />
        </svg>
    );
}

function SettingsIcon({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
        </svg>
    );
}

function PanelLeftIcon({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M9 3v18" />
        </svg>
    );
}

function DesktopDownloadIcon({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
            <rect x="1.667" y="2.5" width="16.667" height="11.667" rx="2" />
            <path d="M6.667 17.5h6.666" />
            <path d="M10 14.167V17.5" />
            <path d="M7.5 8.333 10 10.833l2.5-2.5" />
            <path d="M10 5.833v5" />
        </svg>
    );
}

function LogoutIcon({ className }: { className?: string }) {
    return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" />
        </svg>
    );
}

function MenuIcon({ className }: { className?: string }) {
    return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
        </svg>
    );
}

function CloseIcon({ className }: { className?: string }) {
    return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
        </svg>
    );
}
