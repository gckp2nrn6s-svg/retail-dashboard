import { NextRequest, NextResponse } from "next/server";
import { jwtDecrypt } from "jose";
import hkdf from "@panva/hkdf";

// ── Session validation ───────────────────────────────────────────────────────
// The previous proxy only checked that a session cookie EXISTED, not that it was
// valid — so anyone could read every protected route by setting the cookie to any
// value. We now cryptographically validate the next-auth v4 session JWT (a JWE),
// replicating next-auth's own decode exactly: HKDF-derive the A256GCM key from
// NEXTAUTH_SECRET (salt "", default info), then decrypt. A forged, tampered, or
// expired cookie fails to decrypt → not authenticated.
//
// We can't import `next-auth/jwt` here: its getToken/decode pull in uuid and the
// cookie helper (Node-only), which break the edge proxy runtime. jose and
// @panva/hkdf are edge-compatible and are exactly what next-auth uses internally.
async function isValidSession(token: string, secret: string): Promise<boolean> {
  try {
    const key = await hkdf("sha256", secret, "", "NextAuth.js Generated Encryption Key", 32);
    await jwtDecrypt(token, key, { clockTolerance: 15 });
    return true;
  } catch {
    return false; // unsigned/forged/expired/wrong-secret → reject
  }
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const secret = process.env.NEXTAUTH_SECRET;

  // next-auth v4 cookie names: __Secure- prefix on HTTPS, plain on HTTP.
  const sessionCookie =
    req.cookies.get("__Secure-next-auth.session-token")?.value ||
    req.cookies.get("next-auth.session-token")?.value;

  const authed = !!secret && !!sessionCookie && (await isValidSession(sessionCookie, secret));

  if (!authed) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/api/targets/:path*",
    "/api/home/:path*",
    "/api/kpis/:path*",
    "/api/sales/:path*",
    "/api/marketplace/:path*",
    "/api/live/:path*",
    "/api/drill/:path*",
    "/api/insights/:path*",
    "/api/stock/:path*",
    "/api/catalogue/:path*",
    "/api/ai/:path*",
    "/api/egypt/:path*",
    "/api/marketing/:path*",
  ],
};
