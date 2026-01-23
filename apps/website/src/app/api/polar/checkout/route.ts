import { NextRequest, NextResponse } from "next/server";
import { Polar } from "@polar-sh/sdk";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);

  // --- DEBUGGING SECTION ---
  const accessToken = process.env.POLAR_ACCESS_TOKEN || "";
  const mode = process.env.POLAR_MODE === "production" ? "production" : "sandbox";
  
  console.log("=========================================");
  console.log("POLAR DEBUGGER");
  console.log("-----------------------------------------");
  console.log("1. Environment Mode:", mode);
  console.log("2. Access Token:", `"${accessToken}"`); // Quotes help see if there is accidental whitespace
  console.log("3. Request URL:", req.url);
  
  // Get products
  const products = url.searchParams.getAll("products");
  console.log("4. Product IDs:", products);
  // =========================================

  try {
    if (!accessToken) {
      console.error("❌ Error: Missing POLAR_ACCESS_TOKEN in .env");
      return NextResponse.json({ error: "Missing POLAR_ACCESS_TOKEN" }, { status: 500 });
    }

    // Initialize SDK
    const polar = new Polar({
      accessToken: accessToken.trim(), // trimming to prevent copy-paste whitespace errors
      server: mode,
    });

    if (products.length === 0) {
      console.error("❌ Error: No products found in URL query params");
      return NextResponse.json({ error: "Missing products" }, { status: 400 });
    }

    // Determine return URLs
    const origin = req.headers.get("origin") || 
                   process.env.NEXT_PUBLIC_SITE_URL || 
                   "http://localhost:3000";

    console.log("5. Attempting to create checkout session...");

    // Create Checkout
    const result = await polar.checkouts.create({
      products,
      customerId: url.searchParams.get("customerId") || undefined,
      customerEmail: url.searchParams.get("customerEmail") || undefined,
      externalCustomerId: url.searchParams.get("customerExternalId") || undefined,
      metadata: url.searchParams.has("metadata") 
        ? JSON.parse(url.searchParams.get("metadata")!) 
        : undefined,
      successUrl: `${origin}/billing/success?checkout_id={CHECKOUT_ID}`,
      returnUrl: origin,
    });

    console.log("✅ Checkout created! Redirecting to:", result.url);
    console.log("=========================================");

    // Perform the redirect
    return NextResponse.redirect(result.url);

  } catch (error: any) {
    console.error("❌ POLAR API CRASHED");
    console.error("Status Code:", error?.statusCode);
    console.error("Error Message:", error?.message);
    console.error("Error Body (The real reason):", JSON.stringify(error?.body, null, 2));
    console.log("=========================================");

    return NextResponse.json(
      {
        error: "Polar checkout failed",
        message: error?.message,
        details: error?.body,
      },
      { status: 500 }
    );
  }
}