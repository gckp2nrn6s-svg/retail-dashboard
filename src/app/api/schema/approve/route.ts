import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const items = await prisma.itemSchema.findMany({
    orderBy: [{ dimension: "asc" }, { mappedValue: "asc" }],
  });

  const grouped: Record<string, typeof items> = {};
  for (const item of items) {
    if (!grouped[item.dimension]) grouped[item.dimension] = [];
    grouped[item.dimension].push(item);
  }

  return NextResponse.json(grouped);
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, mappedValue, approved } = body;

  const updated = await prisma.itemSchema.update({
    where: { id },
    data: {
      ...(mappedValue !== undefined && { mappedValue }),
      ...(approved !== undefined && { approved }),
    },
  });

  return NextResponse.json(updated);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { approveAll } = body;

  if (approveAll) {
    await prisma.itemSchema.updateMany({
      where: { approved: false },
      data: { approved: true },
    });

    await prisma.schemaVersion.updateMany({
      where: { isActive: true },
      data: { isActive: false },
    });

    await prisma.schemaVersion.create({
      data: {
        isActive: true,
        approvedAt: new Date(),
        approvedBy: "admin",
      },
    });

    return NextResponse.json({ ok: true, message: "Schema approved and activated" });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
