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

async function fetchBrandOrders(brand: ShopifyStore, from: string, to: string): Promise<ShopifyOrder[]> {
  try {
    const fromDateTime = `${from}T00:00:00+03:00`;
    const toDateTime   = `${to}T23:59:59+03:00`;
    const params = `?status=any&created_at_min=${fromDateTime}&created_at_max=${toDateTime}&limit=250`;
    const data = await shopifyFetch<{ orders: ShopifyOrder[] }>(brand, `orders.json${params}`);
    return (data.orders ?? []).filter(o => o.financial_status !== "voided" && o.financial_status !== "refunded");
  } catch {
    return [];
  }
}

function ordersToRevenue(orders: ShopifyOrder[]): { egp: number; units: number } {
  let egp = 0, units = 0;
  for (const o of orders) {
    egp += parseFloat(o.total_price);
    units += o.line_items.reduce((s, i) => s + i.quantity, 0);
  }
  return { egp, units };
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
  const [samOrders, amtOrders] = await Promise.all([
    fetchBrandOrders("samsonite", from, to),
    fetchBrandOrders("american-tourister", from, to),
  ]);
  return {
    samsonite:        ordersToRevenue(samOrders),
    americanTourister: ordersToRevenue(amtOrders),
  };
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
  const orderGroups = await Promise.all(brands.map(b => fetchBrandOrders(b, from, to)));
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
