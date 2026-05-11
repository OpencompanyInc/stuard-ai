'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
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
        { name: 'Overview', href: '/dashboard', icon: HomeIcon },
        { name: 'Cloud Engine', href: '/dashboard/cloud', icon: CloudIcon },
        { name: 'Billing', href: '/dashboard/billing', icon: CreditCardIcon },
        { name: 'Support', href: '/dashboard/support', icon: SupportIcon },
        { name: 'Settings', href: '/dashboard/settings', icon: SettingsIcon },
    ];

    const active = (href: string) => pathname === href || pathname.startsWith(href + '/');

    const handleLogout = async () => {
        await logout();
        window.location.href = '/';
    };

    const sidebar = (
        <>
            {/* Logo */}
            <div className="h-14 flex items-center gap-2.5 px-5 flex-shrink-0">
                <Link href="/" className="flex items-center gap-2.5">
                    <div className="h-7 w-7 bg-gray-900 rounded-lg flex items-center justify-center">
                        <span className="text-white font-bold text-sm">S</span>
                    </div>
                    <span className="font-semibold text-[15px] text-gray-900">Stuard AI</span>
                </Link>
            </div>

            {/* Nav */}
            <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
                {nav.map((item) => (
                    <Link
                        key={item.name}
                        href={item.href}
                        onClick={() => setMobileOpen(false)}
                        className={`flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium rounded-lg transition-colors ${
                            active(item.href)
                                ? 'bg-gray-900 text-white'
                                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                        }`}
                    >
                        <item.icon className={`w-4 h-4 ${active(item.href) ? 'text-white' : 'text-gray-400'}`} />
                        {item.name}
                    </Link>
                ))}
            </nav>

            {/* Download CTA */}
            <div className="px-3 pb-2">
                <Link href="/download" className="block">
                    <div className="px-3 py-2.5 rounded-lg bg-gray-50 border border-gray-200 hover:bg-gray-100 transition-colors group">
                        <div className="flex items-center gap-2">
                            <DesktopIcon className="w-4 h-4 text-gray-400" />
                            <span className="text-[13px] font-medium text-gray-700">Download Desktop</span>
                        </div>
                    </div>
                </Link>
            </div>

            {/* User */}
            <div className="px-3 pb-4 pt-2 border-t border-gray-200">
                <div className="flex items-center gap-2.5 px-2 py-2">
                    <div className="w-7 h-7 rounded-full bg-gray-900 flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
                        {initial}
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium text-gray-900 truncate">{displayName}</p>
                        <p className="text-[11px] text-gray-400 truncate">{displayEmail}</p>
                    </div>
                    <button
                        onClick={handleLogout}
                        className="p-1 text-gray-400 hover:text-gray-600 rounded transition-colors"
                        title="Sign out"
                    >
                        <LogoutIcon className="w-4 h-4" />
                    </button>
                </div>
            </div>
        </>
    );

    return (
        <div className="min-h-screen bg-[#F7F7F5] pt-3 lg:pt-4">
            {/* Desktop Sidebar */}
            <aside className="hidden lg:flex w-56 flex-col fixed top-10 bottom-0 z-40 bg-white border-r border-gray-200">
                {sidebar}
            </aside>

            {/* Mobile Top Bar */}
            <div className="lg:hidden fixed top-10 inset-x-0 z-40 bg-white border-b border-gray-200 h-14 flex items-center justify-between px-4">
                <Link href="/" className="flex items-center gap-2">
                    <div className="h-7 w-7 bg-gray-900 rounded-lg flex items-center justify-center">
                        <span className="text-white font-bold text-sm">S</span>
                    </div>
                    <span className="font-semibold text-[15px] text-gray-900">Stuard</span>
                </Link>
                <button onClick={() => setMobileOpen(!mobileOpen)} className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg">
                    {mobileOpen ? <CloseIcon className="w-5 h-5" /> : <MenuIcon className="w-5 h-5" />}
                </button>
            </div>

            {/* Mobile Drawer */}
            {mobileOpen && (
                <div className="lg:hidden fixed inset-0 z-50">
                    <div className="absolute inset-0 bg-black/20" onClick={() => setMobileOpen(false)} />
                    <div className="absolute left-0 top-10 bottom-0 w-56 bg-white shadow-xl flex flex-col">
                        {sidebar}
                    </div>
                </div>
            )}

            {/* Main Content */}
            <main className="lg:ml-56 min-h-screen pt-14 lg:pt-4">
                <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
                    {children}
                </div>
            </main>
        </div>
    );
}

// Minimal SVG icons
function HomeIcon({ className }: { className?: string }) {
    return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955a1.126 1.126 0 011.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" /></svg>;
}
function CreditCardIcon({ className }: { className?: string }) {
    return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" /></svg>;
}
function SettingsIcon({ className }: { className?: string }) {
    return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>;
}
function CloudIcon({ className }: { className?: string }) {
    return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z" /></svg>;
}
function SupportIcon({ className }: { className?: string }) {
    return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" /></svg>;
}
function DesktopIcon({ className }: { className?: string }) {
    return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25A2.25 2.25 0 015.25 3h13.5A2.25 2.25 0 0121 5.25z" /></svg>;
}
function LogoutIcon({ className }: { className?: string }) {
    return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" /></svg>;
}
function MenuIcon({ className }: { className?: string }) {
    return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" /></svg>;
}
function CloseIcon({ className }: { className?: string }) {
    return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>;
}
