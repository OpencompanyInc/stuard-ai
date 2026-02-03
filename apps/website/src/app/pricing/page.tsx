'use client';

import { Container } from '@/components/ui/Container';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import WaitlistForm from '@/components/waitlist/WaitlistForm';
import Link from 'next/link';
import { useAuthContext } from '@/components/providers/AuthProvider';
import { useMemo, useState } from 'react';

export default function PricingPage() {
  const { user } = useAuthContext();
  const [amount, setAmount] = useState(30);

  const payWhatYouWantProductId =
    process.env.NEXT_PUBLIC_POLAR_PRODUCT_PAYG_ID ||
    process.env.NEXT_PUBLIC_POLAR_PRODUCT_PRO_ID ||
    process.env.NEXT_PUBLIC_POLAR_PRODUCT_STARTER_ID;

  console.log('PricingPage auth status:', { user: !!user });

  const baseRate = 33;
  const tier = useMemo(() => {
    if (amount >= 100) {
      return { name: 'Whale', multiplier: 2.0, badge: '2.0x Credits', accent: 'text-amber-600' };
    }
    if (amount >= 30) {
      return { name: 'Pro', multiplier: 1.5, badge: '1.5x Credits', accent: 'text-indigo-600' };
    }
    return { name: 'Starter', multiplier: 1.0, badge: 'Standard Rate', accent: 'text-emerald-600' };
  }, [amount]);

  const credits = Math.floor(amount * baseRate * tier.multiplier);

  const handleCheckout = (e: React.MouseEvent) => {
    if (!user) {
      return;
    }
    e.preventDefault();

    if (!payWhatYouWantProductId) {
      console.error('Missing Polar product id for pay-what-you-want pricing');
      return;
    }

    const metadata = JSON.stringify({ userId: user.id });
    const qs = new URLSearchParams({
      products: payWhatYouWantProductId,
      customerEmail: user.email || '',
      customerExternalId: user.id,
      metadata,
      amount: String(Math.round(amount * 100)),
    });

    window.location.href = `/api/polar/checkout?${qs.toString()}`;
  };

  return (
    <>
      <section className="pt-32 pb-16">
        <Container className="text-center">
          <div className="inline-flex items-center px-4 py-2 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm font-medium mb-6">
            <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            Early Access Pricing
          </div>
          <h1 className="text-4xl lg:text-6xl font-bold mb-6 text-gray-900">Simple, Transparent Pricing</h1>
          <p className="text-xl lg:text-2xl mb-8 text-gray-600 max-w-3xl mx-auto">
            Join the waitlist for early access and get 10% off your first 3 months
          </p>
        </Container>
      </section>

      <section className="py-24">
        <Container>
          {/* Waitlist CTA */}
          <div className="max-w-3xl mx-auto mb-16 bg-white rounded-2xl shadow-xl p-8 border border-primary/20">
            <div className="text-center mb-8">
              <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
                </svg>
              </div>
              <h2 className="text-3xl font-bold text-gray-900 mb-3">
                Early Access Launch Offer
              </h2>
              <p className="text-xl text-gray-600 mb-6">
                Join the waitlist and get <strong className="text-primary">10% off your first 3 months</strong>
              </p>
            </div>
            <WaitlistForm variant="inline" showExtendedFields={true} />
            <div className="mt-6 flex items-center justify-center space-x-6 text-sm text-gray-600">
              <div className="flex items-center">
                <svg className="w-5 h-5 text-blue-600 mr-2" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                No credit card to join
              </div>
              <div className="flex items-center">
                <svg className="w-5 h-5 text-blue-600 mr-2" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                Cancel anytime
              </div>
            </div>
          </div>

          {/* Pricing Preview */}
          <div className="text-center mb-12">
            <h3 className="text-2xl font-bold text-gray-900 mb-4">Pay What You Want</h3>
            <p className="text-gray-600">The more you contribute, the cheaper your credits become.</p>
          </div>

          <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-[1.2fr_0.8fr] gap-8">
            <Card className="border border-gray-200 shadow-xl">
              <CardHeader>
                <CardTitle className="text-2xl">Pick your monthly amount</CardTitle>
                <CardDescription>
                  Drag the slider or tap a quick amount. Minimum $5. Credits roll over for 30 days.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-8">
                <div className="rounded-2xl border border-gray-200 bg-gradient-to-br from-white via-white to-indigo-50 p-6">
                  <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
                    <div>
                      <p className="text-sm text-gray-500">Your price</p>
                      <div className="text-4xl font-bold text-gray-900">${amount}</div>
                      <p className="text-sm text-gray-500">billed monthly</p>
                    </div>
                    <div className="text-left md:text-right">
                      <p className="text-sm text-gray-500">Tier status</p>
                      <div className={`text-2xl font-semibold ${tier.accent}`}>{tier.name}</div>
                      <div className="inline-flex items-center mt-1 rounded-full bg-black/90 px-3 py-1 text-xs font-semibold text-white">
                        {tier.badge}
                      </div>
                    </div>
                  </div>
                  <div className="mt-6">
                    <input
                      type="range"
                      min={5}
                      max={200}
                      step={1}
                      value={amount}
                      onChange={(event) => setAmount(Number(event.target.value))}
                      className="w-full accent-indigo-600"
                    />
                    <div className="flex justify-between text-xs text-gray-500 mt-2">
                      <span>$5</span>
                      <span>$30</span>
                      <span>$100</span>
                      <span>$200</span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-3">
                  {[10, 30, 60, 100].map((preset) => (
                    <button
                      key={preset}
                      onClick={() => setAmount(preset)}
                      className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${amount === preset ? 'border-indigo-600 bg-indigo-600 text-white shadow-md' : 'border-gray-200 text-gray-700 hover:border-indigo-200 hover:text-indigo-700'}`}
                    >
                      ${preset}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {[
                    {
                      title: 'Starter',
                      price: '$5 - $29',
                      bonus: 'Standard rate',
                      accent: 'text-emerald-600',
                    },
                    {
                      title: 'Pro',
                      price: '$30 - $99',
                      bonus: '1.5x credits (50% bonus)',
                      accent: 'text-indigo-600',
                    },
                    {
                      title: 'Whale',
                      price: '$100+',
                      bonus: '2.0x credits (double)',
                      accent: 'text-amber-600',
                    },
                  ].map((plan) => (
                    <div key={plan.title} className="rounded-2xl border border-gray-200 bg-white p-4">
                      <p className={`text-sm font-semibold ${plan.accent}`}>{plan.title}</p>
                      <p className="text-lg font-bold text-gray-900 mt-1">{plan.price}</p>
                      <p className="text-xs text-gray-500 mt-2">{plan.bonus}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="border border-gray-200 shadow-xl">
              <CardHeader>
                <CardTitle className="text-2xl">Your monthly credits</CardTitle>
                <CardDescription>Live estimate based on your amount.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="rounded-2xl bg-gray-900 p-6 text-white">
                  <p className="text-sm text-gray-300">Estimated credits</p>
                  <div className="text-4xl font-bold">{credits.toLocaleString()}</div>
                  <p className="text-sm text-gray-300 mt-2">${amount} × {baseRate} × {tier.multiplier}x</p>
                </div>
                <div className="space-y-3 text-sm text-gray-600">
                  <div className="flex items-center justify-between">
                    <span>Credit rollover</span>
                    <span className="font-semibold text-gray-900">30 days</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Upgrade anytime</span>
                    <span className="font-semibold text-gray-900">Instantly applied</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Models included</span>
                    <span className="font-semibold text-gray-900">All of them</span>
                  </div>
                </div>
                {user ? (
                  <button
                    onClick={handleCheckout}
                    className="w-full py-3 rounded-xl bg-primary text-white font-bold hover:opacity-90 transition-all shadow-sm active:scale-[0.98]"
                  >
                    Continue to checkout
                  </button>
                ) : (
                  <Link href="/signup" className="block w-full">
                    <button className="w-full py-3 rounded-xl bg-primary text-white font-bold hover:opacity-90 transition-all shadow-sm active:scale-[0.98]">
                      Create account to continue
                    </button>
                  </Link>
                )}
                <p className="text-xs text-gray-500 text-center">
                  Pay-what-you-want subscription. Minimum $5/month.
                </p>
              </CardContent>
            </Card>
          </div>

          {/* FAQ Section */}
          <div className="mt-12 max-w-3xl mx-auto">
            <h3 className="text-2xl font-bold text-gray-900 mb-8 text-center">Frequently Asked Questions</h3>
            <div className="space-y-6">
              <Card className="p-6">
                <h4 className="font-semibold text-gray-900 mb-2">How do credits work?</h4>
                <p className="text-gray-600">
                  Credits are used for AI interactions. Simple text messages use 1-2 credits, while complex tasks like document analysis use more. You can see the credit cost before each action.
                </p>
              </Card>
              <Card className="p-6">
                <h4 className="font-semibold text-gray-900 mb-2">What happens if I run out of credits?</h4>
                <p className="text-gray-600">
                  You can purchase extra credits starting at $5 for 500 credits, or upgrade to a higher plan for more monthly credits with rollover.
                </p>
              </Card>
              <Card className="p-6">
                <h4 className="font-semibold text-gray-900 mb-2">When will Stuard AI be available?</h4>
                <p className="text-gray-600">
                  We&apos;re targeting Q2 2025 for our official launch. Waitlist members will get early access and exclusive pricing.
                </p>
              </Card>
              <Card className="p-6">
                <h4 className="font-semibold text-gray-900 mb-2">How does the early access discount work?</h4>
                <p className="text-gray-600">
                  Waitlist members get 10% off their subscription for the first 3 months. After that, you&apos;ll pay the standard monthly rate.
                </p>
              </Card>
              <Card className="p-6">
                <h4 className="font-semibold text-gray-900 mb-2">Can I cancel anytime?</h4>
                <p className="text-gray-600">
                  Absolutely. No long-term contracts or commitments. Cancel your subscription anytime with one click.
                </p>
              </Card>
              <Card className="p-6">
                <h4 className="font-semibold text-gray-900 mb-2">Is there a free trial?</h4>
                <p className="text-gray-600">
                  Yes! All waitlist members will receive a 14-day free trial with 500 credits to experience Stuard AI.
                </p>
              </Card>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}
