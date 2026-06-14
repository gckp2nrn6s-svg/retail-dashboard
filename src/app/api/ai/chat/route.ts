import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { navQuery } from "@/lib/navdb";
import { fetchNavVelocity } from "@/lib/navVelocity";

const SYSTEM_PROMPT = `You are the chief intelligence analyst for Le Souverain — an Egyptian trading company (Samsonite, American Tourister, Kamiliant, Lipault, High Sierra luggage) operating 5 retail stores, online channels, and B2B distribution.

You are the CEO's personal business advisor. You think like a McKinsey partner but talk like a sharp operator. You give concrete, specific, opinionated advice. You never hedge or give vague answers. Numbers are always in EGP unless asked for USD.

RETAIL STORES: CSTARS (City Stars), CF-HOS (Cairo Festival City / CFC), CCA (Alexandria), ALMAZA (Almaza City Center), P90 (Point 90)
ONLINE: ONLINE (own ecom), AMAZON BAN / AMAZON KAM
B2B ACCOUNTS: HO (head office wholesale), NOON, AMAZON, JUMIA, DUTY FREE, MOE, MOA, ATMADI, ATCFC

BRANDS: Samsonite (premium), American Tourister (mass market), Kamiliant (value), Lipault (lifestyle/women), High Sierra (outdoor/sport)
PRODUCT CATEGORIES: Luggage (Hard Shell, Soft Shell, Business), Bags (Backpacks, Laptop Bags, Duffles), Accessories

DATA YOU HAVE: live sales from 2019 to today, current warehouse stock snapshot, full product catalogue with colours/sizes/lines.

YOUR STYLE:
- Lead with the most important number or finding
- Give a clear recommendation after every insight
- Use bullet points for lists, not paragraphs
- Flag urgency when stock is low: "⚠️ ORDER TODAY", "📦 REORDER THIS WEEK"
- Celebrate wins: "🏆 Best week for CSTARS in 6 months"
- Be specific: name products, stores, brands, quantities
- Keep it mobile-friendly: short paragraphs, no walls of text
- When a chart would clarify, include: <chart>{"type":"bar","data":[{"name":"...","value":...}],"xKey":"name","yKey":"value","label":"Chart title"}</chart>
- Chart types: "bar", "line", "pie"
- For line charts use dates as xKey
- Always end with 1 concrete next action the CEO should take today`;

export async function POST(req: NextRequest) {
  const { message, history } = await req.json();

  // Pull relevant data based on the question
  let dataContext = "";
  try {
    const vel30 = await fetchNavVelocity(30);
    const [salesLast30, topItems, lowStockWs, storeBreakdown, fxRow] = await Promise.all([
      navQuery<{ revenue: number; units: number }>(`
        SELECT -SUM([Net Amount]+[VAT Amount]) AS revenue, -SUM([Quantity]) AS units
        FROM TransSalesEntry WHERE CAST([Date] AS DATE) >= CAST(DATEADD(day,-30,GETDATE()) AS DATE)
      `),
      navQuery<{ item_no: string; description: string; category: string; brand: string; units_sold: number; revenue: number }>(`
        SELECT TOP 15
          [Item No_]                      AS item_no,
          [Item No_] AS description,
          MAX([Product Group Code])       AS category,
          MAX([Item Category Code])       AS brand,
          -SUM([Quantity])                AS units_sold,
          -SUM([Net Amount]+[VAT Amount]) AS revenue
        FROM TransSalesEntry
        WHERE CAST([Date] AS DATE) >= CAST(DATEADD(day,-30,GETDATE()) AS DATE)
        GROUP BY [Item No_]
        ORDER BY units_sold DESC
      `),
      // low stock: warehouse from Postgres, velocity from NAV (merged in JS below)
      query<{ item_no: string; description: string; in_stock: string }>(`
        SELECT ws.item_no, COALESCE(ic.description, ws.description) AS description, ws.in_stock::numeric
        FROM warehouse_stock ws
        LEFT JOIN item_categorisation ic ON ws.item_no = ic.item_no
        WHERE ws.in_stock > 0 AND ws.in_stock <= 5
      `),
      navQuery<{ store_code: string; revenue: number; units: number }>(`
        SELECT
          [Store No_]                     AS store_code,
          -SUM([Net Amount]+[VAT Amount]) AS revenue,
          -SUM([Quantity])                AS units
        FROM TransSalesEntry
        WHERE CAST([Date] AS DATE) >= CAST(DATEADD(day,-30,GETDATE()) AS DATE)
        GROUP BY [Store No_]
        ORDER BY revenue DESC
      `),
      query<{ egp_per_usd: string }>(
        "SELECT egp_per_usd FROM fx_rates ORDER BY week_start DESC LIMIT 1"
      ),
    ]);

    const fx = parseFloat(fxRow[0]?.egp_per_usd || "50");
    const rev = Number(salesLast30[0]?.revenue ?? 0);

    const lowStock = lowStockWs
      .map(r => {
        const sold30 = vel30.get(r.item_no)?.units ?? 0;
        const stock  = parseFloat(r.in_stock);
        return { ...r, in_stock: r.in_stock, units_sold_30d: String(sold30), days_remaining: sold30 > 0 ? String(Math.round(stock / (sold30 / 30))) : null };
      })
      .filter(r => Number(r.units_sold_30d) > 0)
      .sort((a, b) => (Number(a.days_remaining) || 999) - (Number(b.days_remaining) || 999))
      .slice(0, 10);

    dataContext = `
LIVE DATA (last 30 days, VAT-inclusive EGP):
- Total revenue: EGP ${Math.round(rev).toLocaleString()} (USD ${Math.round(rev / fx).toLocaleString()})
- Units sold: ${Number(salesLast30[0]?.units ?? 0).toLocaleString()}
- Current EGP/USD rate: ${fx.toFixed(2)}

Top 15 selling items (30d):
${topItems.map((i) => `  ${i.description || i.item_no} [${i.brand || "?"}/${i.category || "?"}] — ${Number(i.units_sold)} units, EGP ${Math.round(Number(i.revenue)).toLocaleString()}`).join("\n")}

Critical low stock (in stock ≤5, actively selling):
${lowStock.map((i) => `  ${i.description || i.item_no} — ${i.in_stock} left, ${i.days_remaining || "?"} days remaining`).join("\n")}

Sales by store (30d):
${storeBreakdown.map((s) => `  ${s.store_code}: EGP ${Math.round(Number(s.revenue)).toLocaleString()}, ${Number(s.units).toLocaleString()} units`).join("\n")}
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
