import { NextResponse } from "next/server";
import { navQuery } from "@/lib/nav";
import { askClaude } from "@/lib/claude";
import { prisma } from "@/lib/prisma";

const SYSTEM_PROMPT = `You are an expert retail merchandise analyst.
You will receive a list of product items from a luggage/travel goods company (Samsonite, American Tourister brands).
Analyse every item and propose a schema with these dimensions:
- category (e.g. Hardside Luggage, Softside Luggage, Backpacks, Accessories)
- line_name (product line e.g. Cosmolite, Flux, Spark SNG)
- colour (standardised colour names)
- size (standardised sizes e.g. Cabin, Medium, Large, Extra Large, or cm where known)
- material (e.g. Polycarbonate, Polypropylene, Fabric, Leather)

Return ONLY a valid JSON array. Each object must have:
{
  "rawValue": "original item name or code",
  "category": "...",
  "line_name": "...",
  "colour": "...",
  "size": "...",
  "material": "...",
  "confidence": 0.0-1.0,
  "notes": "any uncertainty or flags"
}

Be consistent. If unsure, set confidence below 0.8 and explain in notes.`;

export async function POST() {
  try {
    const items = await navQuery<{ No_: string; Description: string; Description2?: string }>(
      `SELECT TOP 500 No_, Description, [Description 2] as Description2 FROM [Item] WHERE Blocked = 0 ORDER BY No_`
    );

    if (!items.length) {
      return NextResponse.json({ error: "No items found in NAV" }, { status: 404 });
    }

    const itemList = items
      .map((i) => `${i.No_} | ${i.Description}${i.Description2 ? " " + i.Description2 : ""}`)
      .join("\n");

    const response = await askClaude(
      SYSTEM_PROMPT,
      `Here are the items to categorise:\n\n${itemList}`,
      { maxTokens: 8000 }
    );

    let parsed: Record<string, unknown>[];
    try {
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
    } catch {
      return NextResponse.json({ error: "AI response could not be parsed", raw: response }, { status: 500 });
    }

    await prisma.itemSchema.deleteMany({ where: { approved: false } });

    const dimensions = ["category", "line_name", "colour", "size", "material"] as const;
    const records = [];

    for (const item of parsed) {
      for (const dim of dimensions) {
        if (item[dim]) {
          records.push({
            rawValue: item.rawValue as string,
            dimension: dim,
            mappedValue: item[dim] as string,
            confidence: (item.confidence as number) || 0.9,
            approved: false,
          });
        }
      }
    }

    await prisma.itemSchema.createMany({ data: records, skipDuplicates: true });

    return NextResponse.json({
      scanned: items.length,
      categorised: parsed.length,
      records: records.length,
      preview: parsed.slice(0, 10),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
