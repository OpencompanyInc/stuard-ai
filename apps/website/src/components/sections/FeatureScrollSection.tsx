"use client";

import { useRef, useEffect, useState } from 'react';
import Link from 'next/link';

import WorkflowBuilderDemo from './WorkflowBuilderDemo';
import AutomationDemo from './AutomationDemo';
import MemoryDemo from './MemoryDemo';

const features = [
  {
    id: "real-automation",
    title: "Real Automation",
    description:
      "Stuard clicks buttons and types for you. It's the bridge between \"AI chatbot\" and \"real automation\".",
    video: "/videos/automation-demo.mp4"
  },
  {
    id: "build-tools",
    title: "Build Your Own Tools",
    description:
      "Create custom tools—like a data scraper or meeting scheduler—in minutes using the visual builder or natural language.",
    video: "/videos/builder-demo.mp4"
  },
  {
    id: "sticky-memory",
    title: "Sticky Memory",
    description:
      "Stuard remembers your projects, preferences, and workflow patterns. It's not a blank slate every conversation.",
    video: "/videos/memory-demo.mp4"
  },
  {
    id: "get-started",
    title: "Ready to automate?",
    description: "Start building automations that actually work. Free plan included — no credit card required.",
    video: null,
    isCta: true
  }
];

const FeatureScrollSection = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    const track = trackRef.current;
    if (!container || !track) return;

    const handleScroll = () => {
      const rect = container.getBoundingClientRect();
      const viewHeight = window.innerHeight;
      
      // Calculate how far we've scrolled into the container
      // Start pinning when container hits top
      const scrollDist = -rect.top;
      const totalScroll = rect.height - viewHeight;
      
      if (scrollDist < 0) {
        // Before container
        track.style.transform = `translateX(0)`;
        setActiveIndex(0);
      } else if (scrollDist > totalScroll) {
        // After container
        track.style.transform = `translateX(-${(features.length - 1) * 100}vw)`;
        setActiveIndex(features.length - 1);
      } else {
        // Inside container - horizontal scroll
        const progress = scrollDist / totalScroll;
        // Total width to scroll is (features.length - 1) * 100vw
        const translate = progress * (features.length - 1) * 100;
        track.style.transform = `translateX(-${translate}vw)`;
        setActiveIndex(Math.round(progress * (features.length - 1)));
      }
    };

    window.addEventListener('scroll', handleScroll);
    handleScroll(); // Initial check

    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Count only the feature slides (not the CTA) for scroll distance calculation
  const featureCount = features.filter(f => !f.isCta).length;
  
  return (
    // Height: each feature gets 100vh, plus 50vh for the CTA (less scroll needed)
    <section ref={containerRef} className="relative" style={{ height: `${featureCount * 100 + 50}vh` }}>
      
      {/* Sticky Window */}
      <div className="sticky top-0 h-screen w-full overflow-hidden border-t border-black/5 flex items-center">
        
        {/* Horizontal Track */}
        <div ref={trackRef} className="flex h-full will-change-transform transition-transform duration-75 ease-linear" style={{ width: `${features.length * 100}vw` }}>
          
          {features.map((feature) => (
            <div key={feature.id} className="w-screen h-full flex items-center justify-center px-4 sm:px-8">
              <div className="max-w-7xl w-full grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
                
                {/* Text Content */}
                <div className="text-left space-y-6 md:pl-12">
                  <h2 className="serif-display text-4xl md:text-6xl text-[#171717] leading-tight">
                    {feature.title}
                  </h2>
                  <p className="text-xl text-gray-600 max-w-lg leading-relaxed">
                    {feature.description}
                  </p>
                  
                  {/* Progress Indicator */}
                  {!feature.isCta && (
                    <div className="flex gap-2 pt-4">
                      {features.filter(f => !f.isCta).map((f, i) => (
                        <div key={f.id} className={`h-1.5 rounded-full transition-all duration-300 ${f.id === feature.id ? 'w-12 bg-black' : 'w-2 bg-gray-300'}`} />
                      ))}
                    </div>
                  )}

                  {/* CTA Button for Final Slide */}
                  {feature.isCta && (
                    <div className="flex flex-wrap gap-3 mt-8">
                      <Link href="/signup">
                        <button className="px-8 py-3 text-lg font-semibold text-white bg-[#171717] hover:bg-[#000000] rounded-lg transition-colors shadow-lg shadow-black/10 inline-flex items-center gap-2">
                          Get Started Free
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                          </svg>
                        </button>
                      </Link>
                      <Link href="/pricing">
                        <button className="px-8 py-3 text-lg font-semibold text-gray-700 bg-white hover:bg-gray-50 rounded-lg transition-colors border border-gray-200 shadow-sm inline-flex items-center gap-2">
                          View Pricing
                        </button>
                      </Link>
                    </div>
                  )}
                </div>

                {/* Visual Content */}
                <div className={`relative rounded-2xl overflow-hidden shadow-2xl bg-[#E5E5E5] aspect-[4/3] w-full max-w-2xl border border-black/5 group mx-auto ${feature.isCta ? 'flex items-center justify-center bg-white' : ''}`}>

                   {feature.isCta ? (
                     <div className="text-center p-8">
                        <div className="w-24 h-24 bg-[#F3F1EB] rounded-2xl mx-auto flex items-center justify-center mb-6 text-gray-800">
                          <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                          </svg>
                        </div>
                        <h3 className="text-2xl font-serif text-gray-900 mb-2">Start Automating</h3>
                        <p className="text-gray-500">Your AI assistant is ready.</p>
                     </div>
                   ) : feature.id === "build-tools" ? (
                     <WorkflowBuilderDemo />
                   ) : feature.id === "real-automation" ? (
                     <AutomationDemo />
                   ) : feature.id === "sticky-memory" ? (
                     <MemoryDemo />
                   ) : (
                     <>
                      {/* Video Placeholder Background */}
                      <div className="absolute inset-0 bg-gradient-to-tr from-gray-100 to-gray-200 flex items-center justify-center">
                        <div className="w-20 h-20 bg-white rounded-full shadow-lg flex items-center justify-center text-gray-400 group-hover:scale-110 transition-transform">
                            <svg className="w-8 h-8 ml-1" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M8 5v14l11-7z" />
                            </svg>
                        </div>
                      </div>

                      {/* Overlay Label */}
                      <div className="absolute bottom-6 left-6 px-4 py-2 bg-white/90 backdrop-blur-md rounded-lg text-sm font-medium text-gray-900 shadow-sm border border-black/5">
                        {feature.title} Demo
                      </div>
                     </>
                   )}
                </div>

              </div>
            </div>
          ))}

        </div>
      </div>
    </section>
  );
};

export default FeatureScrollSection;
