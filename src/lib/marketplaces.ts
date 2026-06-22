// Marketplace channel = NAV `ONLINE` store, split by [Staff ID] (that's how the
// business tags each marketplace on the POS). Confirmed 2026-06-22 from the NAV
// employee master:
//   1010 = Amazon (MARKETPLACE — NOT the Amazon-retail customer in HO/B2B)
//   1011 = Jumia
//   1012 = Noon
//   1015 = B-Tech
// Excluded: 1056 = own websites (Sam + AMT) → already counted via Shopify; 204 = test.
export const MARKETPLACE_STAFF: Record<string, string> = {
  "1010": "Amazon",
  "1011": "Jumia",
  "1012": "Noon",
  "1015": "B-Tech",
};

export const MARKETPLACE_STAFF_IDS = Object.keys(MARKETPLACE_STAFF);

/** SQL fragment: AND [Store No_]='ONLINE' AND [Staff ID] IN ('1010',...) */
export const MARKETPLACE_WHERE =
  `AND [Store No_] = 'ONLINE' AND [Staff ID] IN (${MARKETPLACE_STAFF_IDS.map(s => `'${s}'`).join(",")})`;

export function marketplaceName(staffId: string): string {
  return MARKETPLACE_STAFF[staffId] ?? staffId;
}
