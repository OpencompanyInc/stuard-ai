"use client";

import { useEffect } from 'react';
import Link from 'next/link';

const HeroSection = () => {
  useEffect(() => {
    document.body.classList.add('hero-dark');
    return () => {
      document.body.classList.remove('hero-dark');
    };
  }, []);

  return (
    <section
      className="
        hero-section
        relative
        flex flex-col items-center justify-center
        min-h-[calc(100vh-112px)]
        px-4
        py-20
        overflow-hidden
        text-white
      "
    >
      {/* Wavy grid background */}
      <div className="hero-bg" aria-hidden="true" />
      {/* Soft vignette so the text reads cleanly over the grid */}
      <div className="hero-vignette" aria-hidden="true" />

      {/* Main Content */}
      <div className="relative z-10 flex flex-col items-center text-center max-w-6xl mx-auto">
        {/* Headline */}
        <h1
          className="
            font-bold tracking-tight
            text-[44px] sm:text-[64px] lg:text-[85px]
            leading-[1.1] sm:leading-[1.08] lg:leading-[101px]
            text-[#F5F5F5]
            max-w-[1062px]
          "
        >
          Your Entire <span className="text-[#FF6A6A]">Workflow.</span>
          <br />
          <span className="text-[#FF6A6A]">One Intelligent</span> Assistant.
        </h1>

        {/* Subtitle */}
        <p
          className="
            mt-7
            text-[17px] sm:text-[21px] lg:text-[25px]
            leading-[1.36]
            font-medium
            text-[#D4D4D4]
            max-w-[845px]
          "
        >
          Stuard works across your apps, files, and workflows — helping you
          find, create, and execute instantly.
        </p>

        {/* CTA Buttons */}
        <div className="mt-12 flex flex-col sm:flex-row items-center gap-5 sm:gap-[50px]">
          <Link href="/signup">
            <button
              className="
                inline-flex items-center justify-center gap-2.5
                h-[68px] px-[30px]
                rounded-full
                bg-[#FF0617]/90 hover:bg-[#FF383C]
                text-white text-[21.6px] font-normal
                shadow-[0_18px_50px_-18px_rgba(255,6,23,0.65)]
                transition-colors
                whitespace-nowrap
              "
            >
              Try Stuard Free
              <svg
                width="29"
                height="29"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </button>
          </Link>

          <Link href="#demo">
            <button
              className="
                inline-flex items-center justify-center gap-2.5
                h-[68px] px-[30px]
                rounded-full
                bg-[#171717]/30 hover:bg-[#171717]/50
                border border-white/10
                text-white text-[21.6px] font-normal
                transition-colors
                whitespace-nowrap
              "
            >
              Watch Demo
              <svg
                width="29"
                height="29"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polygon points="6 4 20 12 6 20 6 4" />
              </svg>
            </button>
          </Link>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
