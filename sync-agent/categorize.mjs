import pg from "pg";

const PG_URL =
  process.env.PG_URL ||
  "postgresql://postgres:DvkmXQgsxLbXClloESxOSFYmnPJCWrFK@acela.proxy.rlwy.net:57254/retail_intelligence";

const BRAND_MAP = {
  SAMSONITE: "Samsonite",
  "AM-TOUR": "American Tourister",
  "HI-SIERRA": "High Sierra",
  KAMILIANT: "Kamiliant",
  LIPALUT: "Lipault",
  SBL: "Samsonite Black Label",
  BANK: "Bank",
  HIGHLAND: "Highland",
  CHINES: "Other",
  "No Category": "Other",
};

const COLOURS = {
  BLACK: "Black", BLK: "Black", NAVY: "Navy", BLUE: "Blue", BLU: "Blue",
  GREY: "Grey", GRAY: "Grey", GRY: "Grey", RED: "Red", GREEN: "Green", GRN: "Green",
  PINK: "Pink", PURPLE: "Purple", WHITE: "White", BROWN: "Brown", BEIGE: "Beige",
  ORANGE: "Orange", YELLOW: "Yellow", GOLD: "Gold", SILVER: "Silver", TEAL: "Teal",
  TURQUOISE: "Turquoise", MAROON: "Maroon", BURGUNDY: "Burgundy", KHAKI: "Khaki",
  OLIVE: "Olive", CORAL: "Coral", MINT: "Mint", LIME: "Lime", CHARCOAL: "Charcoal",
  "R/Y": "Red/Yellow", "P/W": "Pink/White", "B/W": "Black/White",
};

function parseSize(desc) {
  const cm = desc.match(/(\d{2,3})\s?CM/i);
  if (cm) {
    const n = parseInt(cm[1]);
    if (n <= 45) return { size: "Underseater", detail: `${n}cm` };
    if (n <= 57) return { size: "Cabin", detail: `${n}cm` };
    if (n <= 70) return { size: "Medium", detail: `${n}cm` };
    if (n <= 79) return { size: "Large", detail: `${n}cm` };
    return { size: "Extra Large", detail: `${n}cm` };
  }
  const upr = desc.match(/UPR\.?\s?(\d{2})/i);
  if (upr) {
    const n = parseInt(upr[1]);
    if (n <= 45) return { size: "Underseater", detail: `${n}cm` };
    if (n <= 57) return { size: "Cabin", detail: `${n}cm` };
    if (n <= 70) return { size: "Medium", detail: `${n}cm` };
    return { size: "Large", detail: `${n}cm` };
  }
  const inch = desc.match(/(\d{2}(?:\.\d)?)["”]|(\d{2}\.\d)\b/);
  if (inch) {
    const n = parseFloat(inch[1] || inch[2]);
    if (n >= 13 && n <= 18) return { size: `Laptop ${n}"`, detail: `${n} inch` };
  }
  return { size: null, detail: null };
}

function parseColour(desc) {
  const upper = desc.toUpperCase();
  for (const [key, val] of Object.entries(COLOURS)) {
    if (new RegExp(`(^|[\\s/(-])${key.replace("/", "\\/")}([\\s/).-]|$)`).test(upper)) return val;
  }
  return null;
}

const CATEGORY_RULES = [
  { re: /SPINNER|\bSP\b/i, cat: "Luggage", sub: null },
  { re: /\bUPR\.?\s?\d{2}|UPRIGHT/i, cat: "Luggage", sub: "Softside" },
  { re: /\b(BP|BACKPACK|BACK PACK)\b/i, cat: "Backpacks", sub: null },
  { re: /DUFFLE|DUFFEL/i, cat: "Bags", sub: "Duffles" },
  { re: /CROSSOVER|CROSS OVER|MESSENGER|SLING/i, cat: "Bags", sub: "Crossover" },
  { re: /BAILHANDLE|BRIEFCASE|3-WAY|3 WAY/i, cat: "Bags", sub: "Briefcase" },
  { re: /TOTE|HANDBAG|HOBO|SHOULDER BAG/i, cat: "Bags", sub: "Ladies" },
  { re: /PENCIL|PEN CASE/i, cat: "Kids & School", sub: "Pencil cases" },
  { re: /SCHOOL|TROLLEY BAG/i, cat: "Kids & School", sub: null },
  { re: /PILLOW|LOCK|COVER|TAG\b|PACKING|CUBE|POUCH|ADAPTOR|ADAPTER|SCALE|STRAP/i, cat: "Accessories", sub: null },
  { re: /WALLET|PASSPORT/i, cat: "Accessories", sub: null },
  { re: /\bBAG\b/i, cat: "Bags", sub: null },
];

function parseCategory(desc, group) {
  for (const rule of CATEGORY_RULES) {
    if (rule.re.test(desc)) return { category: rule.cat, sub: rule.sub };
  }
  const g = (group || "").toUpperCase();
  if (g.includes("TRAVEL")) return { category: "Luggage", sub: null };
  if (g.includes("SCHOOL")) return { category: "Kids & School", sub: null };
  if (g.includes("BACKPACK") || g === "BBACKPACK" || g === "SBL- BP") return { category: "Backpacks", sub: null };
  if (g.includes("BUSINESS")) return { category: "Bags", sub: "Briefcase" };
  if (g.includes("ACCESSORI")) return { category: "Accessories", sub: null };
  if (g.includes("LADIES")) return { category: "Bags", sub: "Ladies" };
  if (g.includes("SPORT")) return { category: "Backpacks", sub: "Active" };
  if (g.includes("CASUAL")) return { category: "Bags", sub: null };
  return { category: null, sub: null };
}

function parseUsage(desc, group, category) {
  const g = (group || "").toUpperCase();
  const d = desc.toUpperCase();
  if (g.includes("BUSINESS") || /PRO-DLX|OPENROAD|LAPTOP|15\.6|14"|17"/.test(d)) return "Business";
  if (g.includes("SCHOOL") || /SCHOOL|KIZTOPIA|DISNEY|HEDGEHOG|KIDS/.test(d)) return "Kids & School";
  if (g.includes("SPORT")) return "Sport";
  if (g.includes("CASUAL") || g.includes("LADIES")) return "Casual";
  if (category === "Luggage") return "Travel";
  if (category === "Accessories") return "Travel";
  return null;
}

const LINE_STOPWORDS = new Set([
  "SAM", "AMT", "AT", "SBL", "HS", "KAM", "SP", "BP", "UPR", "EXP", "TSA", "THE",
  "SPINNER", "BACKPACK", "DUFFLE", "CROSSOVER", "BAILHANDLE", "TOTE", "BAG", "WHEEL",
  "HARDSIDE", "SOFTSIDE", "CABIN", "MEDIUM", "LARGE", "SMALL", "NEW", "WAY",
]);

function parseLine(desc) {
  let d = desc.replace(/[A-Z]{1,3}\d\s?-\s?\d{2}\s?\d{0,3}/g, "");
  d = d.replace(/\d{2,3}\s?CM|\d{2}(\.\d)?["”]|UPR\.?\s?\d{2}/gi, "");
  const words = d.split(/[\s/]+/).filter((w) => {
    const u = w.toUpperCase().replace(/[^A-Z0-9-]/g, "");
    return u.length >= 3 && !LINE_STOPWORDS.has(u) && !COLOURS[u] && !/^\d+$/.test(u);
  });
  if (!words.length) return null;
  const line = words.slice(0, 2).join(" ").replace(/[^\w\s-]/g, "").trim();
  return line || null;
}

const pgc = new pg.Client({ connectionString: PG_URL });
await pgc.connect();

await pgc.query(`
  CREATE TABLE IF NOT EXISTS item_categorisation (
    item_no TEXT PRIMARY KEY,
    description TEXT,
    brand TEXT,
    category TEXT,
    subcategory TEXT,
    size TEXT,
    size_detail TEXT,
    colour TEXT,
    line_name TEXT,
    usage TEXT,
    confidence NUMERIC,
    method TEXT DEFAULT 'rules',
    approved BOOLEAN DEFAULT FALSE,
    needs_review BOOLEAN DEFAULT FALSE,
    updated_at TIMESTAMPTZ DEFAULT now()
  );
`);

const { rows } = await pgc.query(
  "SELECT item_no, description, brand, item_group FROM warehouse_stock WHERE description IS NOT NULL AND length(trim(description)) > 3"
);
console.log(`categorising ${rows.length} items...`);

const stats = { full: 0, partial: 0, weak: 0 };
const results = [];
for (const r of rows) {
  const desc = r.description.trim();
  const brand = BRAND_MAP[r.brand] || r.brand || null;
  const { size, detail } = parseSize(desc);
  const colour = parseColour(desc);
  const { category, sub } = parseCategory(desc, r.item_group);
  const usage = parseUsage(desc, r.item_group, category);
  const line = parseLine(desc);

  let score = 0;
  if (brand) score += 0.2;
  if (category) score += 0.3;
  if (colour) score += 0.15;
  if (size) score += 0.15;
  if (line) score += 0.2;
  const needsReview = score < 0.65;
  if (score >= 0.85) stats.full++;
  else if (score >= 0.65) stats.partial++;
  else stats.weak++;

  results.push([r.item_no, desc, brand, category, sub, size, detail, colour, line, usage, score, needsReview]);
}

const batchSize = 200;
for (let i = 0; i < results.length; i += batchSize) {
  const batch = results.slice(i, i + batchSize);
  const values = batch.map((_, j) => {
    const b = j * 12;
    return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},$${b + 11},$${b + 12},now())`;
  });
  await pgc.query(
    `INSERT INTO item_categorisation (item_no, description, brand, category, subcategory, size, size_detail, colour, line_name, usage, confidence, needs_review, updated_at)
     VALUES ${values.join(",")}
     ON CONFLICT (item_no) DO UPDATE SET description=EXCLUDED.description, brand=EXCLUDED.brand,
       category=EXCLUDED.category, subcategory=EXCLUDED.subcategory, size=EXCLUDED.size,
       size_detail=EXCLUDED.size_detail, colour=EXCLUDED.colour, line_name=EXCLUDED.line_name,
       usage=EXCLUDED.usage, confidence=EXCLUDED.confidence, needs_review=EXCLUDED.needs_review, updated_at=now()`,
    batch.flat()
  );
}

console.log(`done. high confidence: ${stats.full}, medium: ${stats.partial}, needs AI review: ${stats.weak}`);

const summary = await pgc.query(
  "SELECT category, COUNT(*) n FROM item_categorisation GROUP BY category ORDER BY n DESC"
);
console.table(summary.rows);
const colours = await pgc.query(
  "SELECT colour, COUNT(*) n FROM item_categorisation WHERE colour IS NOT NULL GROUP BY colour ORDER BY n DESC LIMIT 12"
);
console.table(colours.rows);
const sizes = await pgc.query(
  "SELECT size, COUNT(*) n FROM item_categorisation WHERE size IS NOT NULL GROUP BY size ORDER BY n DESC"
);
console.table(sizes.rows);
await pgc.end();
