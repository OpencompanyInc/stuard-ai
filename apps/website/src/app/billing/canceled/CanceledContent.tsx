'use client';

import Link from 'next/link';

export default function CanceledContent() {
	return (
		<main className="min-h-screen bg-[#0A0A0B] pt-28 pb-20 text-white">
			<div className="max-w-3xl mx-auto px-4">
				<div className="bg-[#111111] rounded-2xl border border-white/10 p-8">
					<h1 className="text-3xl font-bold mb-2 text-white">Checkout canceled</h1>
					<p className="text-[#A3A3A3]">No worries. You can resume checkout anytime.</p>
					<div className="mt-6 space-x-4">
						<Link href="/pricing" className="text-[#FF6B6E] font-semibold">Back to pricing</Link>
						<Link href="/" className="text-[#A3A3A3]">Home</Link>
					</div>
				</div>
			</div>
		</main>
	);
}







