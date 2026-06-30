import { NextResponse } from "next/server";

export async function GET() {
  const token = process.env.META_ACCESS_TOKEN;
  const accountId = process.env.META_AD_ACCOUNT_ID;

  if (!token || !accountId) {
    return NextResponse.json({
      ok: false,
      issue: "missing_env",
      META_ACCESS_TOKEN: !!token,
      META_AD_ACCOUNT_ID: !!accountId,
    });
  }

  // Test 1: verify token is valid
  const meUrl = `https://graph.facebook.com/v21.0/me?access_token=${token}`;
  let meResult: any;
  try {
    const r = await fetch(meUrl, { cache: "no-store" });
    meResult = await r.json();
  } catch (e: any) {
    return NextResponse.json({ ok: false, issue: "fetch_failed", error: e.message });
  }

  if (meResult.error) {
    return NextResponse.json({ ok: false, issue: "token_invalid", meta_error: meResult.error });
  }

  // Test 2: verify account access
  const acctUrl = `https://graph.facebook.com/v21.0/${accountId}?fields=id,name,currency&access_token=${token}`;
  let acctResult: any;
  try {
    const r = await fetch(acctUrl, { cache: "no-store" });
    acctResult = await r.json();
  } catch (e: any) {
    return NextResponse.json({ ok: false, issue: "account_fetch_failed", error: e.message });
  }

  if (acctResult.error) {
    return NextResponse.json({ ok: false, issue: "account_access_denied", meta_error: acctResult.error, accountId });
  }

  return NextResponse.json({
    ok: true,
    account: { id: acctResult.id, name: acctResult.name, currency: acctResult.currency },
    token_user: meResult.name ?? meResult.id,
  });
}
