export type ShopifyStore = "samsonite" | "american-tourister";

interface ShopifyConfig {
  store: string; // full myshopify subdomain, e.g. "samsonite-eg-globosoft"
  token: string;
}

function getConfig(brand: ShopifyStore): ShopifyConfig {
  if (brand === "samsonite") {
    return {
      store: (process.env.SHOPIFY_SAM_STORE || process.env.SHOPIFY_SAMSONITE_STORE)!,
      token: (process.env.SHOPIFY_SAM_TOKEN || process.env.SHOPIFY_SAMSONITE_TOKEN)!,
    };
  }
  return {
    store: (process.env.SHOPIFY_AMT_STORE || process.env.SHOPIFY_AT_STORE)!,
    token: (process.env.SHOPIFY_AMT_TOKEN || process.env.SHOPIFY_AT_TOKEN)!,
  };
}

export async function shopifyFetch<T>(
  brand: ShopifyStore,
  endpoint: string
): Promise<T> {
  const { store, token } = getConfig(brand);
  const res = await fetch(`https://${store}.myshopify.com/admin/api/2024-01/${endpoint}`, {
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
    },
    next: { revalidate: 60 },
  });
  if (!res.ok) throw new Error(`Shopify ${brand}: ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export async function getShopifyOrders(brand: ShopifyStore, since?: string) {
  const params = since ? `?created_at_min=${since}&status=any&limit=250` : "?status=any&limit=250";
  const data = await shopifyFetch<{ orders: unknown[] }>(brand, `orders.json${params}`);
  return data.orders;
}

export async function getShopifyInventory(brand: ShopifyStore) {
  const data = await shopifyFetch<{ products: unknown[] }>(brand, "products.json?limit=250");
  return data.products;
}

interface ShopifyLineItem {
  sku: string;
  title: string;
  quantity: number;
  price: string; // price per unit in EGP
}

interface ShopifyOrder {
  created_at: string;
  total_price: string;
  currency: string;
  financial_status: string;
  line_items: ShopifyLineItem[];
}

// ── Live-but-safe dedup layer ────────────────────────────────────────────────
// "Live" without this means every dashboard load re-fetches the same orders many
// times (home + kpis×3 + sales, each × 2 brands × N pages) → ~70 Shopify calls
// per load, which trips Shopify's rate limit and is slow. This in-process layer
// fetches each brand+range at most once per SHORT window and shares the result
// across all routes loading together. Effectively live (≤30s) but ~6 calls/load.
//
// Railway runs a single long-lived Node process, so this module-level Map is
// shared across requests. A genuinely-empty or failed fetch is cached only
// briefly so a transient blip can't pin the dashboard to 0.
const ORDER_TTL_MS = 30_000;
const EMPTY_TTL_MS = 3_000;
const orderCache = new Map<string, { at: number; ttl: number; promise: Promise<ShopifyOrder[]> }>();

function fetchBrandOrders(brand: ShopifyStore, from: string, to: string): Promise<ShopifyOrder[]> {
  const key = `${brand}:${from}:${to}`;
  const hit = orderCache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.promise;

  const promise = fetchBrandOrdersUncached(brand, from, to);
  const entry = { at: Date.now(), ttl: ORDER_TTL_MS, promise };
  orderCache.set(key, entry);
  promise.then(
    // A genuinely-empty result (store had no orders) expires fast so it can't stick.
    orders => { if (orderCache.get(key) === entry && orders.length === 0) entry.ttl = EMPTY_TTL_MS; },
    // A FAILURE must not be cached — evict so the next call can retry, and so a
    // transient outage doesn't pin a rejected promise for the whole TTL.
    () => { if (orderCache.get(key) === entry) orderCache.delete(key); },
  );
  return promise;
}

// Throws on a genuine fetch/HTTP failure (logged), so callers can tell a real
// outage apart from a store that legitimately had zero orders. A swallowed []
// here is what made a Shopify outage look like "0 sales".
async function fetchBrandOrdersUncached(brand: ShopifyStore, from: string, to: string): Promise<ShopifyOrder[]> {
  const { store, token } = getConfig(brand);
  if (!store || !token) {
    console.error(`[shopify:${brand}] missing store/token env — cannot fetch orders`);
    throw new Error(`Shopify ${brand}: missing store/token`);
  }
  const fromDateTime = encodeURIComponent(`${from}T00:00:00+03:00`);
  const toDateTime   = encodeURIComponent(`${to}T23:59:59+03:00`);
  // Cursor-paginate via the Link header — Shopify caps each page at 250 orders.
  // Without this, any range with >250 orders was silently truncated (e.g. a
  // full month of one store ran ~1700 orders → ~80% of revenue dropped).
  let url: string | null =
    `https://${store}.myshopify.com/admin/api/2024-01/orders.json` +
    `?status=any&created_at_min=${fromDateTime}&created_at_max=${toDateTime}&limit=250`;
  const all: ShopifyOrder[] = [];
  let pages = 0, retries = 0;
  while (url && pages < 60) { // 60-page safety cap = 15,000 orders
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
        // Live revenue must reflect Shopify in real time. Caching here made the
        // dashboard show a stale snapshot (e.g. 54k while Shopify showed 68k).
        cache: "no-store",
      });
    } catch (e) {
      console.error(`[shopify:${brand}] network error: ${e instanceof Error ? e.message : e}`);
      throw e instanceof Error ? e : new Error(`Shopify ${brand}: network error`);
    }
    // Respect Shopify's rate limit instead of silently truncating (which would
    // reintroduce the undercount the pagination was added to fix).
    if (res.status === 429 && retries < 6) {
      const waitS = parseFloat(res.headers.get("retry-after") || "2");
      await new Promise(r => setTimeout(r, Math.max(1, waitS) * 1000));
      retries++;
      continue; // retry the same page
    }
    // Any other non-OK is a real failure (401 bad token, 5xx, etc.) — throw so it
    // surfaces as "offline" instead of returning a partial/empty list as if real.
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[shopify:${brand}] HTTP ${res.status} ${res.statusText}: ${body.slice(0, 200)}`);
      throw new Error(`Shopify ${brand}: HTTP ${res.status}`);
    }
    retries = 0;
    const data = await res.json() as { orders: ShopifyOrder[] };
    all.push(...(data.orders ?? []));
    const link = res.headers.get("link") || "";
    const next = link.match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : null;
    pages++;
  }
  return all.filter(o => o.financial_status !== "voided" && o.financial_status !== "refunded");
}

function ordersToRevenue(orders: ShopifyOrder[]): { egp: number; units: number } {
  let egp = 0, units = 0;
  for (const o of orders) {
    egp += parseFloat(o.total_price);
    units += o.line_items.reduce((s, i) => s + i.quantity, 0);
  }
  return { egp, units };
}

/** Shopify revenue + units grouped by Egypt-local calendar day (for daily drills).
 *  Keys are YYYY-MM-DD, aligned to NAV's [Date] (Egypt local, UTC+3). */
export async function getShopifyDailyRevenue(
  from: string, to: string
): Promise<Record<string, { egp: number; units: number }>> {
  let samOrders: ShopifyOrder[], amtOrders: ShopifyOrder[];
  try {
    [samOrders, amtOrders] = await Promise.all([
      fetchBrandOrders("samsonite", from, to),
      fetchBrandOrders("american-tourister", from, to),
    ]);
  } catch (e) {
    // Drill helper (no safeSource) — degrade to NAV-only, but log so it's visible.
    console.error(`[shopify:daily] failed, drill will show NAV only: ${e instanceof Error ? e.message : e}`);
    return {};
  }
  const byDay: Record<string, { egp: number; units: number }> = {};
  for (const o of [...samOrders, ...amtOrders]) {
    const day = new Date(new Date(o.created_at).getTime() + 3 * 3600 * 1000).toISOString().slice(0, 10);
    if (!byDay[day]) byDay[day] = { egp: 0, units: 0 };
    byDay[day].egp += parseFloat(o.total_price);
    byDay[day].units += o.line_items.reduce((s, i) => s + i.quantity, 0);
  }
  return byDay;
}

/** Fetch revenue + units for both Shopify stores combined. */
export async function getShopifyRevenue(from: string, to: string): Promise<{ egp: number; units: number }> {
  const [samOrders, amtOrders] = await Promise.all([
    fetchBrandOrders("samsonite", from, to),
    fetchBrandOrders("american-tourister", from, to),
  ]);
  const sam = ordersToRevenue(samOrders);
  const amt = ordersToRevenue(amtOrders);
  return { egp: sam.egp + amt.egp, units: sam.units + amt.units };
}

/** Fetch revenue + units split by brand. */
export async function getShopifyRevenueSplit(from: string, to: string): Promise<{
  samsonite: { egp: number; units: number };
  americanTourister: { egp: number; units: number };
}> {
  try {
    const [samOrders, amtOrders] = await Promise.all([
      fetchBrandOrders("samsonite", from, to),
      fetchBrandOrders("american-tourister", from, to),
    ]);
    return {
      samsonite:        ordersToRevenue(samOrders),
      americanTourister: ordersToRevenue(amtOrders),
    };
  } catch (e) {
    // Drill helper (no safeSource) — degrade to NAV-only, but log so it's visible.
    console.error(`[shopify:split] failed, drill will show NAV only: ${e instanceof Error ? e.message : e}`);
    return { samsonite: { egp: 0, units: 0 }, americanTourister: { egp: 0, units: 0 } };
  }
}

export interface ShopifyLineItemRow {
  sku: string;
  title: string;
  quantity: number;
  egp: number; // total for this line (price × qty)
}

/**
 * Combined fetch: revenue + units + line items in 2 API calls instead of 4.
 * Use on routes that need both the revenue total and per-item breakdown.
 */
export async function getShopifyRevenueAndItems(
  from: string,
  to: string
): Promise<{ egp: number; units: number; items: ShopifyLineItemRow[] }> {
  const [samOrders, amtOrders] = await Promise.all([
    fetchBrandOrders("samsonite", from, to),
    fetchBrandOrders("american-tourister", from, to),
  ]);
  const sam = ordersToRevenue(samOrders);
  const amt = ordersToRevenue(amtOrders);
  const items: ShopifyLineItemRow[] = [];
  for (const o of [...samOrders, ...amtOrders]) {
    for (const li of o.line_items) {
      if (!li.sku) continue;
      items.push({ sku: li.sku.trim(), title: li.title, quantity: li.quantity, egp: parseFloat(li.price) * li.quantity });
    }
  }
  return { egp: sam.egp + amt.egp, units: sam.units + amt.units, items };
}

/** Fetch all line items. Pass brand to restrict to one store ("samsonite" | "american-tourister"). */
export async function getShopifyLineItems(
  from: string,
  to: string,
  brand?: ShopifyStore
): Promise<ShopifyLineItemRow[]> {
  const brands: ShopifyStore[] = brand ? [brand] : ["samsonite", "american-tourister"];
  let orderGroups: ShopifyOrder[][];
  try {
    orderGroups = await Promise.all(brands.map(b => fetchBrandOrders(b, from, to)));
  } catch (e) {
    // Drill helper (no safeSource) — degrade to NAV-only items, but log so it's visible.
    console.error(`[shopify:lineItems] failed, drill will show NAV only: ${e instanceof Error ? e.message : e}`);
    return [];
  }
  const rows: ShopifyLineItemRow[] = [];
  for (const orders of orderGroups) {
    for (const o of orders) {
      for (const li of o.line_items) {
        if (!li.sku) continue;
        rows.push({
          sku:      li.sku.trim(),
          title:    li.title,
          quantity: li.quantity,
          egp:      parseFloat(li.price) * li.quantity,
        });
      }
    }
  }
  return rows;
}
