import { NextRequest, NextResponse } from "next/server";
import { anthropic, AI_MODEL } from "@/lib/claude";
import { navQuery } from "@/lib/nav";
import { prisma } from "@/lib/prisma";

const SYSTEM_PROMPT = `You are an expert retail business analyst for a trading company that sells Samsonite and American Tourister luggage.
You have access to live data from 5 offline stores, a head office, and 2 Shopify ecommerce sites.

When answering questions:
1. Always base answers on the data provided in the user's message context
2. Be specific with numbers, percentages, and trends
3. If you want to show a chart, include a JSON block in your response like:
   <chart>{"type":"bar","title":"...","labels":[...],"datasets":[{"label":"...","data":[...]}]}</chart>
4. Flag stock risks clearly
5. Give actionable recommendations
6. Keep responses concise and mobile-friendly

You can answer questions about: sales by store/channel/date, inventory levels, fast movers, slow movers, customer analysis, forecasts, and reorder suggestions.`;

export async function POST(req: NextRequest) {
  const { message, history } = await req.json();

  let dataContext = "";
  try {
    const [salesData, topItems] = await Promise.all([
      navQuery<{ Store: string; TotalAmount: number; TotalQty: number }>(
        `SELECT TOP 20
          [Location Code] as Store,
          SUM([Amount]) as TotalAmount,
          SUM([Quantity]) as TotalQty
         FROM [Sales Invoice Line]
         WHERE [Posting Date] >= DATEADD(day, -30, GETDATE())
         GROUP BY [Location Code]
         ORDER BY TotalAmount DESC`
      ).catch(() => []),
      navQuery<{ Item: string; Description: string; Qty: number; Amount: number }>(
        `SELECT TOP 10
          [No_] as Item,
          [Description],
          SUM([Quantity]) as Qty,
          SUM([Amount]) as Amount
         FROM [Sales Invoice Line]
         WHERE [Posting Date] >= DATEADD(day, -30, GETDATE())
         GROUP BY [No_], [Description]
         ORDER BY Qty DESC`
      ).catch(() => []),
    ]);

    dataContext = `
LIVE DATA CONTEXT (last 30 days):
Sales by store: ${JSON.stringify(salesData)}
Top selling items: ${JSON.stringify(topItems)}
`;
  } catch {
    dataContext = "Note: live data unavailable, answer based on general knowledge of the business.";
  }

  const messages = [
    ...(history || []),
    { role: "user" as const, content: `${dataContext}\n\nUser question: ${message}` },
  ];

  const response = await anthropic.messages.create({
    model: AI_MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages,
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";

  let chartData = null;
  const chartMatch = text.match(/<chart>([\s\S]*?)<\/chart>/);
  if (chartMatch) {
    try {
      chartData = JSON.parse(chartMatch[1]);
    } catch {}
  }

  const cleanText = text.replace(/<chart>[\s\S]*?<\/chart>/g, "").trim();

  await prisma.chatMessage.createMany({
    data: [
      { role: "user", content: message },
      { role: "assistant", content: cleanText, chartData },
    ],
  });

  return NextResponse.json({ text: cleanText, chartData });
}
