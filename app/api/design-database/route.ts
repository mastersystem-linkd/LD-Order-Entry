import { and, count, desc, eq, ilike, or } from "drizzle-orm";

import { jsonData, requireRole } from "@/lib/api";
import { db } from "@/lib/db";
import { designDatabase } from "@/db/schema";

const PAGE_SIZE = 25;

// GET /api/design-database?search=&fabric=&page= — browsable design log (ADMIN),
// newest first. Also the source behind the design autocomplete.
export async function GET(req: Request) {
  const guard = await requireRole(["ADMIN"]);
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const search = url.searchParams.get("search")?.trim() ?? "";
  const fabric = url.searchParams.get("fabric")?.trim() ?? "";
  const page = Math.max(
    1,
    Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1,
  );

  const filters = [];
  if (search) {
    filters.push(
      or(
        ilike(designDatabase.orderNo, `%${search}%`),
        ilike(designDatabase.fabricName, `%${search}%`),
        ilike(designDatabase.designNo, `%${search}%`),
      ),
    );
  }
  if (fabric) filters.push(eq(designDatabase.fabricName, fabric));
  const where = filters.length ? and(...filters) : undefined;

  const [{ value: total }] = await db
    .select({ value: count() })
    .from(designDatabase)
    .where(where);

  const rows = await db
    .select({
      id: designDatabase.id,
      created_at: designDatabase.createdAt,
      order_no: designDatabase.orderNo,
      fabric_name: designDatabase.fabricName,
      design_no: designDatabase.designNo,
    })
    .from(designDatabase)
    .where(where)
    .orderBy(desc(designDatabase.createdAt))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  return jsonData({
    designs: rows,
    page,
    page_size: PAGE_SIZE,
    total,
    total_pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  });
}
