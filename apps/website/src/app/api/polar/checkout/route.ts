import { Checkout } from "@polar-sh/nextjs";
import { polar } from "@/lib/polar";
import { getBaseUrl } from "@/lib/stripe";
import { NextRequest, NextResponse } from "next/server";

export const GET = Checkout({
  accessToken: process.env.POLAR_ACCESS_TOKEN!,
  successUrl: process.env.POLAR_SUCCESS_URL || `${getBaseUrl()}/billing/success?checkout_id={CHECKOUT_ID}`,
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { productId, customerId } = body;

    if (!productId) {
      return NextResponse.json({ error: "Missing productId" }, { status: 400 });
    }

    const result = await polar.checkouts.create({
      products: [productId],
      successUrl: `${getBaseUrl()}/billing/success?checkout_id={CHECKOUT_ID}`,
      customerId: customerId || undefined,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Polar checkout error:", error);
    return NextResponse.json(
      { error: "Failed to create checkout session" },
      { status: 500 }
    );
  }
}
