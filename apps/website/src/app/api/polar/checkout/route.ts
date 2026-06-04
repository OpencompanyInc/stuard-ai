import { NextRequest, NextResponse } from "next/server";
import { polar, POLAR_SERVER } from "@/lib/polar";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const products = url.searchParams.getAll("products");

  try {
    if (!process.env.POLAR_ACCESS_TOKEN) {
      console.error("Missing POLAR_ACCESS_TOKEN");
      return NextResponse.json({ error: "Missing POLAR_ACCESS_TOKEN" }, { status: 500 });
    }

    if (products.length === 0) {
      console.error("No products found in URL query params");
      return NextResponse.json({ error: "Missing products" }, { status: 400 });
    }

    const origin = process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin;
    const amountParam = url.searchParams.get("amount");
    const amount = amountParam ? Number(amountParam) : undefined;

    const result = await polar.checkouts.create({
      products,
      customerId: url.searchParams.get("customerId") || undefined,
      customerEmail: url.searchParams.get("customerEmail") || undefined,
      externalCustomerId: url.searchParams.get("customerExternalId") || undefined,
      metadata: url.searchParams.has("metadata")
        ? JSON.parse(url.searchParams.get("metadata")!)
        : undefined,
      amount: Number.isFinite(amount) ? amount : undefined,
      successUrl: `${origin}/billing/success?checkout_id={CHECKOUT_ID}`,
      returnUrl: origin,
    });

    console.log("Polar checkout created");
    return NextResponse.redirect(result.url);
  } catch (error: any) {
    // undici reports real network failures as "fetch failed" and stashes the
    // actual reason (ENOTFOUND / ECONNREFUSED / ETIMEDOUT / cert) on .cause.
    const cause = error?.cause?.code || error?.cause?.message || null;
    console.error("Polar checkout failed", {
      server: POLAR_SERVER,
      statusCode: error?.statusCode,
      message: error?.message,
      cause,
      body: error?.body,
    });

    return NextResponse.json(
      {
        error: "Polar checkout failed",
        message: cause ? `${error?.message} (${cause})` : error?.message,
        details: error?.body,
      },
      { status: 500 },
    );
  }
}
