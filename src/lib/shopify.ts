export type ShopifyStore = "samsonite" | "american-tourister";

interface ShopifyConfig {
  store: string;
  token: string;
}

function getConfig(brand: ShopifyStore): ShopifyConfig {
  if (brand === "samsonite") {
    return {
      store: process.env.SHOPIFY_SAMSONITE_STORE!,
      token: process.env.SHOPIFY_SAMSONITE_TOKEN!,
    };
  }
  return {
    store: process.env.SHOPIFY_AT_STORE!,
    token: process.env.SHOPIFY_AT_TOKEN!,
  };
}

export async function shopifyFetch<T>(
  brand: ShopifyStore,
  endpoint: string
): Promise<T> {
  const { store, token } = getConfig(brand);
  const res = await fetch(`https://${store}/admin/api/2024-01/${endpoint}`, {
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
