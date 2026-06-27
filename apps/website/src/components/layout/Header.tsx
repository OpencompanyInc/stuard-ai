"use client";

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';

import { useAuthContext } from '@/components/providers/AuthProvider';

const navLinks = [
  { href: '/#about', label: 'What is Stuard' },
  { href: '/#day', label: 'A day with Stuard' },
  { href: '/how-it-works', label: 'How It Works' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/#faq', label: 'FAQ' },
];

const Header = () => {
  const { user } = useAuthContext();
  const [menuOpen, setMenuOpen] = useState(false);
  const ctaHref = user ? '/dashboard' : '/download';
  const ctaLabel = user ? 'Open dashboard' : 'Download for Windows';

  return (
    <div
      className="
        relative
        flex items-center justify-between
        w-full
        h-[60px] sm:h-[68px] lg:h-[78px]
        px-4 sm:px-5 lg:px-9
        rounded-full
        bg-[#171717]/20
        backdrop-blur-xl
        border border-[#262626]
      "
    >
      {/* Logo */}
      <Link href="/" className="flex items-center gap-1.5 flex-shrink-0">
        <Image
          src="/stuard-mark.png"
          alt="Stuard"
          width={28}
          height={28}
          className="h-6 w-6 sm:h-7 sm:w-7 object-contain"
          priority
        />
        <span className="text-white text-[16px] sm:text-[17px] lg:text-[18px] font-medium tracking-tight leading-none">
          Stuard
        </span>
      </Link>

      {/* Desktop Nav */}
      <nav className="hidden lg:flex items-center gap-7 text-[14px] font-normal text-white select-none">
        {navLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="capitalize hover:opacity-80 transition-opacity"
          >
            {link.label}
          </Link>
        ))}
      </nav>

      {/* Right side: Desktop CTA + Mobile menu button */}
      <div className="flex items-center gap-2">
        <Link href={ctaHref} className="hidden sm:block">
          <button
            className="
              inline-flex items-center gap-2
              h-[40px] sm:h-[42px] lg:h-[46px]
              px-4 sm:px-5
              rounded-xl
              bg-white
              text-[#080808]
              text-[13px] sm:text-[14px] lg:text-[15px]
              font-medium capitalize
              hover:bg-white/90 transition-colors
              whitespace-nowrap
            "
          >
            <WindowIcon />
            <span className="hidden sm:inline">{ctaLabel}</span>
          </button>
        </Link>

        {/* Mobile menu button */}
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="lg:hidden flex h-10 w-10 items-center justify-center rounded-full bg-white/5 text-white border border-white/10"
          aria-label="Toggle menu"
          aria-expanded={menuOpen}
        >
          {menuOpen ? <CloseIcon /> : <MenuIcon />}
        </button>
      </div>

      {/* Mobile menu drawer */}
      {menuOpen && (
        <div className="absolute left-0 right-0 top-full mt-2 lg:hidden">
          <div className="rounded-2xl border border-[#262626] bg-[#171717]/90 backdrop-blur-xl p-4 flex flex-col gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                className="block rounded-xl px-3 py-3 text-[15px] text-white hover:bg-white/5 transition-colors capitalize"
              >
                {link.label}
              </Link>
            ))}
            <Link href={ctaHref} onClick={() => setMenuOpen(false)} className="sm:hidden mt-2">
              <button className="w-full inline-flex items-center justify-center gap-2 h-12 rounded-xl bg-white text-[#080808] text-[15px] font-medium capitalize">
                <WindowIcon />
                {ctaLabel}
              </button>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
};

const WindowIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="lg:h-[18px] lg:w-[18px]">
    <rect x="3" y="3" width="8.5" height="8.5" />
    <rect x="12.5" y="3" width="8.5" height="8.5" />
    <rect x="3" y="12.5" width="8.5" height="8.5" />
    <rect x="12.5" y="12.5" width="8.5" height="8.5" />
  </svg>
);

const MenuIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <line x1="4" y1="7" x2="20" y2="7" />
    <line x1="4" y1="12" x2="20" y2="12" />
    <line x1="4" y1="17" x2="20" y2="17" />
  </svg>
);

const CloseIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <line x1="6" y1="6" x2="18" y2="18" />
    <line x1="18" y1="6" x2="6" y2="18" />
  </svg>
);

export default Header;
