import type { NextRequest } from "next/server";
import { listEvents } from "@/lib/db";
import { seedIfEmpty } from "@/lib/seed";
import { EVENT_SOURCES } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const sourceParam = request.nextUrl.searchParams.get("source");
  const source = EVENT_SOURCES.find((item) => item === sourceParam);
  seedIfEmpty();
  return Response.json({ events: listEvents(source) });
}
