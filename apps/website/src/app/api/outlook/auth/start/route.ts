import { NextResponse } from "next/server";
import { buildAuthorizeUrl } from "@/lib/msftAuth";
import { generatePkcePair, randomState } from "@/lib/pkce";

export const runtime = "nodejs";

export async function GET() {
  const { code_verifier, code_challenge } = generatePkcePair();
  const state = randomState();
  const authorizeUrl = buildAuthorizeUrl(code_challenge, state);
  const res = NextResponse.redirect(authorizeUrl);
  const maxAge = 600;
  const secure = process.env.NODE_ENV === "production";
  res.cookies.set("outlook_pkce_verifier", code_verifier, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge
  });
  res.cookies.set("outlook_oauth_state", state, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge
  });
  return res;
}
