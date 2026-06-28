import { navQuery } from "@/lib/navdb";
import { getFactoryDirectTotal, maybeRefreshFactoryDirect } from "@/lib/factory-direct";

// Customers that are accounting entries, not real sales — excluded from all B2B
// figures (C-0142 = "Adjustment"). Add codes here to exclude more.
export const B2B_EXCLUDED_CODES = ["C-0142"];
// Reusable SQL fragment: drops blank customers + the excluded codes. Append after
// the date predicate in any SalesInvoiceLine / SalesCrMemoLine WHERE clause.
export const B2B_CUST_FILTER =
  `AND [Sell-to Customer No_] <> '' AND [Sell-to Customer No_] NOT IN (${B2B_EXCLUDED_CODES.map(c => `'${c}'`).join(",")})`;

// B2B / Head-Office revenue = SalesInvoiceLine (invoices) net of SalesCrMemoLine
// (credit memos / returns), VAT-inclusive — the SAME definition as the B2B tab.
// (B2B doesn't flow through the POS / TransSalesEntry, so it reads 0 there.)
const B2B_NET_SQL = `
  SELECT COALESCE(SUM(egp),0) AS egp, COALESCE(SUM(units),0) AS units FROM (
    SELECT [Amount Including VAT] AS egp, [Quantity] AS units
      FROM SalesInvoiceLine WHERE CAST([Posting Date] AS DATE) BETWEEN @from AND @to ${B2B_CUST_FILTER}
    UNION ALL
    SELECT -[Amount Including VAT], -[Quantity]
      FROM SalesCrMemoLine   WHERE CAST([Posting Date] AS DATE) BETWEEN @from AND @to ${B2B_CUST_FILTER}
  ) t`;

// B2B = NAV invoices (net of credit memos) PLUS factory-direct sales from the live
// sheet (Carrefour, Amazon, …) which don't flow through NAV. Factory failures
// degrade to NAV-only so a sheet hiccup never zeroes B2B.
export async function getB2BRevenue(from: string, to: string): Promise<{ egp: number; units: number }> {
  maybeRefreshFactoryDirect(); // non-blocking: keep the sheet ≤12h fresh on any B2B view
  const [rows, fd] = await Promise.all([
    navQuery<{ egp: number; units: number }>(B2B_NET_SQL, { from, to }),
    getFactoryDirectTotal(from, to).catch(() => ({ egp: 0, units: 0 })),
  ]);
  return {
    egp:   Math.round(Number(rows[0]?.egp || 0)) + fd.egp,
    units: Math.round(Number(rows[0]?.units || 0)) + fd.units,
  };
}
