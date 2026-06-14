import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { fetchNavVelocity } from "@/lib/navVelocity";

const MIE_CODES = ["HZ9", "HC0", "GE3", "AG9", "QC6"];

export async function GET() {
  const [vel30, wsRows] = await Promise.all([
    fetchNavVelocity(30),
    query<{ item_no: string; description: string; brand: string; category: string; in_stock: string; unit_price: string }>(`
      SELECT ws.item_no,
             COALESCE(ic.description, ws.description) AS description,
             COALESCE(ic.brand, ws.brand)             AS brand,
             COALESCE(ic.category, 'Other')           AS category,
             ws.in_stock::text,
             ws.unit_price::text
      FROM warehouse_stock ws
      LEFT JOIN item_categorisation ic ON ws.item_no = ic.item_no
    `),
  ]);

  const items = wsRows
    .map(r => {
      const stock    = parseInt(r.in_stock);
      const sold30   = vel30.get(r.item_no)?.units ?? 0;
      const daysCover = sold30 > 0 ? Math.round(stock / (sold30 / 30)) : 0;
      const isMie    = MIE_CODES.some(code => r.description?.includes(code) || r.item_no?.includes(code));
      return {
        item_no:     r.item_no,
        description: r.description,
        brand:       r.brand,
        category:    r.category,
        in_stock:    stock,
        units_30d:   Math.round(sold30),
        daysCover,
        unit_price:  parseInt(r.unit_price),
        mie:         isMie,
      };
    })
    .filter(r => r.units_30d > 0 && (r.in_stock === 0 || r.daysCover < 90))
    .sort((a, b) => {
      if (a.in_stock === 0 && b.in_stock !== 0) return -1;
      if (b.in_stock === 0 && a.in_stock !== 0) return 1;
      return a.daysCover - b.daysCover;
    })
    .slice(0, 200);

  return NextResponse.json({ items });
}
