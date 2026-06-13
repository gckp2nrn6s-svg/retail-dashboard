import pg from "pg";

const PG_URL =
  process.env.PG_URL ||
  "postgresql://postgres:DvkmXQgsxLbXClloESxOSFYmnPJCWrFK@acela.proxy.rlwy.net:57254/retail_intelligence";

const pgc = new pg.Client({ connectionString: PG_URL });
await pgc.connect();

await pgc.query(`
  UPDATE item_categorisation SET subcategory='Lunch boxes', confidence=0.95, needs_review=false, method='user-confirmed'
  WHERE description ILIKE '%LUNCH BOX%';
  UPDATE item_categorisation SET colour='Purple', confidence=0.95, needs_review=false, method='user-confirmed'
  WHERE item_no='20762';
  UPDATE item_categorisation SET subcategory='Softside', confidence=0.9, method='user-confirmed'
  WHERE line_name ILIKE 'STANFORD%';
  UPDATE item_categorisation SET subcategory='Hardside', colour='Dry Rose', size='Extra Large', size_detail='81cm',
    line_name='Instagon', confidence=0.95, needs_review=false, method='user-confirmed'
  WHERE description ILIKE '%INSTAGON%81%';
  UPDATE item_categorisation SET subcategory='Hardside', line_name='Instagon', colour=COALESCE(colour,'Dry Rose')
  WHERE description ILIKE '%INSTAGON%';
`);
console.log("quiz corrections applied");

const { rows: training } = await pgc.query(`
  SELECT description, colour FROM item_categorisation
  WHERE colour IS NOT NULL AND description ~ '[A-Z]{1,3}[0-9O]\\s?-\\s?[0-9]{2}'
`);

const codeVotes = {};
for (const r of training) {
  const m = r.description.match(/[A-Z]{1,3}[0-9O]\s?-\s?(\d{2})/);
  if (!m) continue;
  const code = m[1];
  codeVotes[code] = codeVotes[code] || {};
  codeVotes[code][r.colour] = (codeVotes[code][r.colour] || 0) + 1;
}

const codeMap = {};
for (const [code, votes] of Object.entries(codeVotes)) {
  const sorted = Object.entries(votes).sort((a, b) => b[1] - a[1]);
  const [winner, count] = sorted[0];
  const total = Object.values(votes).reduce((a, b) => a + b, 0);
  if (count >= 3 && count / total >= 0.6) {
    codeMap[code] = { colour: winner, share: Math.round((count / total) * 100), n: total };
  }
}
console.log("learned colour codes:");
for (const [code, v] of Object.entries(codeMap).sort()) {
  console.log(`  ${code} -> ${v.colour} (${v.share}% of ${v.n} examples)`);
}

const { rows: missing } = await pgc.query(`
  SELECT item_no, description FROM item_categorisation
  WHERE colour IS NULL AND description ~ '[A-Z]{1,3}[0-9O]\\s?-\\s?[0-9]{2}'
`);
let applied = 0;
for (const r of missing) {
  const m = r.description.match(/[A-Z]{1,3}[0-9O]\s?-\s?(\d{2})/);
  if (m && codeMap[m[1]]) {
    await pgc.query(
      `UPDATE item_categorisation SET colour=$1, method='colour-code', confidence=LEAST(confidence+0.15,0.9), updated_at=now() WHERE item_no=$2`,
      [codeMap[m[1]].colour, r.item_no]
    );
    applied++;
  }
}
console.log(`applied colour codes to ${applied} items that had no colour`);

const { rows: after } = await pgc.query(`
  SELECT COUNT(*) FILTER (WHERE colour IS NOT NULL) with_colour, COUNT(*) total FROM item_categorisation
`);
console.log(`colour coverage now: ${after[0].with_colour}/${after[0].total}`);
await pgc.end();
