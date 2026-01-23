'use client';

import { Container } from '@/components/ui/Container';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import WaitlistForm from '@/components/waitlist/WaitlistForm';
import Link from 'next/link';
import { useAuthContext } from '@/components/providers/AuthProvider';
import { useRouter } from 'next/navigation';

export default function PricingPage() {
  const { user, loading } = useAuthContext();
  const router = useRouter();

  console.log('PricingPage auth status:', { user: !!user, loading });

  const handleGetStarted = async (e: React.MouseEvent, productId: string | undefined, planName: string) => {
    if (user) {
      e.preventDefault();

      if (!productId) {
        if (planName.toLowerCase() === 'free') {
          router.push('/dashboard');
          return;
        }
        console.error('Missing Polar product id for plan', planName);
        return;
      }

      const metadata = JSON.stringify({ userId: user.id });
      const qs = new URLSearchParams({
        products: productId,
        customerEmail: user.email || '',
        customerExternalId: user.id,
        metadata,
      });

      window.location.href = `/api/polar/checkout?${qs.toString()}`;
    }
  };
  // 65% of plan price goes to usage budget. 100 credits per $1.
  // Free Trial: $0.50 one-time budget (50 credits), Mini models only
  // Starter: $10/mo, $6.50 budget (650 credits), All models
  // Pro: $45/mo, $29.25 budget (2,925 credits), All models
  // Power: $100/mo, $65 budget (6,500 credits), All models
  // BYOK: Free, unlimited, All models
  const plans = [
    {
      name: 'Free',
      productId: process.env.NEXT_PUBLIC_POLAR_PRODUCT_FREE_ID || undefined,
      price: '$0',
      period: '',
      description: 'Get started with Stuard AI',
      features: [
        '$0.50 trial credit included',
        'Unlimited usage with BYOK',
        'Voice & text interaction',
        'Local data storage',
      ],
      credits: '50 + Unlimited (BYOK)',
      badge: 'Trial + BYOK',
    },
    {
      name: 'Starter',
      productId: process.env.NEXT_PUBLIC_POLAR_PRODUCT_STARTER_ID,
      price: '$10',
      period: '/month',
      description: 'For everyday AI assistance',
      features: [
        '≈650 credits per month',
        'All AI models included',
        'Voice & text interaction',
        'Priority support',
      ],
      credits: '≈650',
    },
    {
      name: 'Pro',
      productId: process.env.NEXT_PUBLIC_POLAR_PRODUCT_PRO_ID,
      price: '$45',
      period: '/month',
      description: 'For power users',
      features: [
        '≈2,925 credits per month',
        'All AI models included',
        'Advanced document processing',
        'Custom workflows',
      ],
      popular: true,
      credits: '≈2,925',
    },
    {
      name: 'Power',
      productId: process.env.NEXT_PUBLIC_POLAR_PRODUCT_POWER_ID,
      price: '$100',
      period: '/month',
      description: 'Maximum capabilities',
      features: [
        '≈6,500 credits per month',
        'All AI models included',
        'Fastest processing',
        'Best support response times',
      ],
      credits: '≈6,500',
    },
  ];

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
            <h3 className="text-2xl font-bold text-gray-900 mb-4">Pricing Plans</h3>
            <p className="text-gray-600">Simple pricing that scales with you</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 max-w-6xl mx-auto justify-center">
            {plans.map((plan) => (
              <Card
                key={plan.name}
                className={`relative ${plan.popular ? 'border-2 border-primary shadow-xl' : 'border border-gray-200'}`}
              >
                {plan.popular && (
                  <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
                    <span className="bg-primary text-white px-4 py-1 rounded-full text-sm font-semibold shadow-lg">
                      Most Popular
                    </span>
                  </div>
                )}
                {'badge' in plan && plan.badge && (
                  <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
                    <span className="bg-gray-700 text-white px-4 py-1 rounded-full text-sm font-semibold shadow-lg">
                      {plan.badge}
                    </span>
                  </div>
                )}
                <CardHeader className="text-center">
                  <CardTitle className="text-xl">{plan.name}</CardTitle>
                  <CardDescription className="text-gray-600 text-sm">{plan.description}</CardDescription>
                  <div className="mt-4">
                    <span className={`text-3xl font-bold ${plan.popular ? 'text-primary' : 'text-gray-900'}`}>
                      {plan.price}
                    </span>
                    {plan.period && <span className="text-gray-600">{plan.period}</span>}
                    <p className="text-xs text-gray-500 mt-1">
                      {plan.credits} credits{plan.period ? '/mo' : ''}
                    </p>
                  </div>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 mb-6">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-center text-gray-700 text-sm">
                        <svg
                          className="w-4 h-4 text-green-500 mr-2 flex-shrink-0"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                  <Link href="/signup" onClick={(e) => handleGetStarted(e, plan.productId, plan.name)} className="block w-full">
                    <button className="w-full py-3 rounded-xl bg-primary text-white font-bold hover:opacity-90 transition-all shadow-sm active:scale-[0.98]">
                      {user ? 'Upgrade Now' : 'Get Started'}
                    </button>
                  </Link>
                </CardContent>
              </Card>
            ))}
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
