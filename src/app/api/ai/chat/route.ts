import { NextRequest, NextResponse } from "next/server";
import { query, SALES_FILTER } from "@/lib/db";

const SYSTEM_PROMPT = `You are an expert retail business analyst for Le Souverain, an Egyptian trading company selling Samsonite, American Tourister, Kamiliant, Lipault, and High Sierra luggage across 5+ physical stores and online channels (Amazon, Jumia, Noon).

You have access to live sales data from NAV ERP (since 2019), warehouse stock data (snapshot), and product categorisation with brands, colours, sizes, and line names.

Stores: ALMAZA, ATCFC, ATMADI, CCA, CF-HOS, CSTARS, DUTY FREE, FOUR SEASO, GO SPORT1, MOA, MOE, P90, SPINNEYS (retail), AMAZON/JUMIA/NOON/ONLINE (ecom), HO (head office / B2B).

Currency: data is in EGP. Current rate is approximately 50 EGP/USD.

When answering:
- Be direct and specific with numbers
- Reference store names, brands, and product lines by name
- Flag stock risks clearly with urgency
- Give actionable recommendations
- Keep responses concise and mobile-friendly
- If a chart would help, include a JSON block: <chart>{"type":"bar","data":[{"name":"...","value":...}],"xKey":"name","yKey":"value","label":"Chart title"}</chart>
- Chart types: "bar", "line", "pie"
- For line charts use dates as xKey`;

export async function POST(req: NextRequest) {
  const { message, history } = await req.json();

  // Pull relevant data based on the question
  let dataContext = "";
  try {
    const [salesLast30, topItems, lowStock, storeBreakdown, fxRow] = await Promise.all([
      query<{ revenue: string; units: string }>(`
        SELECT SUM(sales_amount)::numeric AS revenue, SUM(-invoiced_qty)::numeric AS units
        FROM nav_sales WHERE ${SALES_FILTER} AND posting_date >= CURRENT_DATE - 30
      `),
      query<{ item_no: string; description: string; category: string; brand: string; units_sold: string; revenue: string }>(`
        SELECT n.item_no, COALESCE(ic.description, n.item_no) AS description,
          ic.category, ic.brand,
          SUM(-n.invoiced_qty)::numeric AS units_sold,
          SUM(n.sales_amount)::numeric AS revenue
        FROM nav_sales n
        LEFT JOIN item_categorisation ic ON n.item_no = ic.item_no
        WHERE ${SALES_FILTER} AND n.posting_date >= CURRENT_DATE - 30
        GROUP BY n.item_no, ic.description, ic.category, ic.brand
        ORDER BY units_sold DESC LIMIT 15
      `),
      query<{ item_no: string; description: string; in_stock: string; units_sold_30d: string; days_remaining: string }>(`
        SELECT ws.item_no, COALESCE(ic.description, ws.description) AS description,
          ws.in_stock::numeric,
          COALESCE(r.units_sold, 0)::numeric AS units_sold_30d,
          CASE WHEN r.units_sold > 0 THEN ROUND(ws.in_stock / (r.units_sold / 30.0)) ELSE NULL END AS days_remaining
        FROM warehouse_stock ws
        LEFT JOIN item_categorisation ic ON ws.item_no = ic.item_no
        LEFT JOIN (SELECT item_no, SUM(-invoiced_qty) AS units_sold FROM nav_sales WHERE ${SALES_FILTER} AND posting_date >= CURRENT_DATE - 30 GROUP BY item_no) r ON ws.item_no = r.item_no
        WHERE ws.in_stock > 0 AND ws.in_stock <= 5 AND COALESCE(r.units_sold, 0) > 0
        ORDER BY days_remaining ASC NULLS LAST LIMIT 10
      `),
      query<{ store_code: string; revenue: string; units: string }>(`
        SELECT store_code, SUM(sales_amount)::numeric AS revenue, SUM(-invoiced_qty)::numeric AS units
        FROM nav_sales WHERE ${SALES_FILTER} AND posting_date >= CURRENT_DATE - 30
        GROUP BY store_code ORDER BY revenue DESC
      `),
      query<{ egp_per_usd: string }>(
        "SELECT egp_per_usd FROM fx_rates ORDER BY week_start DESC LIMIT 1"
      ),
    ]);

    const fx = parseFloat(fxRow[0]?.egp_per_usd || "50");
    const rev = parseFloat(salesLast30[0]?.revenue || "0");

    dataContext = `
LIVE DATA (last 30 days):
- Total revenue: EGP ${Math.round(rev).toLocaleString()} (USD ${Math.round(rev / fx).toLocaleString()})
- Units sold: ${parseFloat(salesLast30[0]?.units || "0").toLocaleString()}
- Current EGP/USD rate: ${fx.toFixed(2)}

Top 15 selling items (30d):
${topItems.map((i) => `  ${i.description || i.item_no} [${i.brand || "?"}/${i.category || "?"}] — ${i.units_sold} units, EGP ${Math.round(parseFloat(i.revenue)).toLocaleString()}`).join("\n")}

Critical low stock (in stock ≤5, actively selling):
${lowStock.map((i) => `  ${i.description || i.item_no} — ${i.in_stock} left, ${i.days_remaining || "?"} days remaining`).join("\n")}

Sales by store (30d):
${storeBreakdown.map((s) => `  ${s.store_code}: EGP ${Math.round(parseFloat(s.revenue)).toLocaleString()}, ${parseFloat(s.units).toLocaleString()} units`).join("\n")}
`;
  } catch (e) {
    dataContext = `Live data unavailable: ${e}`;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ content: "AI chat requires an Anthropic API key. Please add ANTHROPIC_API_KEY to environment variables.", chartData: null });
  }

  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });

  const historyMessages = (history || []).slice(-8).map((m: { role: string; content: string }) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    messages: [
      ...historyMessages,
      { role: "user", content: `${dataContext}\n\nUser question: ${message}` },
    ],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";

  let chartData = null;
  const chartMatch = text.match(/<chart>([\s\S]*?)<\/chart>/);
  if (chartMatch) {
    try { chartData = JSON.parse(chartMatch[1]); } catch {}
  }

  const content = text.replace(/<chart>[\s\S]*?<\/chart>/g, "").trim();

  return NextResponse.json({ content, chartData });
}
