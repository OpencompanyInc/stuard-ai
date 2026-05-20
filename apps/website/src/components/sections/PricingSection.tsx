'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';

import { useAuthContext } from '@/components/providers/AuthProvider';
import SectionReveal from '@/components/layout/SectionReveal';
import {
  MONTHLY_AMOUNT_MARKERS,
  MONTHLY_AMOUNT_MAX,
  MONTHLY_AMOUNT_MIN,
  estimateCredits,
  planTierFromAmount,
  sliderMarkerPercent,
} from '@/lib/creditPricing';

const PRESET_AMOUNTS = [5, 10, 30, 60, 100] as const;
const YEARLY_DISCOUNT = 0.2;

type BillingCycle = 'monthly' | 'yearly';

const PricingSection = () => {
  const { user } = useAuthContext();
  const [amount, setAmount] = useState(30);
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly');

  const payWhatYouWantProductId =
    process.env.NEXT_PUBLIC_POLAR_PRODUCT_PAYG_ID ||
    process.env.NEXT_PUBLIC_POLAR_PRODUCT_PRO_ID ||
    process.env.NEXT_PUBLIC_POLAR_PRODUCT_STARTER_ID;

  const tier = useMemo(() => {
    switch (planTierFromAmount(amount)) {
      case 'power':
        return { name: 'Whale', badge: 'Best Rate' };
      case 'pro':
        return { name: 'Pro', badge: 'Boosted Rate' };
      default:
        return { name: 'Starter', badge: 'Standard Rate' };
    }
  }, [amount]);

  const credits = useMemo(() => estimateCredits(amount), [amount]);

  const effectiveAmount =
    billingCycle === 'yearly'
      ? Math.round(amount * (1 - YEARLY_DISCOUNT) * 100) / 100
      : amount;

  const displayPrice =
    billingCycle === 'yearly'
      ? `$${effectiveAmount.toFixed(effectiveAmount % 1 === 0 ? 0 : 2)}`
      : `$${amount}`;

  const fillPercent = sliderMarkerPercent(amount);

  const handleCheckout = (e: React.MouseEvent) => {
    if (!user) {
      return;
    }
    e.preventDefault();

    if (!payWhatYouWantProductId) {
      console.error('Missing Polar product id for pay-what-you-want pricing');
      return;
    }

    const chargeAmount =
      billingCycle === 'yearly' ? effectiveAmount * 12 : amount;

    const metadata = JSON.stringify({
      userId: user.id,
      billingCycle,
      monthlyAmount: amount,
    });
    const qs = new URLSearchParams({
      products: payWhatYouWantProductId,
      customerEmail: user.email || '',
      customerExternalId: user.id,
      metadata,
      amount: String(Math.round(chargeAmount * 100)),
    });

    window.location.href = `/api/polar/checkout?${qs.toString()}`;
  };

  return (
    <section
      id="pricing"
      className="relative flex min-h-screen flex-col items-center bg-[#0A0A0B] px-4 py-16 text-white sm:py-20 lg:py-24"
    >
      <div className="mx-auto flex w-full max-w-[1330px] flex-col items-center gap-10 sm:gap-12 lg:gap-[50px]">
        {/* Header */}
        <SectionReveal className="flex w-full max-w-[966px] flex-col items-center gap-5 sm:gap-7 lg:gap-9 text-center">
          <p className="text-[14px] sm:text-[16px] lg:text-[20px] font-semibold leading-tight tracking-wider text-[#FF383C]">
            PRICING
          </p>

          <h2 className="text-[22px] leading-[1.2] sm:text-[26px] sm:leading-[1.2] lg:text-[32px] lg:leading-[40px] font-normal text-white">
            Pay what fits. Cancel anytime.
          </h2>

          <p className="max-w-[942px] text-[14px] leading-[20px] sm:text-[16px] sm:leading-[24px] lg:text-[20px] lg:leading-[28px] font-normal text-[#E5E5E5]">
            Start free. Upgrade only when you outgrow the free tier.
          </p>
        </SectionReveal>

        {/* Billing toggle */}
        <SectionReveal delay={0.1} className="flex items-start rounded-full border border-[#262626] p-[10px]">
          <button
            type="button"
            onClick={() => setBillingCycle('monthly')}
            aria-pressed={billingCycle === 'monthly'}
            className={`inline-flex h-[49px] min-w-[113px] items-center justify-center rounded-full px-5 text-[16px] sm:text-[18px] lg:text-[19px] font-medium capitalize transition-colors ${
              billingCycle === 'monthly'
                ? 'bg-[#D31519] text-white'
                : 'text-white hover:bg-white/5'
            }`}
          >
            Monthly
          </button>
          <button
            type="button"
            onClick={() => setBillingCycle('yearly')}
            aria-pressed={billingCycle === 'yearly'}
            className={`inline-flex h-[49px] min-w-[94px] items-center justify-center rounded-full px-5 text-[16px] sm:text-[18px] lg:text-[19px] font-medium capitalize transition-colors ${
              billingCycle === 'yearly'
                ? 'bg-[#D31519] text-white'
                : 'text-white hover:bg-white/5'
            }`}
          >
            Yearly
          </button>
        </SectionReveal>

        {/* Two-card layout */}
        <SectionReveal delay={0.15} className="grid w-full grid-cols-1 items-stretch gap-6 lg:grid-cols-[800fr_500fr] lg:gap-[30px]">
          {/* Left card: amount picker */}
          <div className="flex flex-col items-stretch gap-[21px] rounded-[20px] border border-[#171717] bg-[rgba(15,15,15,0.7)] p-6 sm:p-8 lg:px-[25px] lg:py-[50px]">
            <div className="flex flex-col items-start gap-5">
              <h3 className="text-[28px] leading-[1.12] sm:text-[32px] lg:text-[40px] lg:leading-[45px] font-medium text-white">
                Pick your monthly amount
              </h3>
              <p className="text-[15px] leading-[22px] sm:text-[17px] sm:leading-[26px] lg:text-[20px] lg:leading-[30px] font-normal text-[#E5E5E5]">
                Drag the slider or tap a quick amount. Minimum $5. Credits round to clean bundle sizes, and unused credits roll over for 30 days.
              </p>
            </div>

            <div className="flex flex-col items-stretch gap-8 lg:gap-10">
              {/* Slider card */}
              <div className="rounded-[20px] border border-[#171717] bg-[linear-gradient(180deg,rgba(255,56,60,0)_0%,rgba(255,56,60,0.03)_100%)] px-5 py-6 sm:p-7 lg:px-[22px] lg:py-[15px]">
                <div className="flex flex-row items-start justify-between gap-6 lg:items-center">
                  <div className="flex flex-col items-start">
                    <p className="text-[15px] sm:text-[17px] lg:text-[19px] font-medium leading-[28px] text-[#737373]">
                      Your Price
                    </p>
                    <div className="text-[40px] leading-[1.1] sm:text-[44px] lg:text-[50px] lg:leading-[68px] font-semibold text-[#E5E5E5]">
                      {displayPrice}
                    </div>
                    <p className="text-[15px] sm:text-[17px] lg:text-[19px] font-medium leading-[28px] text-[#737373]">
                      billed {billingCycle === 'yearly' ? 'yearly' : 'monthly'}
                    </p>
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    <p className="text-[15px] sm:text-[17px] lg:text-[19px] font-medium leading-[28px] text-[#737373]">
                      Your Price
                    </p>
                    <div className="text-[40px] leading-[1.1] sm:text-[44px] lg:text-[50px] lg:leading-[68px] font-medium text-[#FF383C]">
                      {tier.name}
                    </div>
                    <span className="inline-flex h-[39px] items-center justify-center rounded-full bg-[#080808] px-5 text-[14px] sm:text-[16px] lg:text-[19px] font-medium capitalize text-[#D4D4D4]">
                      {tier.badge}
                    </span>
                  </div>
                </div>

                {/* Slider */}
                <div className="mt-6 lg:mt-10">
                  <div className="relative h-[10px] w-full rounded-full border border-[#262626] bg-[rgba(217,217,217,0.05)]">
                    <div
                      className="pointer-events-none absolute inset-y-0 left-0 rounded-full bg-[#D31519]"
                      style={{ width: `${fillPercent}%` }}
                      aria-hidden="true"
                    />
                    <input
                      type="range"
                      min={MONTHLY_AMOUNT_MIN}
                      max={MONTHLY_AMOUNT_MAX}
                      step={1}
                      value={amount}
                      onChange={(event) => setAmount(Number(event.target.value))}
                      aria-label="Monthly amount"
                      className="pricing-slider absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent"
                    />
                  </div>
                  <div className="relative mt-3 h-6 text-[13px] sm:text-[15px] lg:text-[19px] font-medium text-[#A3A3A3]">
                    {MONTHLY_AMOUNT_MARKERS.map((marker) => {
                      const percent = sliderMarkerPercent(marker);
                      const translateX =
                        percent === 0
                          ? '0%'
                          : percent === 100
                            ? '-100%'
                            : '-50%';
                      return (
                        <span
                          key={marker}
                          className="absolute top-0 whitespace-nowrap"
                          style={{
                            left: `${percent}%`,
                            transform: `translateX(${translateX})`,
                          }}
                        >
                          ${marker}
                        </span>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Preset amount buttons */}
              <div className="flex flex-wrap gap-2 sm:gap-[10px]">
                {PRESET_AMOUNTS.map((preset) => {
                  const active = amount === preset;
                  return (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setAmount(preset)}
                      aria-pressed={active}
                      className={`inline-flex h-[49px] items-center justify-center rounded-full px-5 text-[14px] sm:text-[16px] lg:text-[19px] font-medium capitalize transition-colors ${
                        active
                          ? 'bg-[#D31519] text-white'
                          : 'border border-[#121212] text-[#D4D4D4] hover:border-[#262626] hover:text-white'
                      }`}
                    >
                      ${preset}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right card: credit estimate + checkout */}
          <div className="relative flex flex-col gap-6 rounded-[20px] border border-[#FF383C] bg-[rgba(255,56,60,0.05)] p-6 sm:p-8 lg:p-[30px]">
            <div className="flex flex-col items-start gap-1">
              <h3 className="text-[16px] sm:text-[18px] lg:text-[20px] font-semibold leading-[27px] text-white">
                Your monthly credits
              </h3>
              <p className="text-[15px] sm:text-[17px] lg:text-[20px] font-normal leading-[28px] text-[#E5E5E5]">
                Live estimate based on your amount
              </p>
            </div>

            {/* Credits highlight */}
            <div className="flex w-full items-center justify-between rounded-[12px] border-[0.6px] border-[#171717] bg-[rgba(15,15,15,0.7)] px-4 py-3 lg:px-[13px] lg:py-[9px]">
              <div className="flex flex-col items-start">
                <p className="text-[11px] lg:text-[11.52px] font-medium leading-[17px] text-[#D4D4D4]">
                  Estimated credits
                </p>
                <div className="text-[26px] sm:text-[28px] lg:text-[30px] lg:leading-[41px] font-bold text-[#E5E5E5]">
                  {credits.toLocaleString()}
                </div>
                <p className="text-[11px] lg:text-[11.52px] font-medium leading-[17px] text-[#D4D4D4]">
                  ${amount}/mo {tier.name} tier
                </p>
              </div>
            </div>

            {/* Detail rows */}
            <div className="flex flex-col gap-5 lg:gap-[25px]">
              <DetailRow label="Credit rollover" value="30 days" />
              <DetailRow label="Upgrade anytime" value="Instant" />
              <DetailRow label="Models included" value="All models" />
            </div>

            {/* CTA */}
            <div className="mt-2 flex flex-col items-stretch gap-4">
              {user ? (
                <button
                  type="button"
                  onClick={handleCheckout}
                  className="inline-flex h-[59px] w-full items-center justify-center rounded-[15px] bg-[#FF383C] px-5 text-[16px] sm:text-[18px] lg:text-[19px] font-semibold leading-7 text-white transition-opacity hover:opacity-90 active:scale-[0.98]"
                >
                  Continue to checkout
                </button>
              ) : (
                <Link href="/signup" className="block w-full">
                  <button
                    type="button"
                    className="inline-flex h-[59px] w-full items-center justify-center rounded-[15px] bg-[#FF383C] px-5 text-[16px] sm:text-[18px] lg:text-[19px] font-semibold leading-7 text-white transition-opacity hover:opacity-90 active:scale-[0.98]"
                  >
                    Create account to continue
                  </button>
                </Link>
              )}
              <p className="text-center text-[14px] sm:text-[16px] lg:text-[18px] font-light leading-6 text-white">
                Cancel anytime. No long-term contracts.
              </p>
            </div>
          </div>
        </SectionReveal>
      </div>
    </section>
  );
};

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex w-full items-center justify-between gap-4">
      <span className="text-[14px] sm:text-[16px] lg:text-[18px] font-medium leading-[17px] text-[#D4D4D4]">
        {label}
      </span>
      <span className="text-[14px] sm:text-[16px] lg:text-[18px] font-bold leading-[17px] text-[#D4D4D4]">
        {value}
      </span>
    </div>
  );
}

export default PricingSection;
