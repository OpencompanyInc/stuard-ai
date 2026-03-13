"use client";

import Link from 'next/link';
import Image from 'next/image';

import { useAuthContext } from '@/components/providers/AuthProvider';

const Header = () => {
  const { user } = useAuthContext();
  return (
    <header className="flex justify-center px-4 pt-3 pointer-events-none">
      <div className="bg-[#F3F1EB]/92 backdrop-blur-md border border-black/5 shadow-sm rounded-full px-4 py-2 flex items-center gap-6 pointer-events-auto max-w-5xl w-full justify-between">

        {/* Logo */}
        <Link href="/" className="flex-shrink-0">
          <Image
            src="/stuard-logo.png"
            alt="Stuard"
            width={40}
            height={40}
            className="w-10 h-10"
          />
        </Link>

        {/* Desktop Nav */}
        <nav className="hidden lg:flex items-center gap-6 text-[15px] font-medium text-gray-500 select-none">
          <Link href="/download" className="hover:text-black transition-colors">Download</Link>
          <Link href="/marketplace" className="hover:text-black transition-colors">Marketplace</Link>
          <Link href="/pricing" className="hover:text-black transition-colors">Pricing</Link>
        </nav>

        {/* Action Button */}
        <div className="flex items-center gap-4">
          {user ? (
            <Link href="/dashboard">
              <button className="bg-black text-white text-sm font-medium px-5 py-2.5 rounded-lg hover:opacity-80 transition-all">
                Dashboard
              </button>
            </Link>
          ) : (
            <>
              <Link href="/login" className="text-sm font-medium text-gray-600 hover:text-black hidden lg:block">
                Sign In
              </Link>
              <Link href="/signup">
                <button className="bg-black text-white text-sm font-medium px-5 py-2.5 rounded-lg hover:opacity-80 transition-all">
                  Get Started
                </button>
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
};

export default Header;
