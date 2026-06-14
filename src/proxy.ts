import { NextRequest, NextResponse } from "next/server";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // next-auth v4 sets these cookie names on HTTPS
  const sessionCookie =
    req.cookies.get("__Secure-next-auth.session-token")?.value ||
    req.cookies.get("next-auth.session-token")?.value;

  if (!sessionCookie) {
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
    "/api/drill/:path*",
    "/api/insights/:path*",
    "/api/stock/:path*",
    "/api/catalogue/:path*",
    "/api/ai/:path*",
    "/api/egypt/:path*",
    "/api/marketing/:path*",
  ],
};
