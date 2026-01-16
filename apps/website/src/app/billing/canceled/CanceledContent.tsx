'use client';

import Link from 'next/link';

export default function CanceledContent() {
	return (
		<main className="min-h-screen pt-28 pb-20">
			<div className="max-w-3xl mx-auto px-4">
				<div className="bg-white rounded-2xl shadow p-8">
					<h1 className="text-3xl font-bold mb-2">Checkout canceled</h1>
					<p className="text-gray-600">No worries. You can resume checkout anytime.</p>
					<div className="mt-6 space-x-4">
						<Link href="/pricing" className="text-primary font-semibold">Back to pricing</Link>
						<Link href="/" className="text-gray-600">Home</Link>
					</div>
				</div>
			</div>
		</main>
	);
}







