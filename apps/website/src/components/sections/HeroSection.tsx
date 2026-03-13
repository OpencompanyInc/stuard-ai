"use client";

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import OverlayDemo from './OverlayDemo';

const HeroSection = () => {
  const footerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    document.body.classList.add('show-grid');

    const handleScroll = () => {
      const footer = footerRef.current;
      if (!footer) return;
      const rect = footer.getBoundingClientRect();
      const past = rect.top <= 0;
      document.body.classList.toggle('grid-faded', past);
    };

    handleScroll();
    window.addEventListener('scroll', handleScroll);
    return () => {
      window.removeEventListener('scroll', handleScroll);
      document.body.classList.remove('grid-faded');
      document.body.classList.remove('show-grid');
    };
  }, []);

  return (
    <section className="relative flex flex-col items-center px-4 pt-40 pb-20 overflow-visible">
      
      {/* Main Content */}
      <div className="max-w-4xl mx-auto text-center z-10 flex flex-col items-center">
        
        {/* Headline */}
        <h1 
          className="serif-display font-medium text-center mx-auto"
          style={{
            fontSize: '60px',
            lineHeight: '1.1',
            color: '#171717',
            maxWidth: '900px',
            marginBottom: '24px'
          }}
        >
          The only AI assistant <span className="text-gray-400">you&apos;ll ever need.</span>
        </h1>

        {/* Subtitle */}
        <p 
          className="font-medium text-center mx-auto"
          style={{
            fontFamily: 'var(--font-inter), sans-serif',
            fontSize: '18px',
            lineHeight: '28px',
            color: '#404040',
            maxWidth: '640px'
          }}
        >
          <strong>Copilot stops at answers. Stuard keeps going.</strong> Your personal assistant that remembers everything, runs automations, and replaces the 5 subscriptions you&apos;re paying for.
        </p>

        {/* CTA Buttons */}
        <div className="pt-10 max-w-xl mx-auto w-full">
          <div className="flex flex-col sm:flex-row gap-3 justify-center mb-4">
            <Link href="/signup">
              <button className="px-8 py-3.5 text-sm font-semibold text-white bg-[#171717] hover:bg-[#000000] rounded-lg transition-colors shadow-lg shadow-black/10 flex items-center justify-center gap-2 whitespace-nowrap">
                Get Started Free
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </button>
            </Link>
            <Link href="/download">
              <button className="px-8 py-3.5 text-sm font-semibold text-gray-700 bg-white hover:bg-gray-50 rounded-lg transition-colors border border-gray-200 shadow-sm flex items-center justify-center gap-2 whitespace-nowrap">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download for Windows
              </button>
            </Link>
          </div>
          <p className="text-[11px] text-gray-500 font-medium tracking-wide text-center">
            Free to start. No credit card required. Local-first & privacy-focused.
          </p>
        </div>

        {/* Interactive Overlay Demo */}
        <OverlayDemo />

      </div>

      {/* Marker for grid fade trigger */}
      <div ref={footerRef} className="absolute bottom-0 left-0 right-0 h-1" />

    </section>
  );
};

export default HeroSection;
