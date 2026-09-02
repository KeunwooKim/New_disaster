import type { NextRequest } from "next/server";
import { ingestAll } from "@/lib/ingest";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const provided =
      request.headers.get("x-cron-secret") ?? request.nextUrl.searchParams.get("secret");
    if (provided !== secret) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
  }
  const result = await ingestAll();
  return Response.json(result);
}

export async function GET(request: NextRequest) {
  return POST(request);
}
