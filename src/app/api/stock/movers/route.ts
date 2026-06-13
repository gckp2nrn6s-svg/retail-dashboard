import { NextRequest, NextResponse } from "next/server";
import { query, SALES_FILTER } from "@/lib/db";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") || "fast"; // fast | low | slow
  const range = searchParams.get("range") || "30d";
  const category = searchParams.get("category") || "";
  const brand = searchParams.get("brand") || "";

  let days = 30;
  if (range === "7d") days = 7;
  else if (range === "90d") days = 90;

  const catFilter = category ? `AND ic.category = $1` : "";
  const brandFilter = brand ? `AND ic.brand = ${category ? "$2" : "$1"}` : "";
  const params: string[] = [];
  if (category) params.push(category);
  if (brand) params.push(brand);

  const fxRow = await query<{ egp_per_usd: string }>(
    "SELECT egp_per_usd FROM fx_rates ORDER BY week_start DESC LIMIT 1"
  );
  const fx = parseFloat(fxRow[0]?.egp_per_usd || "50");

  if (type === "fast") {
    const rows = await query<{
      item_no: string; description: string; brand: string; category: string;
      subcategory: string; colour_exact: string; colour_group: string; size: string;
      line_name: string; units_sold: string; revenue: string; in_stock: string;
    }>(`
      SELECT
        n.item_no,
        COALESCE(ic.description, ni.description, n.item_no) AS description,
        ic.brand, ic.category, ic.subcategory, ic.colour_exact, ic.colour_group,
        ic.size, ic.line_name,
        SUM(-n.invoiced_qty)::numeric AS units_sold,
        SUM(n.sales_amount)::numeric AS revenue,
        COALESCE(ws.in_stock, 0)::numeric AS in_stock
      FROM nav_sales n
      LEFT JOIN item_categorisation ic ON n.item_no = ic.item_no
      LEFT JOIN nav_items ni ON n.item_no = ni.item_no
      LEFT JOIN warehouse_stock ws ON n.item_no = ws.item_no
      WHERE ${SALES_FILTER} AND n.posting_date >= CURRENT_DATE - interval '${days} days'
        ${catFilter} ${brandFilter}
      GROUP BY n.item_no, ic.description, ni.description, ic.brand, ic.category,
        ic.subcategory, ic.colour_exact, ic.colour_group, ic.size, ic.line_name, ws.in_stock
      ORDER BY units_sold DESC
      LIMIT 50
    `, params.length ? params : undefined);

    return NextResponse.json({
      items: rows.map((r) => ({
        ...r,
        units_sold: parseFloat(r.units_sold),
        revenue: { egp: Math.round(parseFloat(r.revenue)), usd: Math.round(parseFloat(r.revenue) / fx) },
        in_stock: parseFloat(r.in_stock),
        daysRemaining: parseFloat(r.units_sold) > 0
          ? Math.round(parseFloat(r.in_stock) / (parseFloat(r.units_sold) / days))
          : null,
      })),
      fx, range,
    });
  }

  if (type === "low") {
    const rows = await query<{
      item_no: string; description: string; brand: string; category: string;
      colour_exact: string; size: string; line_name: string; in_stock: string;
      units_sold_30d: string; unit_price: string;
    }>(`
      SELECT
        ws.item_no,
        COALESCE(ic.description, ws.description) AS description,
        ic.brand, ic.category, ic.colour_exact, ic.size, ic.line_name,
        ws.in_stock::numeric,
        COALESCE(recent.units_sold, 0)::numeric AS units_sold_30d,
        ws.unit_price::numeric
      FROM warehouse_stock ws
      LEFT JOIN item_categorisation ic ON ws.item_no = ic.item_no
      LEFT JOIN (
        SELECT item_no, SUM(-invoiced_qty) AS units_sold
        FROM nav_sales
        WHERE ${SALES_FILTER} AND posting_date >= CURRENT_DATE - 30
        GROUP BY item_no
      ) recent ON ws.item_no = recent.item_no
      WHERE ws.in_stock > 0 AND ws.in_stock <= 10
        AND COALESCE(recent.units_sold, 0) > 0
        ${catFilter.replace("ic.", "ic.")} ${brandFilter.replace("ic.", "ic.")}
      ORDER BY
        CASE WHEN recent.units_sold > 0
          THEN ws.in_stock / (recent.units_sold / 30.0)
          ELSE 999 END ASC,
        ws.in_stock ASC
      LIMIT 50
    `, params.length ? params : undefined);

    return NextResponse.json({
      items: rows.map((r) => {
        const sold = parseFloat(r.units_sold_30d);
        const stock = parseFloat(r.in_stock);
        return {
          ...r,
          in_stock: stock,
          units_sold_30d: sold,
          unit_price: parseFloat(r.unit_price || "0"),
          daysRemaining: sold > 0 ? Math.round(stock / (sold / 30)) : null,
        };
      }),
      fx, range,
    });
  }

  // slow movers: in stock but barely selling
  const rows = await query<{
    item_no: string; description: string; brand: string; category: string;
    colour_exact: string; size: string; in_stock: string; units_sold: string; unit_price: string;
  }>(`
    SELECT
      ws.item_no,
      COALESCE(ic.description, ws.description) AS description,
      ic.brand, ic.category, ic.colour_exact, ic.size,
      ws.in_stock::numeric,
      COALESCE(recent.units_sold, 0)::numeric AS units_sold,
      ws.unit_price::numeric
    FROM warehouse_stock ws
    LEFT JOIN item_categorisation ic ON ws.item_no = ic.item_no
    LEFT JOIN (
      SELECT item_no, SUM(-invoiced_qty) AS units_sold
      FROM nav_sales
      WHERE ${SALES_FILTER} AND posting_date >= CURRENT_DATE - ${days}
      GROUP BY item_no
    ) recent ON ws.item_no = recent.item_no
    WHERE ws.in_stock > 5
      ${catFilter.replace("n.", "").replace("ic.", "ic.")} ${brandFilter.replace("n.", "").replace("ic.", "ic.")}
    ORDER BY COALESCE(recent.units_sold, 0) ASC, ws.in_stock DESC
    LIMIT 50
  `, params.length ? params : undefined);

  return NextResponse.json({
    items: rows.map((r) => ({
      ...r,
      in_stock: parseFloat(r.in_stock),
      units_sold: parseFloat(r.units_sold),
      unit_price: parseFloat(r.unit_price || "0"),
    })),
    fx, range,
  });
}
