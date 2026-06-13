import pg from "pg";

const PG_URL =
  process.env.PG_URL ||
  "postgresql://postgres:DvkmXQgsxLbXClloESxOSFYmnPJCWrFK@acela.proxy.rlwy.net:57254/retail_intelligence";

const pgc = new pg.Client({ connectionString: PG_URL });
await pgc.connect();

// 1. Add colour_group column (closest normal colour for filtering)
await pgc.query(`
  ALTER TABLE item_categorisation
  ADD COLUMN IF NOT EXISTS colour_exact TEXT,
  ADD COLUMN IF NOT EXISTS colour_group TEXT;
`);
console.log("added colour_exact + colour_group columns");

// 2. Round 2 quiz corrections

// Q1: J6 = print/pattern code — mark line_name correctly for Curve Unicorn Clouds
await pgc.query(`
  UPDATE item_categorisation
  SET line_name = 'Curve', confidence = 0.9, needs_review = false, method = 'user-confirmed'
  WHERE description ILIKE '%CURVE%' AND description ILIKE '%J6%';
`);

// Q2: Rosewood = own named colour (no change needed, keep as-is)

// Q3: Bank brand = separate category
await pgc.query(`
  UPDATE item_categorisation
  SET category = 'Bank', subcategory = NULL, confidence = 0.9, needs_review = false, method = 'user-confirmed'
  WHERE brand = 'Bank';
`);
console.log("Bank items moved to Bank category");

// Q4: Z19 = AMT Accessories line (locks/tags/straps) — confirmed by Group
await pgc.query(`
  UPDATE item_categorisation
  SET category = 'Accessories', line_name = 'Z19', confidence = 0.8, needs_review = false, method = 'group-confirmed'
  WHERE description ~ '^\\s*Z19\\s*-' AND (category IS NULL OR category = 'Accessories');
`);
console.log("Z19 items categorised as Accessories");

// Q5: 81S = AMT Amber briefcase (Business bags)
await pgc.query(`
  UPDATE item_categorisation
  SET category = 'Bags', subcategory = 'Briefcase', line_name = 'Amber', usage = 'Business',
      confidence = 0.85, needs_review = false, method = 'user-confirmed'
  WHERE description ~ '81[Ss]' AND brand = 'American Tourister';
`);
console.log("81S items categorised as Bags/Briefcase (Amber line)");

// 3. Populate colour_exact = current colour value (preserve exact colour name)
await pgc.query(`
  UPDATE item_categorisation SET colour_exact = colour WHERE colour IS NOT NULL AND colour_exact IS NULL;
`);

// 4. Colour group mapping: exact → closest normal colour
const colourGroupMap = {
  "Dry Rose": "Pink",
  "Rosewood": "Pink",
  "Coral": "Orange",
  "Maroon": "Red",
  "Burgundy": "Red",
  "Mint": "Green",
  "Lime": "Green",
  "Teal": "Blue",
  "Turquoise": "Blue",
  "Navy": "Blue",
  "Charcoal": "Grey",
  "Khaki": "Beige",
  "Olive": "Green",
  "Gold": "Yellow",
  "Silver": "Grey",
  "Pink/White": "Pink",
  "Red/Yellow": "Red",
  "Black/White": "Black",
};

// Direct mappings (exact = group for standard colours)
const directColours = ["Black", "Blue", "Grey", "Red", "Green", "Yellow", "Pink", "White", "Brown", "Purple", "Orange", "Beige", "Silver", "Gold"];

for (const c of directColours) {
  await pgc.query(
    `UPDATE item_categorisation SET colour_group = $1 WHERE colour_exact = $1 AND colour_group IS NULL`,
    [c]
  );
}

for (const [exact, group] of Object.entries(colourGroupMap)) {
  await pgc.query(
    `UPDATE item_categorisation SET colour_group = $1 WHERE colour_exact = $2 AND colour_group IS NULL`,
    [group, exact]
  );
}

// Fallback: colour_group = colour_exact for anything unmapped
await pgc.query(`
  UPDATE item_categorisation SET colour_group = colour_exact WHERE colour_exact IS NOT NULL AND colour_group IS NULL;
`);

console.log("colour_exact + colour_group populated");

// Stats
const stats = await pgc.query(`
  SELECT colour_exact, colour_group, COUNT(*) n
  FROM item_categorisation
  WHERE colour_exact IS NOT NULL
  GROUP BY colour_exact, colour_group
  ORDER BY n DESC
  LIMIT 30
`);
console.log("\nColour mapping preview:");
console.table(stats.rows);

const cats = await pgc.query(`
  SELECT category, COUNT(*) n FROM item_categorisation GROUP BY category ORDER BY n DESC
`);
console.log("\nCategory counts after corrections:");
console.table(cats.rows);

await pgc.end();
