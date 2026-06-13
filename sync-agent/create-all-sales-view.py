#!/usr/bin/env python3
"""
Rebuild all_sales view:
- nav_sales: B2B + HO + retail POS (via ONLINE excluded — it duplicates Shopify)
- pos_sales: physical store POS terminals
- shopify_sales: live Shopify for SHOPIFY-AMT and SHOPIFY-SAM

ONLINE in nav_sales is the same orders as Shopify, entered manually the next day.
We drop ONLINE from nav and use Shopify as the single source of truth for ecom.

Shopify SKUs don't match NAV item_no directly. We store them as-is in item_no
and rely on shopify_item_map table (sku → item_no) for cross-source lookups.
"""
import psycopg2

DB = "postgresql://postgres:DvkmXQgsxLbXClloESxOSFYmnPJCWrFK@acela.proxy.rlwy.net:57254/retail_intelligence"
conn = psycopg2.connect(DB)
cur  = conn.cursor()

# Create the SKU→item_no mapping table if not exists
# This is maintained manually or via a future NAV sync
cur.execute("""
CREATE TABLE IF NOT EXISTS shopify_item_map (
  sku        TEXT PRIMARY KEY,
  item_no    TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
""")

# Rebuild the view — ONLINE excluded from nav (replaced by Shopify)
cur.execute("""
CREATE OR REPLACE VIEW all_sales AS
  -- NAV: B2B accounts, Head Office, and any non-ONLINE channels
  SELECT
    posting_date  AS sale_date,
    store_code,
    item_no,
    sales_amount  AS revenue,
    (-invoiced_qty) AS units,
    'nav'         AS source
  FROM nav_sales
  WHERE document_type = 'Sales Invoice'
    AND invoiced_qty  < 0
    AND store_code   != 'ONLINE'   -- excluded: duplicated by Shopify

  UNION ALL

  -- POS: physical retail stores (excludes online terminal if any)
  SELECT
    sale_date,
    store_code,
    item_no,
    (-net_amount) AS revenue,
    (-quantity)   AS units,
    'pos'         AS source
  FROM pos_sales
  WHERE quantity < 0
    AND store_code != 'ONLINE'

  UNION ALL

  -- Shopify: live ecom, SKU stored in item_no
  -- Coalesce to mapped NAV item_no when available, otherwise use SKU
  SELECT
    sale_date,
    store_code,
    COALESCE(m.item_no, s.sku) AS item_no,
    line_total    AS revenue,
    quantity      AS units,
    'shopify'     AS source
  FROM shopify_sales s
  LEFT JOIN shopify_item_map m ON m.sku = s.sku
  WHERE quantity > 0
    AND financial_status IN ('paid', 'partially_refunded')
""")

conn.commit()
print("✓ all_sales view rebuilt — ONLINE excluded, Shopify is ecom source of truth")

# Report
cur.execute("""
  SELECT store_code, source,
         COUNT(*)         AS rows,
         MIN(sale_date)   AS first_sale,
         MAX(sale_date)   AS last_sale,
         ROUND(SUM(revenue)) AS revenue_egp
  FROM all_sales
  GROUP BY store_code, source ORDER BY revenue_egp DESC
""")
print(f"\n{'Store':<14} {'Source':<10} {'Rows':>7} {'First':>12} {'Last':>12} {'Revenue EGP':>15}")
print("-" * 75)
for r in cur.fetchall():
    print(f"{r[0]:<14} {r[1]:<10} {r[2]:>7} {str(r[3]):>12} {str(r[4]):>12} {int(r[5]):>15,}")

cur.close()
conn.close()
