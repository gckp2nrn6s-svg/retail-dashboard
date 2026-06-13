#!/usr/bin/env python3
"""Create or replace the all_sales view that unions nav_sales (B2B/HO) and pos_sales (store POS)."""
import psycopg2

DB = "postgresql://postgres:DvkmXQgsxLbXClloESxOSFYmnPJCWrFK@acela.proxy.rlwy.net:57254/retail_intelligence"
conn = psycopg2.connect(DB)
cur = conn.cursor()

cur.execute("""
CREATE OR REPLACE VIEW all_sales AS
  SELECT
    posting_date AS sale_date,
    store_code,
    item_no,
    sales_amount          AS revenue,
    (-invoiced_qty)       AS units
  FROM nav_sales
  WHERE document_type = 'Sales Invoice' AND invoiced_qty < 0
  UNION ALL
  SELECT
    sale_date,
    store_code,
    item_no,
    (-net_amount)         AS revenue,
    (-quantity)           AS units
  FROM pos_sales
  WHERE quantity < 0
""")
conn.commit()
print("View all_sales created/updated")

cur.execute("""
    SELECT store_code,
           COUNT(*)         AS rows,
           MIN(sale_date)   AS first_sale,
           MAX(sale_date)   AS last_sale,
           ROUND(SUM(revenue)) AS revenue_egp
    FROM all_sales
    GROUP BY store_code ORDER BY revenue_egp DESC
""")
print(f"\n{'Store':<12} {'Rows':>8} {'First':>12} {'Last':>12} {'Revenue EGP':>15}")
print("-" * 62)
for r in cur.fetchall():
    print(f"{r[0]:<12} {r[1]:>8} {str(r[2]):>12} {str(r[3]):>12} {int(r[4]):>15,}")

cur.close()
conn.close()
