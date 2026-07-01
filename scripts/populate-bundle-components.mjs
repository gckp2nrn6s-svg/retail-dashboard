/**
 * Rebuild shopify_bundle_components: parse every bundle SKU (those containing "+"),
 * resolve each component to its item_no + catalogue price, and populate
 * shopify_bundle_components with price-weighted entries. Idempotent (TRUNCATE+rebuild)
 * — safe to re-run any time new bundles start selling.
 *
 * IMPORTANT: bundle SKUs are sourced from BOTH shopify_item_map AND actual sales
 * (shopify_item_daily). Orders carry whitespace/format variants of the catalogue SKU
 * (e.g. "GE3 - 71-005+006+007" vs "GE3-71-005+006+007"); sourcing only from item_map
 * silently dropped those variants' revenue+units entirely (they contain "+", so the
 * single-item path skips them, and the bundle path found no match). norm() collapses
 * the whitespace so both spellings resolve to the same components.
 *
 * Revenue weight = component_price / sum_of_ALL_component_prices (including non-MIE).
 * Non-MIE components (LU4/LU8/QU9 bags) are included so the denominator is correct;
 * they are silently skipped at attribution time by the livePeriodMie lineOf filter.
 *
 * Units: each component gets 1 unit per bundle sale (a 3-piece set = 3 units sold).
 */

// A few sales SKUs are malformed — the base token lacks its "005" size (e.g.
// "GE3 - 04+006+007" instead of "GE3 - 04 005+006+007"), so parseComponents can't
// chain the suffixes. Map these explicitly to the same 3 pieces as their clean analog.
const MANUAL_COMPONENTS = {
  "GE3 - 04+006+007":  ["22841", "22842", "22843"],
  "GE3 - 18 +006+007": ["22844", "22845", "22846"],
  "GE3 - 89+ 006+007": ["20074", "20073", "20072"],
};

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

  // ── 4. Process each bundle SKU ───────────────────────────────────────────────
  // Source from item_map AND actual sales, so order-time SKU spelling variants
  // (extra spaces/dashes) are decomposed too instead of silently dropping revenue.
  const bundles = await q(
    `SELECT DISTINCT sku FROM (
       SELECT sku FROM shopify_item_map    WHERE sku LIKE '%+%'
       UNION
       SELECT sku FROM shopify_item_daily  WHERE sku LIKE '%+%'
     ) b ORDER BY sku`
  );

  let totalInserted = 0;
  const unresolved = [];
  const allRows = []; // { bundle_sku, item_no, weight } — inserted in one transaction at the end

  for (const { sku: bundleSku } of bundles) {
    // Explicit override for malformed SKUs (base missing its size token).
    const manual = MANUAL_COMPONENTS[bundleSku];

    // Resolve each component → item_no + price
    const resolved = []; // { item_no, price }
    if (manual) {
      for (const itemNo of manual) {
        // Price may be missing for a component; fall back to equal weight (1).
        resolved.push({ item_no: itemNo, price: priceMap.get(itemNo) || 1 });
      }
    } else {
      const compStrings = parseComponents(bundleSku);
      if (compStrings.length === 0) {
        console.warn(`[SKIP] No components parsed for: "${bundleSku}"`);
        continue;
      }
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
      allRows.push({ bundle_sku: bundleSku, item_no, weight: price / totalPrice });
      totalInserted++;
    }

  }

  // ── 5. Atomic write: TRUNCATE + batched INSERT in ONE transaction ────────────
  // Per-row inserts over a remote DB are slow enough to time out mid-rebuild, and
  // a non-transactional TRUNCATE+partial-insert leaves the table WORSE than before
  // (some product lines silently missing). One transaction = all-or-nothing.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("TRUNCATE shopify_bundle_components");
    const CHUNK = 500;
    for (let i = 0; i < allRows.length; i += CHUNK) {
      const slice = allRows.slice(i, i + CHUNK);
      const vals = [];
      const tuples = slice.map((r, j) => {
        const b = j * 3;
        vals.push(r.bundle_sku, r.item_no, r.weight);
        return `($${b + 1},$${b + 2},$${b + 3})`;
      }).join(",");
      await client.query(
        `INSERT INTO shopify_bundle_components (bundle_sku, component_item_no, price_weight)
         VALUES ${tuples}
         ON CONFLICT (bundle_sku, component_item_no) DO UPDATE SET price_weight = EXCLUDED.price_weight`,
        vals
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }

  console.log(`\n=== Done: ${totalInserted} component rows across ${bundles.length} bundle SKUs ===`);

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
