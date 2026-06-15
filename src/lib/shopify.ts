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

interface ShopifyOrder {
  created_at: string;
  total_price: string;
  currency: string;
  financial_status: string;
  line_items: { quantity: number; price: string }[];
}

/** Fetch revenue + units for both Shopify stores within a date range.
 *  Returns EGP totals (Shopify already bills in EGP for these stores). */
export async function getShopifyRevenue(from: string, to: string): Promise<{ egp: number; units: number }> {
  const toDateTime = `${to}T23:59:59+03:00`;
  const fromDateTime = `${from}T00:00:00+03:00`;

  const fetchBrand = async (brand: ShopifyStore) => {
    try {
      const params = `?status=any&financial_status=paid&created_at_min=${fromDateTime}&created_at_max=${toDateTime}&limit=250`;
      const data = await shopifyFetch<{ orders: ShopifyOrder[] }>(brand, `orders.json${params}`);
      return data.orders ?? [];
    } catch {
      return [];
    }
  };

  const [samOrders, amtOrders] = await Promise.all([
    fetchBrand("samsonite"),
    fetchBrand("american-tourister"),
  ]);

  let egp = 0, units = 0;
  for (const o of [...samOrders, ...amtOrders]) {
    egp += parseFloat(o.total_price);
    units += o.line_items.reduce((s, i) => s + i.quantity, 0);
  }
  return { egp, units };
}
