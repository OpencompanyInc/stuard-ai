'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuthContext } from '@/components/providers/AuthProvider';

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const pathname = usePathname();
    const { user } = useAuthContext();
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

    // Mock user for dev if not logged in
    const displayUser = user || { email: 'demo@stuard.ai' };

    const navigation = [
        { name: 'Overview', href: '/dashboard', icon: HomeIcon },
        { name: 'Billing & Plans', href: '/dashboard/billing', icon: CreditCardIcon },
        { name: 'Settings', href: '/dashboard/settings', icon: SettingsIcon },
    ];

    const isActive = (path: string) => pathname === path;

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 flex">
            {/* Sidebar for Desktop */}
            <aside className="hidden md:flex w-64 flex-col bg-white border-r border-gray-200 fixed inset-y-0 z-50">
                <div className="flex items-center h-16 px-6 border-b border-gray-100">
                    <Link href="/" className="flex items-center gap-2 group">
                        <div className="h-8 w-8 bg-gradient-to-br from-blue-600 to-violet-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20 group-hover:shadow-blue-500/30 transition-all duration-300">
                            <span className="text-white font-bold text-lg">S</span>
                        </div>
                        <span className="font-bold text-xl bg-clip-text text-transparent bg-gradient-to-r from-gray-900 to-gray-700">
                            Stuard AI
                        </span>
                    </Link>
                </div>

                <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
                    {navigation.map((item) => {
                        const active = isActive(item.href);
                        return (
                            <Link
                                key={item.name}
                                href={item.href}
                                className={`flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-xl transition-all duration-200 ${active
                                    ? 'bg-blue-50 text-blue-700 shadow-sm ring-1 ring-blue-100'
                                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                                    }`}
                            >
                                <item.icon className={`w-5 h-5 ${active ? 'text-blue-600' : 'text-gray-400'}`} />
                                {item.name}
                            </Link>
                        );
                    })}
                </nav>

                <div className="p-4 border-t border-gray-100">
                    <Link href="/download" className="block w-full">
                        <div className="p-4 rounded-xl bg-gradient-to-br from-gray-900 to-gray-800 text-white shadow-lg shadow-gray-900/10 group cursor-pointer hover:shadow-gray-900/20 transition-all">
                            <div className="flex items-center gap-3 mb-2">
                                <div className="p-2 bg-white/10 rounded-lg">
                                    <DesktopIcon className="w-4 h-4 text-white" />
                                </div>
                                <span className="font-semibold text-sm">Desktop App</span>
                            </div>
                            <p className="text-xs text-gray-300 mb-3">Get the full experience with our desktop agent.</p>
                            <span className="text-xs font-medium text-white/90 group-hover:text-white flex items-center gap-1">
                                Download <ArrowRightIcon className="w-3 h-3" />
                            </span>
                        </div>
                    </Link>
                </div>

                <div className="p-4 border-t border-gray-100">
                    <div className="flex items-center gap-3 px-2">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-r from-blue-500 to-purple-500 flex items-center justify-center text-white text-xs font-bold">
                            {displayUser.email?.[0]?.toUpperCase() || 'U'}
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">
                                {displayUser.email?.split('@')[0]}
                            </p>
                            <p className="text-xs text-gray-500 truncate">{displayUser.email}</p>
                        </div>
                    </div>
                </div>
            </aside>

            {/* Mobile Header */}
            <div className="md:hidden fixed top-0 left-0 right-0 z-50 bg-white border-b border-gray-200 px-4 h-16 flex items-center justify-between">
                <Link href="/" className="font-bold text-xl text-gray-900">Stuard</Link>
                <button
                    onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                    className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg"
                >
                    <MenuIcon className="w-6 h-6" />
                </button>
            </div>

            {/* Mobile Menu Overlay */}
            {isMobileMenuOpen && (
                <div className="md:hidden fixed inset-0 z-40 bg-gray-600/50 backdrop-blur-sm" onClick={() => setIsMobileMenuOpen(false)}>
                    <div className="absolute right-0 top-0 bottom-0 w-64 bg-white shadow-xl p-4 flex flex-col" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-end mb-4">
                            <button onClick={() => setIsMobileMenuOpen(false)} className="p-2 text-gray-500"><CloseIcon className="w-6 h-6" /></button>
                        </div>
                        <nav className="space-y-1">
                            {navigation.map((item) => (
                                <Link
                                    key={item.name}
                                    href={item.href}
                                    onClick={() => setIsMobileMenuOpen(false)}
                                    className={`flex items-center gap-3 px-3 py-3 text-sm font-medium rounded-lg ${isActive(item.href) ? 'bg-blue-50 text-blue-700' : 'text-gray-600'
                                        }`}
                                >
                                    <item.icon className="w-5 h-5" />
                                    {item.name}
                                </Link>
                            ))}
                        </nav>
                    </div>
                </div>
            )}

            {/* Main Content */}
            <main className="flex-1 md:ml-64 pt-16 md:pt-0 min-h-screen transition-all duration-300 ease-in-out">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-12">
                    <div className="rounded-3xl border border-white/70 bg-white/70 shadow-xl shadow-blue-100/40 backdrop-blur-sm p-6 md:p-10">
                        {children}
                    </div>
                </div>
            </main>
        </div>
    );
}

// Icons
function HomeIcon({ className }: { className?: string }) {
    return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>;
}
function CreditCardIcon({ className }: { className?: string }) {
    return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>;
}
function SettingsIcon({ className }: { className?: string }) {
    return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>;
}
function DesktopIcon({ className }: { className?: string }) {
    return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>;
}
function ArrowRightIcon({ className }: { className?: string }) {
    return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>;
}
function MenuIcon({ className }: { className?: string }) {
    return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>;
}
function CloseIcon({ className }: { className?: string }) {
    return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>;
}
