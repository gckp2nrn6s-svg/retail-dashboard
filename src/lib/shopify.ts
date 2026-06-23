import { query } from "@/lib/db";
import { todayCairo } from "@/lib/dates";

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
  updated_at?: string;          // bumped on any change incl. refunds (used to catch late returns)
  total_price: string;          // original order total
  current_total_price?: string; // total NET of refunds — the correct revenue figure
  currency: string;
  financial_status: string;
  line_items: ShopifyLineItem[];
}

// Net order revenue: current_total_price (after refunds) when present, else total_price.
// Returns here are tracked via the refunds array (current_total_price < total_price)
// while status stays pending/paid — so total_price alone overcounts refunded orders.
function netTotal(o: ShopifyOrder): number {
  return parseFloat(o.current_total_price ?? o.total_price);
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
    egp += netTotal(o);
    units += o.line_items.reduce((s, i) => s + i.quantity, 0);
  }
  return { egp, units };
}

// ══ Daily revenue rollup (perf) ═══════════════════════════════════════════════
// Long ranges were slow because each load paginated thousands of live orders
// (1 month ≈ 14 pages/13s; a year ≈ 80 pages/60s → request timeout). The rollup
// stores per-day, per-brand NET revenue (current_total_price) in Postgres, so a
// range read becomes one fast SUM instead of thousands of API calls.
//   • "today" is always fetched LIVE (1 day, fast) → real-time.
//   • the trailing 30 days are recomputed at most every 15 min — the window where
//     refunds still land (measured max lag 17d), so a late return lowers its
//     original day.
//   • days older than 30 are frozen (computed once, cached forever).
// Seed history once: scripts/backfill-shopify-rollup.mjs. Any rollup error falls
// back to the live path, so this can only speed reads up — never break them.
const ROLLUP_SETTLE_DAYS = 30;
const ROLLUP_TTL_MIN = 15;
const DAY_MS = 86400000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const egDay = (iso: string) => isoDay(new Date(new Date(iso).getTime() + 3 * 3600 * 1000));
const addDays = (day: string, n: number) => isoDay(new Date(Date.parse(day + "T00:00:00Z") + n * DAY_MS));

let rollupTableReady = false;
async function ensureRollupTable(): Promise<void> {
  if (rollupTableReady) return;
  await query(`CREATE TABLE IF NOT EXISTS shopify_daily (
    sale_date date NOT NULL,
    brand     text NOT NULL,
    egp       numeric(14,2) NOT NULL DEFAULT 0,
    units     integer NOT NULL DEFAULT 0,
    built_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (sale_date, brand)
  )`);
  rollupTableReady = true;
}

const rollupRefreshInFlight = new Map<string, Promise<void>>();

/** Fetch [from,to] live and (re)write a complete day×brand grid into shopify_daily. */
async function refreshShopifyDaily(from: string, to: string): Promise<void> {
  const key = `${from}:${to}`;
  const inflight = rollupRefreshInFlight.get(key);
  if (inflight) return inflight;
  const run = (async () => {
    await ensureRollupTable();
    const brands: ShopifyStore[] = ["samsonite", "american-tourister"];
    const agg: Record<string, { egp: number; units: number }> = {};
    for (const brand of brands) {
      const orders = await fetchBrandOrders(brand, from, to);
      for (const o of orders) {
        const k = `${egDay(o.created_at)}|${brand}`;
        (agg[k] ??= { egp: 0, units: 0 });
        agg[k].egp += netTotal(o);
        agg[k].units += o.line_items.reduce((s, i) => s + i.quantity, 0);
      }
    }
    // Complete grid so empty days persist as 0 (freshness trackable, not "missing").
    const tuples: string[] = []; const vals: (string | number)[] = []; let i = 1;
    for (let day = from; day <= to; day = addDays(day, 1)) {
      for (const brand of brands) {
        const a = agg[`${day}|${brand}`] ?? { egp: 0, units: 0 };
        tuples.push(`($${i++},$${i++},$${i++},$${i++},now())`);
        vals.push(day, brand, Math.round(a.egp * 100) / 100, Math.round(a.units));
      }
    }
    if (tuples.length) {
      await query(
        `INSERT INTO shopify_daily (sale_date,brand,egp,units,built_at) VALUES ${tuples.join(",")}
         ON CONFLICT (sale_date,brand) DO UPDATE SET egp=EXCLUDED.egp, units=EXCLUDED.units, built_at=now()`,
        vals,
      );
    }
  })().finally(() => rollupRefreshInFlight.delete(key));
  rollupRefreshInFlight.set(key, run);
  return run;
}

/** Ensure the rollup covers historical [from,to] (≤ yesterday): block-backfill any
 *  missing frozen days; refresh the trailing 30d if stale (async when it already has
 *  data, so steady-state reads never block). */
async function ensureRollupCovered(from: string, to: string): Promise<void> {
  await ensureRollupTable();
  if (from > to) return;
  const today = todayCairo(); // Cairo day — Shopify boundaries are +03:00, so "today" must be too
  const cutoff = addDays(today, -ROLLUP_SETTLE_DAYS);
  const expected = Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS) + 1;

  const stat = (await query<{ days: string; trailing: string; fresh: string }>(
    `SELECT COUNT(DISTINCT sale_date) AS days,
            COUNT(DISTINCT sale_date) FILTER (WHERE sale_date >= $3) AS trailing,
            COUNT(DISTINCT sale_date) FILTER (WHERE sale_date >= $3 AND built_at > now() - ($4 || ' minutes')::interval) AS fresh
       FROM shopify_daily WHERE sale_date BETWEEN $1 AND $2`,
    [from, to, cutoff, String(ROLLUP_TTL_MIN)],
  ))[0] ?? { days: "0", trailing: "0", fresh: "0" };

  const frozenTo = addDays(cutoff, -1);
  const frozenExpected = frozenTo >= from ? Math.round((Date.parse(frozenTo) - Date.parse(from)) / DAY_MS) + 1 : 0;
  const trailingFrom = cutoff > from ? cutoff : from;
  const trailingExpected = expected - frozenExpected;

  // Frozen gap (months of history) — fill in the BACKGROUND, never block the read on
  // a huge live fetch. A persistent gap means the backfill script should be run.
  if (frozenExpected > 0 && (Number(stat.days) - Number(stat.trailing)) < frozenExpected) {
    console.error(`[shopify:rollup] frozen gap ${from}..${frozenTo} (have ${Number(stat.days) - Number(stat.trailing)}/${frozenExpected}) — filling in background; run scripts/backfill-shopify-rollup.mjs if persistent`);
    void refreshShopifyDaily(from, frozenTo).catch(e => console.error(`[shopify:rollup] frozen bg: ${e instanceof Error ? e.message : e}`));
  }
  // Trailing window (≤30 days, bounded) — refresh if stale; async once it has data
  // so steady-state reads never block, block only on the very first seed.
  if (trailingExpected > 0 && Number(stat.fresh) < trailingExpected) {
    if (Number(stat.trailing) > 0) {
      void refreshShopifyDaily(trailingFrom, to).catch(e => console.error(`[shopify:rollup] trailing bg: ${e instanceof Error ? e.message : e}`));
    } else {
      await refreshShopifyDaily(trailingFrom, to);
    }
  }
}

// Live (un-rolled) fetch — used for "today" and as the fallback if the rollup errors.
async function liveRevenueRange(from: string, to: string): Promise<{ egp: number; units: number }> {
  const [sam, amt] = await Promise.all([
    fetchBrandOrders("samsonite", from, to),
    fetchBrandOrders("american-tourister", from, to),
  ]);
  const s = ordersToRevenue(sam), a = ordersToRevenue(amt);
  return { egp: s.egp + a.egp, units: s.units + a.units };
}

async function liveDailyRange(from: string, to: string): Promise<Record<string, { egp: number; units: number }>> {
  const [sam, amt] = await Promise.all([
    fetchBrandOrders("samsonite", from, to),
    fetchBrandOrders("american-tourister", from, to),
  ]);
  const byDay: Record<string, { egp: number; units: number }> = {};
  for (const o of [...sam, ...amt]) {
    const day = egDay(o.created_at);
    (byDay[day] ??= { egp: 0, units: 0 });
    byDay[day].egp += netTotal(o);
    byDay[day].units += o.line_items.reduce((s, i) => s + i.quantity, 0);
  }
  return byDay;
}

/** Per-day net revenue (for daily drills) — historical from the rollup, today live. */
export async function getShopifyDailyRevenue(
  from: string, to: string
): Promise<Record<string, { egp: number; units: number }>> {
  try {
    const today = todayCairo(); // Cairo day — Shopify boundaries are +03:00, so "today" must be too
    const byDay: Record<string, { egp: number; units: number }> = {};
    const histTo = to >= today ? addDays(today, -1) : to;
    if (histTo >= from) {
      await ensureRollupCovered(from, histTo);
      const rows = await query<{ d: string; egp: string; units: string }>(
        `SELECT to_char(sale_date,'YYYY-MM-DD') AS d, SUM(egp) AS egp, SUM(units) AS units
           FROM shopify_daily WHERE sale_date BETWEEN $1 AND $2 GROUP BY sale_date`,
        [from, histTo],
      );
      for (const r of rows) {
        const e = Math.round(Number(r.egp)), u = Math.round(Number(r.units));
        if (e !== 0 || u !== 0) byDay[r.d] = { egp: e, units: u };
      }
    }
    if (to >= today) {
      try { Object.assign(byDay, await liveDailyRange(today, today)); }
      catch (e) { console.error(`[shopify:daily] today live failed, historical only: ${e instanceof Error ? e.message : e}`); }
    }
    return byDay;
  } catch (e) {
    // Drill helper (no safeSource) — degrade to NAV-only, but log so it's visible.
    console.error(`[shopify:daily] failed, drill will show NAV only: ${e instanceof Error ? e.message : e}`);
    return {};
  }
}

/** Combined Shopify net revenue + units — historical from the rollup (instant),
 *  today live (real-time). Falls back to the full live path on any rollup error. */
export async function getShopifyRevenue(from: string, to: string): Promise<{ egp: number; units: number }> {
  try {
    const today = todayCairo(); // Cairo day — Shopify boundaries are +03:00, so "today" must be too
    let egp = 0, units = 0;
    const histTo = to >= today ? addDays(today, -1) : to;
    if (histTo >= from) {
      await ensureRollupCovered(from, histTo);
      const r = (await query<{ egp: string; units: string }>(
        `SELECT COALESCE(SUM(egp),0) AS egp, COALESCE(SUM(units),0) AS units FROM shopify_daily WHERE sale_date BETWEEN $1 AND $2`,
        [from, histTo],
      ))[0];
      egp += Math.round(Number(r?.egp || 0)); units += Math.round(Number(r?.units || 0));
    }
    if (to >= today) {
      try {
        const t = await liveRevenueRange(today, today);
        egp += Math.round(t.egp); units += Math.round(t.units);
      } catch (e) {
        // Today's live fetch failed — keep the rollup historical, just skip today.
        console.error(`[shopify:revenue] today live failed, historical only: ${e instanceof Error ? e.message : e}`);
      }
    }
    return { egp, units };
  } catch (e) {
    // Only here if the ROLLUP read itself failed (DB issue) → full live fallback.
    console.error(`[shopify:revenue] rollup failed, live fallback: ${e instanceof Error ? e.message : e}`);
    return liveRevenueRange(from, to);
  }
}

/** Fetch revenue + units split by brand. */
export async function getShopifyRevenueSplit(from: string, to: string): Promise<{
  samsonite: { egp: number; units: number };
  americanTourister: { egp: number; units: number };
}> {
  const out = { samsonite: { egp: 0, units: 0 }, americanTourister: { egp: 0, units: 0 } };
  try {
    const today = todayCairo(); // Cairo day — Shopify boundaries are +03:00, so "today" must be too
    const histTo = to >= today ? addDays(today, -1) : to;
    if (histTo >= from) {
      await ensureRollupCovered(from, histTo);
      const rows = await query<{ brand: string; egp: string; units: string }>(
        `SELECT brand, SUM(egp) AS egp, SUM(units) AS units FROM shopify_daily WHERE sale_date BETWEEN $1 AND $2 GROUP BY brand`,
        [from, histTo],
      );
      for (const r of rows) {
        const k = r.brand === "samsonite" ? "samsonite" : "americanTourister";
        out[k].egp += Math.round(Number(r.egp)); out[k].units += Math.round(Number(r.units));
      }
    }
    if (to >= today) {
      try {
        const [sam, amt] = await Promise.all([
          fetchBrandOrders("samsonite", today, today),
          fetchBrandOrders("american-tourister", today, today),
        ]);
        const s = ordersToRevenue(sam), a = ordersToRevenue(amt);
        out.samsonite.egp += Math.round(s.egp); out.samsonite.units += Math.round(s.units);
        out.americanTourister.egp += Math.round(a.egp); out.americanTourister.units += Math.round(a.units);
      } catch (e) {
        console.error(`[shopify:split] today live failed, historical only: ${e instanceof Error ? e.message : e}`);
      }
    }
    return out;
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
  // Total: rollup-backed (instant + accurate). Items are only used for the home
  // top-products merge, and fetching every line item over a long range is exactly
  // what made home slow — so bound the line-item fetch to a recent window. NAV
  // still supplies the full-range top products; this just adds Shopify's recent
  // bestsellers. (A per-SKU rollup would make this full-range + instant — follow-up.)
  const ITEMS_WINDOW_DAYS = 7;
  const { egp, units } = await getShopifyRevenue(from, to);
  const cap = addDays(todayCairo(), -ITEMS_WINDOW_DAYS);
  const itemsFrom = from < cap ? cap : from;
  let items: ShopifyLineItemRow[] = [];
  try { items = await getShopifyLineItems(itemsFrom, to); } catch { items = []; }
  return { egp, units, items };
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
