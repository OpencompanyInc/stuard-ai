'use client';

import { Container } from '@/components/ui/Container';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
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

  const baseRate = 33;
  const tier = useMemo(() => {
    if (amount >= 100) {
      return { name: 'Whale', multiplier: 0.75, badge: 'Best Rate', accent: 'text-amber-600' };
    }
    if (amount >= 30) {
      return { name: 'Pro', multiplier: 0.70, badge: 'Boosted Rate', accent: 'text-indigo-600' };
    }
    return { name: 'Starter', multiplier: 0.65, badge: 'Standard Rate', accent: 'text-emerald-600' };
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
          <h1 className="text-4xl lg:text-6xl font-bold mb-6 text-gray-900">Simple, Transparent Pricing</h1>
          <p className="text-xl lg:text-2xl mb-4 text-gray-600 max-w-3xl mx-auto">
            Pay what you want. Start free, scale as you grow.
          </p>
        </Container>
      </section>

      <section className="pb-24">
        <Container>
          {/* Free Tier Highlight */}
          <div className="max-w-3xl mx-auto mb-16">
            <Card className="border border-gray-200 shadow-lg overflow-hidden">
              <div className="bg-gradient-to-r from-emerald-500 to-teal-500 px-8 py-6 text-white">
                <div className="flex items-center justify-between flex-wrap gap-4">
                  <div>
                    <h2 className="text-2xl font-bold">Free Plan</h2>
                    <p className="text-emerald-100 mt-1">Get started with no commitment</p>
                  </div>
                  <div className="text-right">
                    <div className="text-4xl font-bold">$0</div>
                    <p className="text-emerald-100 text-sm">forever</p>
                  </div>
                </div>
              </div>
              <CardContent className="p-8">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                  <div className="flex items-start gap-3">
                    <svg className="w-5 h-5 text-emerald-500 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <div>
                      <p className="font-medium text-gray-900">15 starter credits</p>
                      <p className="text-sm text-gray-500">Try before you buy</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <svg className="w-5 h-5 text-emerald-500 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <div>
                      <p className="font-medium text-gray-900">All AI models</p>
                      <p className="text-sm text-gray-500">Access every model</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <svg className="w-5 h-5 text-emerald-500 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <div>
                      <p className="font-medium text-gray-900">Desktop app</p>
                      <p className="text-sm text-gray-500">Full automation features</p>
                    </div>
                  </div>
                </div>
                {!user && (
                  <div className="mt-6 text-center">
                    <Link href="/signup">
                      <button className="px-8 py-3 rounded-xl bg-gray-900 text-white font-semibold hover:bg-black transition-colors">
                        Create Free Account
                      </button>
                    </Link>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Pricing Preview */}
          <div className="text-center mb-12">
            <h3 className="text-2xl font-bold text-gray-900 mb-4">Pay What You Want</h3>
            <p className="text-gray-600 max-w-2xl mx-auto">Your monthly payment funds a rolling credit ledger. Larger amounts unlock better credit multipliers.</p>
          </div>

          <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-[1.2fr_0.8fr] gap-8">
            <Card className="border border-gray-200 shadow-xl">
              <CardHeader>
                <CardTitle className="text-2xl">Pick your monthly amount</CardTitle>
                <CardDescription>
                  Drag the slider or tap a quick amount. Minimum $5. Unused credits roll over for 30 days.
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
                      bonus: 'Boosted rate — more credits per dollar',
                      accent: 'text-indigo-600',
                    },
                    {
                      title: 'Whale',
                      price: '$100+',
                      bonus: 'Best rate — maximum credits per dollar',
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
                  <p className="text-sm text-gray-300 mt-2">${amount}/mo · {tier.name} tier</p>
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
                      Create account to subscribe
                    </button>
                  </Link>
                )}
                <p className="text-xs text-gray-500 text-center">
                  Cancel anytime. No long-term contracts.
                </p>
              </CardContent>
            </Card>
          </div>

          {/* FAQ Section */}
          <div className="mt-16 max-w-3xl mx-auto">
            <h3 className="text-2xl font-bold text-gray-900 mb-8 text-center">Frequently Asked Questions</h3>
            <div className="space-y-4">
              <Card className="p-6">
                <h4 className="font-semibold text-gray-900 mb-2">How do credits work?</h4>
                <p className="text-gray-600">
                  Credits are stored in a ledger and used for AI interactions, workflow runs, and other usage. Your monthly subscription adds a recurring pool, and you can top up anytime from your billing dashboard.
                </p>
              </Card>
              <Card className="p-6">
                <h4 className="font-semibold text-gray-900 mb-2">What happens if I run out of credits?</h4>
                <p className="text-gray-600">
                  You can increase your monthly amount for a larger recurring allowance, or purchase add-on credits from your billing dashboard to keep going without waiting for renewal.
                </p>
              </Card>
              <Card className="p-6">
                <h4 className="font-semibold text-gray-900 mb-2">Is there a free plan?</h4>
                <p className="text-gray-600">
                  Yes. New accounts start on the free plan with about 15 starter credits so you can try Stuard AI before subscribing.
                </p>
              </Card>
              <Card className="p-6">
                <h4 className="font-semibold text-gray-900 mb-2">Can I cancel anytime?</h4>
                <p className="text-gray-600">
                  Absolutely. No long-term contracts or commitments. Cancel your subscription anytime with one click from your dashboard.
                </p>
              </Card>
              <Card className="p-6">
                <h4 className="font-semibold text-gray-900 mb-2">What AI models are included?</h4>
                <p className="text-gray-600">
                  All plans include access to every AI model available on the platform. Your credits work across all models — use whichever fits your task best.
                </p>
              </Card>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}
