import { NextRequest, NextResponse } from "next/server";
import { Polar } from "@polar-sh/sdk";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const accessToken = process.env.POLAR_ACCESS_TOKEN || "";
  const mode = process.env.POLAR_MODE === "production" ? "production" : "sandbox";
  const products = url.searchParams.getAll("products");

  try {
    if (!accessToken) {
      console.error("Missing POLAR_ACCESS_TOKEN");
      return NextResponse.json({ error: "Missing POLAR_ACCESS_TOKEN" }, { status: 500 });
    }

    const polar = new Polar({
      accessToken: accessToken.trim(),
      server: mode,
    });

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
    console.error("Polar checkout failed", {
      statusCode: error?.statusCode,
      message: error?.message,
      body: error?.body,
    });

    return NextResponse.json(
      {
        error: "Polar checkout failed",
        message: error?.message,
        details: error?.body,
      },
      { status: 500 },
    );
  }
}
