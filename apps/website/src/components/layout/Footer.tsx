'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { Instagram, Facebook } from 'lucide-react';

const productLinks = [
  { label: 'Features', href: '/features' },
  { label: 'Integrations', href: '/integrations' },
  { label: 'Workflow Studio', href: '/workflow-studio' },
  { label: 'Download', href: '/download' },
];

const companyLinks = [
  { label: 'About', href: '/about' },
  { label: 'Blog', href: '/blog' },
  { label: 'Careers', href: '/careers' },
  { label: 'Contact', href: '/contact' },
];

const legalLinks = [
  { label: 'Privacy Policy', href: '/privacy' },
  { label: 'Terms of Service', href: '/terms' },
  { label: 'Security', href: '/security' },
  { label: 'Documentation', href: '/docs' },
];

// TikTok icon (not available in lucide-react)
const TikTokIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    aria-hidden="true"
  >
    <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.8 20.1a6.34 6.34 0 0 0 10.86-4.43V8.93a8.16 8.16 0 0 0 4.77 1.52V7a4.85 4.85 0 0 1-1.84-.31Z" />
  </svg>
);

const Footer = () => {
  const [email, setEmail] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // TODO: wire up newsletter submission
    setEmail('');
  };

  return (
    <footer className="relative overflow-hidden bg-black text-white">
      <div className="w-full px-6 pt-16 pb-0 sm:px-12 lg:px-20">
        {/* Logo */}
        <div className="flex flex-col gap-3">
          <Link href="/" className="inline-flex items-center gap-[9px]">
            <Image
              src="/stuard-mark.png"
              alt=""
              width={53}
              height={53}
              className="h-10 w-10 sm:h-[53px] sm:w-[53px]"
            />
            <span className="font-semibold text-[34px] leading-none tracking-tight text-white sm:text-[40px]">
              Stuard
            </span>
          </Link>
          <p className="text-sm text-[#737373]">Built for your machine. Owned by you.</p>
        </div>

        {/* Main grid */}
        <div className="mt-14 grid grid-cols-1 gap-12 lg:grid-cols-[1fr_auto] lg:gap-[106px]">
          {/* Left: Newsletter */}
          <div className="flex max-w-[479px] flex-col gap-9">
            <div className="flex flex-col gap-4">
              <h3 className="text-2xl font-medium leading-none text-white">
                Join our newsletter
              </h3>
              <div className="flex items-center gap-[35px]">
                <a
                  href="https://instagram.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Instagram"
                  className="flex h-8 w-8 items-center justify-center rounded-full border-[1.5px] border-[#A3A3A3] text-[#A3A3A3] transition-colors hover:border-white hover:text-white"
                >
                  <Instagram className="h-5 w-5" strokeWidth={1.5} />
                </a>
                <a
                  href="https://facebook.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Facebook"
                  className="flex h-8 w-8 items-center justify-center rounded-full border-[1.5px] border-[#A3A3A3] text-[#A3A3A3] transition-colors hover:border-white hover:text-white"
                >
                  <Facebook className="h-5 w-5" strokeWidth={1.5} />
                </a>
                <a
                  href="https://tiktok.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="TikTok"
                  className="flex h-8 w-8 items-center justify-center rounded-full border-[1.5px] border-[#A3A3A3] text-[#A3A3A3] transition-colors hover:border-white hover:text-white"
                >
                  <TikTokIcon className="h-[18px] w-[18px]" />
                </a>
              </div>
            </div>

            <form
              onSubmit={handleSubmit}
              className="flex w-full items-center gap-2"
            >
              <label className="flex h-14 flex-1 items-center rounded-lg border border-[#D4D4D4]/40 px-4">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="placeholder@gmail.com"
                  className="w-full bg-transparent text-sm text-white placeholder:text-[#A3A3A3] focus:outline-none"
                />
              </label>
              <button
                type="submit"
                className="flex h-14 shrink-0 items-center justify-center rounded-lg bg-[#D31519] px-4 text-base font-semibold text-white transition-colors hover:bg-[#FF383C] sm:w-[151px]"
              >
                Send Email
              </button>
            </form>
          </div>

          {/* Right: Link columns */}
          <div className="grid grid-cols-2 gap-x-12 gap-y-10 sm:grid-cols-3 sm:gap-x-[100px] lg:gap-x-[140px] xl:gap-x-[180px]">
            <FooterColumn title="Product" links={productLinks} mutedLinks />
            <FooterColumn title="Company" links={companyLinks} />
            <FooterColumn title="Legal" links={legalLinks} />
          </div>
        </div>

      </div>

      {/* Decorative footer background (full bleed) */}
      <div className="mt-12 w-full">
        <Image
          src="/footerbg.png"
          alt=""
          width={1920}
          height={120}
          priority={false}
          className="block h-auto w-full select-none"
        />
      </div>
    </footer>
  );
};

interface FooterColumnProps {
  title: string;
  links: { label: string; href: string }[];
  mutedLinks?: boolean;
}

const FooterColumn = ({ title, links, mutedLinks }: FooterColumnProps) => (
  <div className="flex flex-col gap-6">
    <h4 className="text-[28px] font-semibold leading-none text-white">
      {title}
    </h4>
    <ul className="flex flex-col gap-4">
      {links.map((link) => (
        <li key={link.href}>
          <Link
            href={link.href}
            className={`text-xl leading-none transition-colors hover:text-white ${
              mutedLinks ? 'text-[#D4D4D4]' : 'text-white'
            }`}
          >
            {link.label}
          </Link>
        </li>
      ))}
    </ul>
  </div>
);

export default Footer;
