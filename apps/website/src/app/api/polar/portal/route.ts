import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { polar } from "@/lib/polar";

export const runtime = "nodejs";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function getAuthedUser(req: NextRequest) {
  const authHeader = req.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return null;

  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) return null;

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;

  return data.user;
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthedUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!user.email) {
      return NextResponse.json({ error: "Missing user email" }, { status: 400 });
    }

    const customers = await polar.customers.list({
      email: user.email,
    });

    const customer = customers.result.items[0];
    if (!customer?.id) {
      return NextResponse.json(
        { error: "No Polar customer found for this user" },
        { status: 404 }
      );
    }

    const session = await polar.customerSessions.create({
      customerId: customer.id,
    });

    if (!session.customerPortalUrl) {
      return NextResponse.json(
        { error: "No customer portal URL returned" },
        { status: 500 }
      );
    }

    return NextResponse.json({ url: session.customerPortalUrl });
  } catch (error) {
    const e: any = error;
    console.error("Polar portal error:", {
      statusCode: e?.statusCode,
      message: e?.message,
      body: e?.body,
    });
    return NextResponse.json(
      {
        error: "Failed to open customer portal",
        details: {
          statusCode: e?.statusCode,
          message: e?.message,
          body: e?.body,
        },
      },
      { status: 500 }
    );
  }
}
