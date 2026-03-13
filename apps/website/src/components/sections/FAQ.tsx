'use client';

import { useState } from 'react';

export default function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const faqs = [
    {
      question: 'What makes Stuard AI different from other AI assistants?',
      answer: 'Stuard focuses on the computer chores you’re tired of doing—like cleaning up downloads, summarizing emails, or simple screen and desk rules. It runs locally on your machine, only does what you explicitly allow, and is designed to be helpful without feeling invasive.',
    },
    {
      question: 'Is this Stuard, Steward, or Stuart?',
      answer: 'It’s Stuard AI (pronounced “stew‑erd”). People sometimes search “Steward AI” or “Stuart AI” — they’re all referring to Stuard.',
    },
    {
      question: 'Will my data be sold or used to train other AI models?',
      answer: 'Absolutely not. We never sell, share, or use your data for any purpose other than providing you with assistance. Your conversations are stored locally on your computer, and we have zero-knowledge of your personal information.',
    },
    {
      question: 'What platforms does Stuard AI support?',
      answer: 'Stuard AI is built for desktop users. We support Windows 10 and 11 today, and were actively bringing the same experience to macOS and Linux. macOS and Linux support is on the way.',
    },
    {
      question: 'How does the memory system work?',
      answer: 'Stuard remembers just enough to make your life easier—like how you like files organized or which inboxes matter—and stores that information encrypted on your device. It uses this to reduce repetitive setup without you having to repeat yourself every time.',
    },
    {
      question: 'Is there a free trial?',
      answer: 'New accounts start on the free plan with about 15 starter credits. No credit card is required to get started.',
    },
    {
      question: 'What if I need help or have questions?',
      answer: 'We provide email support for all users and priority support for Professional plan subscribers. Our team typically responds within 24 hours, and we have comprehensive documentation and tutorials available.',
    },
  ];

  return (
    <section className="py-24 bg-gradient-to-br from-white via-gray-50 to-secondary/10">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <div className="inline-flex items-center px-4 py-2 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm font-medium mb-6">
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            FAQ
          </div>
          <h2 className="text-4xl lg:text-5xl font-bold text-gray-900 mb-6">
            Frequently Asked <span className="text-gradient">Questions</span>
          </h2>
          <p className="text-xl text-gray-600">
            Everything you need to know about Stuard AI
          </p>
        </div>

        <div className="space-y-4">
          {faqs.map((faq, index) => (
            <div
              key={index}
              className="bg-white border border-gray-200 rounded-xl overflow-hidden hover:shadow-md transition-shadow"
            >
              <button
                onClick={() => setOpenIndex(openIndex === index ? null : index)}
                className="w-full flex items-center justify-between p-6 text-left"
              >
                <span className="text-lg font-semibold text-gray-900 pr-8">
                  {faq.question}
                </span>
                <svg
                  className={`w-6 h-6 text-primary flex-shrink-0 transition-transform ${
                    openIndex === index ? 'transform rotate-180' : ''
                  }`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>
              {openIndex === index && (
                <div className="px-6 pb-6">
                  <p className="text-gray-600 leading-relaxed">{faq.answer}</p>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="mt-12 bg-gradient-to-br from-primary/5 to-secondary/5 rounded-2xl p-8 text-center border border-primary/20">
          <h3 className="text-xl font-bold text-gray-900 mb-3">
            Still have questions?
          </h3>
          <p className="text-gray-600 mb-6">
            Can&apos;t find the answer you&apos;re looking for? Our team is here to help.
          </p>
          <a
            href="mailto:support@stuard.ai"
            className="inline-flex items-center px-6 py-3 bg-primary text-white font-medium rounded-lg hover:bg-primary-600 transition-colors"
          >
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            Contact Support
          </a>
        </div>
      </div>
    </section>
  );
}

