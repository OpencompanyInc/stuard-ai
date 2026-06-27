import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForToken } from "@/lib/msftAuth";

export const runtime = "nodejs";

function clearCookie(res: NextResponse, name: string) {
  const secure = process.env.NODE_ENV === "production";
  res.cookies.set(name, "", { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 0 });
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const err = url.searchParams.get("error");
  if (err) {
    const errorDescription = url.searchParams.get("error_description") || "Unknown error";
    return NextResponse.json({ ok: false, error: err, errorDescription }, { status: 400 });
  }
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const savedState = req.cookies.get("outlook_oauth_state")?.value;
  const codeVerifier = req.cookies.get("outlook_pkce_verifier")?.value;
  if (!code || !state || !savedState || state !== savedState || !codeVerifier) {
    const bad = NextResponse.json({ ok: false, error: "invalid_request" }, { status: 400 });
    clearCookie(bad, "outlook_oauth_state");
    clearCookie(bad, "outlook_pkce_verifier");
    return bad;
  }
  try {
    const tokens = await exchangeCodeForToken({ code, codeVerifier });
    const meRes = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    });
    const me = meRes.ok ? await meRes.json() : null;
    const ok = NextResponse.json({ ok: true, connected: true, me });
    clearCookie(ok, "outlook_oauth_state");
    clearCookie(ok, "outlook_pkce_verifier");
    return ok;
  } catch (e: unknown) {
    const errorMessage = e instanceof Error ? e.message : "token_exchange_failed";
    const resp = NextResponse.json({ ok: false, error: errorMessage }, { status: 500 });
    clearCookie(resp, "outlook_oauth_state");
    clearCookie(resp, "outlook_pkce_verifier");
    return resp;
  }
}
