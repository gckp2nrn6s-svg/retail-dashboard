import { navQuery } from "@/lib/navdb";

// B2B / Head-Office revenue = SalesInvoiceLine (invoices) net of SalesCrMemoLine
// (credit memos / returns), VAT-inclusive — the SAME definition as the B2B tab.
// Shared so the Home total, the KPI headline, and the channel breakdown all agree
// (B2B doesn't flow through the POS / TransSalesEntry, so it was reading as 0).
const B2B_NET_SQL = `
  SELECT COALESCE(SUM(egp),0) AS egp, COALESCE(SUM(units),0) AS units FROM (
    SELECT [Amount Including VAT] AS egp, [Quantity] AS units
      FROM SalesInvoiceLine WHERE CAST([Posting Date] AS DATE) BETWEEN @from AND @to AND [Sell-to Customer No_] <> ''
    UNION ALL
    SELECT -[Amount Including VAT], -[Quantity]
      FROM SalesCrMemoLine   WHERE CAST([Posting Date] AS DATE) BETWEEN @from AND @to AND [Sell-to Customer No_] <> ''
  ) t`;

export async function getB2BRevenue(from: string, to: string): Promise<{ egp: number; units: number }> {
  const rows = await navQuery<{ egp: number; units: number }>(B2B_NET_SQL, { from, to });
  return { egp: Math.round(Number(rows[0]?.egp || 0)), units: Math.round(Number(rows[0]?.units || 0)) };
}
