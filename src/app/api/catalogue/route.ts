import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const search = searchParams.get("q") || "";
  const category = searchParams.get("category") || "";
  const brand = searchParams.get("brand") || "";
  const colourGroup = searchParams.get("colour") || "";
  const size = searchParams.get("size") || "";
  const lineFilter = searchParams.get("line") || "";
  const stockFilter = searchParams.get("stock") || ""; // "in" | "low" | "zero"
  const sort = searchParams.get("sort") || "stock_desc"; // stock_desc | sales_desc | price_desc | name_asc
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "30");
  const offset = (page - 1) * limit;

  const params: (string | number)[] = [];
  const filters: string[] = [];

  if (search) {
    params.push(`%${search}%`);
    filters.push(`(ic.description ILIKE $${params.length} OR ic.item_no ILIKE $${params.length} OR ic.line_name ILIKE $${params.length})`);
  }
  if (category) { params.push(category); filters.push(`ic.category = $${params.length}`); }
  if (brand) { params.push(brand); filters.push(`ic.brand = $${params.length}`); }
  if (colourGroup) { params.push(colourGroup); filters.push(`ic.colour_group = $${params.length}`); }
  if (size) { params.push(size); filters.push(`ic.size = $${params.length}`); }
  if (lineFilter) { params.push(`%${lineFilter}%`); filters.push(`ic.line_name ILIKE $${params.length}`); }
  if (stockFilter === "in") filters.push("ws.in_stock > 5");
  else if (stockFilter === "low") filters.push("ws.in_stock > 0 AND ws.in_stock <= 5");
  else if (stockFilter === "zero") filters.push("(ws.in_stock = 0 OR ws.in_stock IS NULL)");

  const whereClause = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";

  const orderMap: Record<string, string> = {
    stock_desc: "COALESCE(ws.in_stock, 0) DESC",
    sales_desc: "COALESCE(recent.units_sold, 0) DESC",
    price_desc: "COALESCE(ws.unit_price, 0) DESC",
    name_asc: "ic.description ASC",
  };
  const orderBy = orderMap[sort] || orderMap.stock_desc;

  const baseSql = `
    FROM item_categorisation ic
    LEFT JOIN warehouse_stock ws ON ic.item_no = ws.item_no
    LEFT JOIN (
      SELECT item_no, SUM(-invoiced_qty) AS units_sold, SUM(sales_amount) AS revenue
      FROM nav_sales
      WHERE document_type = 'Sales Invoice' AND invoiced_qty < 0
        AND posting_date >= CURRENT_DATE - 30
      GROUP BY item_no
    ) recent ON ic.item_no = recent.item_no
    ${whereClause}
  `;

  const [countRows, rows, fxRow] = await Promise.all([
    query<{ count: string }>(`SELECT COUNT(*)::int AS count ${baseSql}`, params),
    query<{
      item_no: string; description: string; brand: string; category: string; subcategory: string;
      colour_exact: string; colour_group: string; size: string; size_detail: string; line_name: string;
      usage: string; in_stock: string; unit_price: string; units_sold_30d: string; revenue_30d: string;
    }>(`
      SELECT
        ic.item_no, ic.description, ic.brand, ic.category, ic.subcategory,
        ic.colour_exact, ic.colour_group, ic.size, ic.size_detail, ic.line_name, ic.usage,
        COALESCE(ws.in_stock, 0)::numeric AS in_stock,
        COALESCE(ws.unit_price, 0)::numeric AS unit_price,
        COALESCE(recent.units_sold, 0)::numeric AS units_sold_30d,
        COALESCE(recent.revenue, 0)::numeric AS revenue_30d
      ${baseSql}
      ORDER BY ${orderBy}
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `, [...params, limit, offset]),
    query<{ egp_per_usd: string }>(
      "SELECT egp_per_usd FROM fx_rates ORDER BY week_start DESC LIMIT 1"
    ),
  ]);

  const fx = parseFloat(fxRow[0]?.egp_per_usd || "50");
  const total = parseInt(countRows[0]?.count || "0");

  return NextResponse.json({
    items: rows.map((r) => ({
      ...r,
      in_stock: parseFloat(r.in_stock),
      unit_price: { egp: parseFloat(r.unit_price), usd: parseFloat(r.unit_price) / fx },
      units_sold_30d: parseFloat(r.units_sold_30d),
      revenue_30d: { egp: Math.round(parseFloat(r.revenue_30d)), usd: Math.round(parseFloat(r.revenue_30d) / fx) },
    })),
    total,
    page,
    pages: Math.ceil(total / limit),
    fx,
  });
}
