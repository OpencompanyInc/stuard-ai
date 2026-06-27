export type PlanTier = 'free' | 'starter' | 'pro' | 'power';

export type CreditAnchor = {
  amount: number;
  credits: number;
};

export const CREDIT_ANCHORS: CreditAnchor[] = [
  { amount: 5, credits: 100 },
  { amount: 10, credits: 230 },
  { amount: 30, credits: 700 },
  { amount: 60, credits: 1400 },
  { amount: 100, credits: 2500 },
  { amount: 200, credits: 5000 },
];

export const MONTHLY_AMOUNT_MIN = 5;
export const MONTHLY_AMOUNT_MAX = 200;
export const MONTHLY_AMOUNT_MARKERS = [5, 30, 100, 200] as const;

export const TOP_UP_AMOUNTS = [5, 10, 25, 50] as const;

export function sliderMarkerPercent(
  amount: number,
  min: number = MONTHLY_AMOUNT_MIN,
  max: number = MONTHLY_AMOUNT_MAX,
): number {
  if (max <= min) return 0;
  const clamped = Math.min(max, Math.max(min, amount));
  return ((clamped - min) / (max - min)) * 100;
}

export function planTierFromAmount(amount: number): Exclude<PlanTier, 'free'> {
  if (amount >= 100) return 'power';
  if (amount >= 30) return 'pro';
  return 'starter';
}

export function snapCredits(amount: number, credits: number): number {
  const step = amount >= 100 ? 25 : amount >= 30 ? 10 : 5;
  return Math.round(credits / step) * step;
}

export function estimateCredits(amount: number): number {
  if (amount <= CREDIT_ANCHORS[0].amount) {
    return CREDIT_ANCHORS[0].credits;
  }

  for (let index = 1; index < CREDIT_ANCHORS.length; index += 1) {
    const previous = CREDIT_ANCHORS[index - 1];
    const current = CREDIT_ANCHORS[index];

    if (amount <= current.amount) {
      const ratio = (amount - previous.amount) / (current.amount - previous.amount);
      const interpolated = previous.credits + (current.credits - previous.credits) * ratio;
      return snapCredits(amount, interpolated);
    }
  }

  const previous = CREDIT_ANCHORS[CREDIT_ANCHORS.length - 2];
  const current = CREDIT_ANCHORS[CREDIT_ANCHORS.length - 1];
  const ratio = (amount - previous.amount) / (current.amount - previous.amount);
  const interpolated = previous.credits + (current.credits - previous.credits) * ratio;
  return snapCredits(amount, interpolated);
}

export function creditsFromAmountCents(amountCents: number): {
  amountDollars: number;
  plan: Exclude<PlanTier, 'free'>;
  credits: number;
} {
  const amountDollars = amountCents / 100;
  return {
    amountDollars,
    plan: planTierFromAmount(amountDollars),
    credits: estimateCredits(amountDollars),
  };
}