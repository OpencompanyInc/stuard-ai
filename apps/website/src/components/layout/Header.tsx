"use client";

import Link from 'next/link';
import Image from 'next/image';

import { useAuthContext } from '@/components/providers/AuthProvider';

const navLinks = [
  { href: '#about', label: 'About' },
  { href: '#features', label: 'Features' },
  { href: '#how-it-works', label: 'How It Works' },
  { href: '/pricing', label: 'Pricing' },
  { href: '#faq', label: 'FAQ' },
];

const Header = () => {
  const { user } = useAuthContext();

  return (
    <header className="flex justify-center px-4 pt-3 pointer-events-none">
      <div
        className="
          pointer-events-auto
          relative
          flex items-center justify-between
          w-full max-w-6xl
          h-[68px]
          pl-6 pr-2
          rounded-full
          bg-white/[0.02]
          border border-white/10
        "
      >
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 flex-shrink-0">
          <Image
            src="/stuard-mark.png"
            alt="Stuard"
            width={32}
            height={32}
            className="w-8 h-8 object-contain"
            priority
          />
          <span className="text-white text-[22px] font-medium tracking-tight leading-none">
            Stuard
          </span>
        </Link>

        {/* Desktop Nav */}
        <nav className="hidden lg:flex items-center gap-9 text-[15px] font-medium text-white/80 select-none">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="hover:text-white transition-colors"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Action Buttons */}
        <div className="flex items-center gap-3">
          {user ? (
            <Link href="/dashboard">
              <button
                className="
                  inline-flex items-center gap-2
                  h-[52px] px-7
                  rounded-xl
                  bg-[#FF1727] hover:bg-[#FF383C]
                  text-white text-[15px] font-medium
                  transition-colors
                "
              >
                Dashboard
              </button>
            </Link>
          ) : (
            <Link href="/download">
              <button
                className="
                  inline-flex items-center gap-2
                  h-[52px] px-7
                  rounded-xl
                  bg-[#FF1727] hover:bg-[#FF383C]
                  text-white text-[15px] font-medium
                  transition-colors
                "
              >
                Download Now
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M3 5.5 11 4v8H3V5.5ZM13 3.75 21 2v10h-8V3.75ZM3 13h8v7L3 18.5V13ZM13 13h8v8l-8-1.5V13Z" />
                </svg>
              </button>
            </Link>
          )}
        </div>
      </div>
    </header>
  );
};

export default Header;
