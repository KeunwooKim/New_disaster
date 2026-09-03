import type { NextRequest } from "next/server";
import {
  countEvents,
  DEFAULT_EVENT_LIMIT,
  listEventDayCounts,
  listEvents,
  listEventsInRange,
  MAX_EVENT_LIMIT,
} from "@/lib/db";
import { seoulDay } from "@/lib/event-display";
import { seedIfEmpty } from "@/lib/seed";
import { EVENT_SOURCES } from "@/lib/types";

export const dynamic = "force-dynamic";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDay(value: string | null): string | null {
  if (!value || !DAY_RE.test(value)) return null;
  const time = new Date(`${value}T00:00:00+09:00`).getTime();
  return Number.isNaN(time) ? null : value;
}

function parseLimit(value: string | null): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_EVENT_LIMIT;
  return Math.min(Math.max(1, Math.trunc(n)), MAX_EVENT_LIMIT);
}

export async function GET(request: NextRequest) {
  const sourceParam = request.nextUrl.searchParams.get("source");
  const source = EVENT_SOURCES.find((item) => item === sourceParam);
  seedIfEmpty();

  const recentLimit = parseLimit(request.nextUrl.searchParams.get("limit"));
  const recent = listEvents(source, recentLimit);
  const recentFrom = recent.length > 0 ? seoulDay(recent[recent.length - 1].occurredAt) : null;
  const recentTo = recent.length > 0 ? seoulDay(recent[0].occurredAt) : null;

  let from = parseDay(request.nextUrl.searchParams.get("from"));
  let to = parseDay(request.nextUrl.searchParams.get("to"));
  if (from && !to) to = from;
  if (to && !from) from = to;
  if (from && to && from > to) {
    const swap = from;
    from = to;
    to = swap;
  }

  const events = from && to ? listEventsInRange(from, to, source, MAX_EVENT_LIMIT) : recent;
  const days: Record<string, number> = {};
  for (const row of listEventDayCounts(source)) days[row.day] = row.count;

  return Response.json({
    events,
    meta: {
      total: countEvents(),
      returned: events.length,
      mode: from && to ? "range" : "recent",
      limit: recentLimit,
      from,
      to,
      recentFrom,
      recentTo,
      days,
    },
  });
}
