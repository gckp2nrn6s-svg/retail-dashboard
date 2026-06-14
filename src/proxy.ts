import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";

export async function middleware(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  const { pathname } = req.nextUrl;

  if (!token) {
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
