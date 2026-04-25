import CanceledContent from './CanceledContent';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Payment Canceled',
  description: 'The payment process was canceled.',
  robots: {
    index: false,
    follow: false,
  },
};

export default function BillingCanceledPage() {
  return <CanceledContent />;
}








