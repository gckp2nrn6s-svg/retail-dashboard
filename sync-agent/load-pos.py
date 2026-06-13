#!/usr/bin/env python3
import csv, psycopg2, psycopg2.extras, sys

TERMINAL_TO_STORE = {
    "CCA1": "CCA",
    "ALM":  "ALMAZA",
    "P901": "P90",
    "HS01": "CF-HOS",
    "CS01": "CSTARS",
    "ONL":  "ONLINE",
    "MOE1": "MOE",
    "MOA1": "MOA",
    "ATM1": "ATMADI",
    "ATC1": "ATCFC",
    "HIS1": "HIS",
    "EVE":  "EVE",
}

DB = "postgresql://postgres:DvkmXQgsxLbXClloESxOSFYmnPJCWrFK@acela.proxy.rlwy.net:57254/retail_intelligence"
CSV = "/tmp/pos_sales.csv"

conn = psycopg2.connect(DB)
cur = conn.cursor()

cur.execute("""
    CREATE TABLE IF NOT EXISTS pos_sales (
        id              BIGSERIAL PRIMARY KEY,
        transaction_no  BIGINT,
        receipt_no      TEXT,
        item_no         TEXT,
        item_desc       TEXT,
        pos_terminal    TEXT,
        store_code      TEXT,
        sale_date       DATE,
        sale_time       TEXT,
        quantity        NUMERIC,
        price           NUMERIC,
        net_amount      NUMERIC,
        discount_amount NUMERIC,
        vat_amount      NUMERIC,
        staff_id        TEXT
    )
""")
cur.execute("CREATE INDEX IF NOT EXISTS pos_store_idx ON pos_sales(store_code)")
cur.execute("CREATE INDEX IF NOT EXISTS pos_date_idx  ON pos_sales(sale_date)")
cur.execute("CREATE INDEX IF NOT EXISTS pos_item_idx  ON pos_sales(item_no)")
cur.execute("CREATE INDEX IF NOT EXISTS pos_store_date_idx ON pos_sales(store_code, sale_date)")
conn.commit()

print("Truncating...")
cur.execute("TRUNCATE pos_sales RESTART IDENTITY")
conn.commit()

def n(v):
    try: return float(v) if v else None
    except: return None

def s(v):
    return v.strip() if v and v.strip() else None

total = 0
batch = []
BATCH = 500

INSERT = """
    INSERT INTO pos_sales(transaction_no,receipt_no,item_no,item_desc,pos_terminal,
        store_code,sale_date,sale_time,quantity,price,net_amount,discount_amount,vat_amount,staff_id)
    VALUES %s
"""

with open(CSV, newline='', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    for row in reader:
        terminal = row.get("POS Terminal No.", "") or ""
        store_code = TERMINAL_TO_STORE.get(terminal, terminal)
        try:
            txn = int(row["Transaction No."]) if row.get("Transaction No.") else None
        except:
            txn = None

        batch.append((
            txn,
            s(row.get("Receipt No.")),
            s(row.get("Item No.")),
            s(row.get("Item Desc")) or s(row.get("Item Description")),
            terminal or None,
            store_code or None,
            s(row.get("Date")),
            s(row.get("Time")),
            n(row.get("Quantity")),
            n(row.get("Price")),
            n(row.get("Net Amount")),
            n(row.get("Discount Amount")),
            n(row.get("VAT Amount")),
            s(row.get("Staff ID")),
        ))

        if len(batch) >= BATCH:
            psycopg2.extras.execute_values(cur, INSERT, batch)
            conn.commit()
            total += len(batch)
            batch = []
            if total % 20000 == 0:
                sys.stdout.write(f"\r  {total} rows...")
                sys.stdout.flush()

if batch:
    psycopg2.extras.execute_values(cur, INSERT, batch)
    conn.commit()
    total += len(batch)

print(f"\nInserted {total} rows")

cur.execute("""
    SELECT store_code,
           COUNT(*) as rows,
           MIN(sale_date) as first_sale,
           MAX(sale_date) as last_sale,
           ROUND(SUM(CASE WHEN quantity < 0 THEN -net_amount ELSE 0 END)) as revenue_egp
    FROM pos_sales
    WHERE quantity < 0
    GROUP BY store_code ORDER BY revenue_egp DESC
""")
print("\nStore breakdown:")
print(f"{'Store':<12} {'Rows':>8} {'First':>12} {'Last':>12} {'Revenue EGP':>15}")
print("-" * 62)
for r in cur.fetchall():
    print(f"{r[0]:<12} {r[1]:>8} {str(r[2]):>12} {str(r[3]):>12} {r[4]:>15,}")

cur.close()
conn.close()
