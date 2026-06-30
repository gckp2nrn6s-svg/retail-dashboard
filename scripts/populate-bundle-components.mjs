/**
 * One-time migration: parse all bundle SKUs in shopify_item_map (those containing "+"),
 * resolve each component to its item_no + catalogue price, and populate
 * shopify_bundle_components with price-weighted entries.
 *
 * Revenue weight = component_price / sum_of_ALL_component_prices (including non-MIE).
 * Non-MIE components (LU4/LU8/QU9 bags) are included so the denominator is correct;
 * they will be silently skipped at attribution time by the livePeriodMie lineOf filter.
 *
 * Units: each component gets 1 unit per bundle sale (a 3-piece set = 3 units sold).
 */

import pg from "pg";
const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL env var is required");
  process.exit(1);
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const q = (sql, params = []) => pool.query(sql, params).then((r) => r.rows);

/** Collapse whitespace+dashes into single dash, lowercase */
function norm(s) {
  return s
    .replace(/[\s\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

/**
 * Parse a bundle SKU string into component SKU strings.
 *
 * Logic:
 *   - Split on "+" (trim each token)
 *   - If a token starts with 2–3 uppercase letters → new "base SKU" (full item identifier)
 *   - Otherwise (pure 3-digit suffix like "002") → append to current base prefix
 *     by replacing the trailing digit group in the last base with this suffix
 */
function parseComponents(bundleSku) {
  const tokens = bundleSku.split("+").map((t) => t.trim()).filter(Boolean);
  const components = [];
  let currentFull = "";

  for (const token of tokens) {
    if (/^[A-Z]{2,4}[-\s]/.test(token) || /^[A-Z]{2,4}\d/.test(token)) {
      // Full item identifier (new base)
      currentFull = token;
      components.push(token);
    } else if (/^\d{3}[\w]*$/.test(token) && currentFull) {
      // Pure numeric/short suffix — append to current base prefix
      const match = currentFull.match(/^(.*?)(\d{3}[\w]*)$/);
      if (match) {
        const newFull = match[1] + token;
        components.push(newFull);
        currentFull = newFull; // update so next suffix chains correctly
      }
    } else if (/^[A-Z]/.test(token)) {
      // Uppercase but doesn't fit the strict pattern — treat as full
      currentFull = token;
      components.push(token);
    }
  }

  return components;
}

async function main() {
  // ── 1. Load all single-item SKU → item_no mappings ──────────────────────────
  const singles = await q(
    `SELECT sku, item_no FROM shopify_item_map WHERE sku NOT LIKE '%+%'`
  );
  const skuMap = new Map(); // normalised sku → item_no
  for (const r of singles) skuMap.set(norm(r.sku), String(r.item_no));

  // ── 2. Load all item prices from warehouse_stock ─────────────────────────────
  const priceRows = await q(
    `SELECT item_no, description, unit_price FROM warehouse_stock WHERE unit_price > 0`
  );
  const priceMap = new Map(); // item_no → unit_price
  const descCodeMap = new Map(); // normalised trailing code → item_no
  for (const r of priceRows) {
    priceMap.set(String(r.item_no), Number(r.unit_price));
    // Extract trailing item code from description, e.g. "... QU9 - 01 002", "... LU4 - 09 101"
    // Line codes are 2 uppercase letters + 1 digit (e.g. QU9, LU4, LU8, AG9, HC0)
    const m = r.description?.match(/([A-Z]{2}\d[\s\-]+\d+[\s\-]+[\d\w]+)$/);
    if (m) descCodeMap.set(norm(m[1]), String(r.item_no));
  }

  // ── 3. Create / reset the table ──────────────────────────────────────────────
  await q(`
    CREATE TABLE IF NOT EXISTS shopify_bundle_components (
      bundle_sku        TEXT,
      component_item_no TEXT,
      price_weight      NUMERIC(12, 8),
      PRIMARY KEY (bundle_sku, component_item_no)
    )
  `);
  await q(`TRUNCATE shopify_bundle_components`);

  // ── 4. Process each bundle SKU ───────────────────────────────────────────────
  const bundles = await q(
    `SELECT sku FROM shopify_item_map WHERE sku LIKE '%+%' ORDER BY sku`
  );

  let totalInserted = 0;
  const unresolved = [];

  for (const { sku: bundleSku } of bundles) {
    const compStrings = parseComponents(bundleSku);
    if (compStrings.length === 0) {
      console.warn(`[SKIP] No components parsed for: "${bundleSku}"`);
      continue;
    }

    // Resolve each component string → item_no + price
    const resolved = []; // { item_no, price }
    for (const cs of compStrings) {
      const n = norm(cs);
      let itemNo = skuMap.get(n) ?? descCodeMap.get(n);
      if (!itemNo) {
        unresolved.push({ bundleSku, compString: cs, normalized: n });
        continue;
      }
      const price = priceMap.get(itemNo);
      if (!price) {
        unresolved.push({ bundleSku, compString: cs, itemNo, note: "no price" });
        continue;
      }
      resolved.push({ item_no: itemNo, price });
    }

    if (resolved.length === 0) {
      console.warn(`[SKIP] Bundle "${bundleSku}" — zero components resolved`);
      continue;
    }

    // Merge duplicates (same item_no appears twice → doubled price share)
    const merged = new Map(); // item_no → total price
    for (const r of resolved) {
      merged.set(r.item_no, (merged.get(r.item_no) ?? 0) + r.price);
    }

    const totalPrice = [...merged.values()].reduce((s, p) => s + p, 0);

    for (const [item_no, price] of merged) {
      const weight = price / totalPrice;
      await q(
        `INSERT INTO shopify_bundle_components (bundle_sku, component_item_no, price_weight)
         VALUES ($1, $2, $3)
         ON CONFLICT (bundle_sku, component_item_no) DO UPDATE SET price_weight = EXCLUDED.price_weight`,
        [bundleSku, item_no, weight]
      );
      totalInserted++;
    }

    const names = [...merged.keys()].join(", ");
    console.log(
      `[OK] "${bundleSku}" → ${merged.size} components [${names}] totalPrice=${totalPrice}`
    );
  }

  console.log(`\n=== Done: ${totalInserted} component rows inserted ===`);

  if (unresolved.length > 0) {
    console.warn(`\n=== ${unresolved.length} unresolved components (check manually) ===`);
    for (const u of unresolved) {
      console.warn(`  bundle="${u.bundleSku}" comp="${u.compString}" norm="${u.normalized}" ${u.note ?? ""}`);
    }
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
