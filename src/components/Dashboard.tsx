"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AlertEvent, EventSource, IngestResult } from "@/lib/types";
import { DATA_CREDIT_LINE, EVENT_SOURCE_CREDIT, EVENT_SOURCE_LABEL, EVENT_SOURCES } from "@/lib/types";
import { disasterStyle, disasterTypeOf, mapKindForEvent } from "@/lib/map-shape";
import { DateFilter } from "./DateFilter";
import { eventPlaceLine, formatOccurredAt, formatOccurredShort, seoulDay } from "@/lib/event-display";

const AlertMap = dynamic(() => import("./AlertMap").then((mod) => mod.AlertMap), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-[#93a0b8]">
      지도를 불러오는 중…
    </div>
  ),
});

type SourceFilter = "all" | EventSource;

function statusLabel(event: AlertEvent): string {
  if (event.analysisStatus === "ner") return "NER 위치";
  if (event.analysisStatus === "llm") return "LLM 위치";
  if (event.analysisStatus === "rules") return "규칙 파싱";
  if (event.analysisStatus === "pending") return "분석 대기";
  return "분석 실패";
}

function coordLabel(event: AlertEvent): string | null {
  if (event.lat == null || event.lng == null) {
    return event.geocodeStatus === "pending" ? "좌표 대기" : "좌표 없음";
  }
  const kind =
    event.geocodeStatus === "nominatim"
      ? "주소 좌표"
      : event.geocodeStatus === "official"
        ? "공식 좌표"
        : event.geocodeStatus === "centroid"
        ? "시군 중심"
        : event.geocodeStatus === "cache"
          ? "캐시 좌표"
          : "좌표";
  return `${kind} ${event.lat.toFixed(5)}, ${event.lng.toFixed(5)}`;
}

function matchesQuery(event: AlertEvent, query: string): boolean {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const hay = [
    event.rawText,
    event.llm?.summary ?? "",
    ...(event.llm?.locations ?? []),
    ...event.regions,
  ]
    .join(" ")
    .toLowerCase();
  return tokens.every((token) => hay.includes(token));
}

function regionKey(label: string): string | null {
  const trimmed = label.trim();
  if (!trimmed) return null;
  const tokens = trimmed.split(/\s+/);
  const hit = [...tokens]
    .reverse()
    .find((token) => /(시|군|구)$/.test(token) && !/(특별시|광역시)$/.test(token));
  return hit ?? trimmed;
}

function countByType(events: AlertEvent[]): Array<{ type: string; count: number }> {
  const counts = new Map<string, number>();
  for (const event of events) {
    const type = disasterTypeOf(event);
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type, "ko"));
}

function topRegions(events: AlertEvent[], limit = 5): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const event of events) {
    const labels = event.llm?.locations?.length ? event.llm.locations : event.regions;
    const keys = new Set<string>();
    for (const label of labels) {
      const key = regionKey(label);
      if (key) keys.add(key);
    }
    for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ko"))
    .slice(0, limit);
}

export function Dashboard() {
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [queryDebounced, setQueryDebounced] = useState("");
  const [dateFrom, setDateFrom] = useState<string | null>(null);
  const [dateTo, setDateTo] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [ingesting, setIngesting] = useState(false);
  const [ingestInfo, setIngestInfo] = useState<string | null>(null);
  const [meta, setMeta] = useState({
    total: 0,
    returned: 0,
    limit: 200,
    recentFrom: null as string | null,
    recentTo: null as string | null,
    days: {} as Record<string, number>,
  });

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (dateFrom && dateTo) {
      params.set("from", dateFrom);
      params.set("to", dateTo);
    } else {
      params.set("limit", "200");
    }
    const response = await fetch(`/api/events?${params}`, { cache: "no-store" });
    const data = (await response.json()) as {
      events: AlertEvent[];
      meta?: {
        total: number;
        returned: number;
        limit: number;
        recentFrom: string | null;
        recentTo: string | null;
        days: Record<string, number>;
      };
    };
    setEvents(data.events);
    if (data.meta) {
      setMeta({
        total: data.meta.total,
        returned: data.meta.returned,
        limit: data.meta.limit,
        recentFrom: data.meta.recentFrom,
        recentTo: data.meta.recentTo,
        days: data.meta.days,
      });
    }
    setLoading(false);
  }, [dateFrom, dateTo]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    const timer = setTimeout(() => setQueryDebounced(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const bySource = useMemo(
    () =>
      sourceFilter === "all" ? events : events.filter((event) => event.source === sourceFilter),
    [events, sourceFilter],
  );

  const typeOptions = useMemo(() => countByType(bySource), [bySource]);

  useEffect(() => {
    if (typeFilter !== "all" && !typeOptions.some((row) => row.type === typeFilter)) {
      setTypeFilter("all");
    }
  }, [typeFilter, typeOptions]);

  const visible = useMemo(
    () =>
      bySource.filter((event) => {
        if (typeFilter !== "all" && disasterTypeOf(event) !== typeFilter) return false;
        return matchesQuery(event, queryDebounced);
      }),
    [bySource, typeFilter, queryDebounced],
  );

  const stats = useMemo(() => {
    const now = Date.now();
    const today = seoulDay(new Date().toISOString());
    return {
      total: visible.length,
      today: visible.filter((event) => seoulDay(event.occurredAt) === today).length,
      last24h: visible.filter((event) => {
        const at = new Date(event.occurredAt).getTime();
        return !Number.isNaN(at) && now - at <= 24 * 60 * 60 * 1000;
      }).length,
      byType: countByType(visible),
      regions: topRegions(visible),
    };
  }, [visible]);

  const selected = visible.find((event) => event.id === selectedId) ?? null;
  const mapEvents = selected ? [selected] : visible;

  async function runIngest() {
    setIngesting(true);
    setIngestInfo(null);
    try {
      const response = await fetch("/api/ingest", { method: "POST" });
      const data = (await response.json()) as IngestResult;
      setIngestInfo(
        `수집 ${data.fetched} · 신규 ${data.inserted} · 분석 ${data.analyzed} · 좌표 ${data.geocoded}${
          data.errors.length ? ` · 주의 ${data.errors.length}` : ""
        }`,
      );
      await load();
    } catch (error) {
      setIngestInfo(error instanceof Error ? error.message : "수집 실패");
    } finally {
      setIngesting(false);
    }
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#243049] bg-[#121b2e] px-4 py-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">도심 재난 알림</h1>
          <p className="text-xs text-[#93a0b8]">재난문자 · 기상특보 · 지진 · 태풍 · 산사태 · 실종</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(["all", ...EVENT_SOURCES] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setSourceFilter(value);
                setTypeFilter("all");
                setSelectedId(null);
              }}
              className={`rounded-full px-3 py-1 text-sm ${
                sourceFilter === value ? "bg-white text-[#0b1220]" : "bg-[#1b2740] text-[#d5deee]"
              }`}
            >
              {value === "all" ? "전체" : EVENT_SOURCE_LABEL[value]}
            </button>
          ))}
          <button
            type="button"
            onClick={() => void runIngest()}
            disabled={ingesting}
            className="rounded-full bg-[#ef4444] px-3 py-1 text-sm text-white disabled:opacity-60"
          >
            {ingesting ? "수집 중…" : "지금 수집"}
          </button>
        </div>
      </header>

      {ingestInfo ? (
        <p className="border-b border-[#243049] bg-[#1b2740] px-4 py-2 text-xs text-[#d5deee]">
          {ingestInfo}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-b border-[#243049] bg-[#121b2e] px-4 py-2">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="위치·내용 검색"
          className="w-full max-w-xs rounded-full border border-[#243049] bg-[#0b1220] px-3 py-1.5 text-sm text-[#d5deee] outline-none placeholder:text-[#93a0b8] focus:border-[#93a0b8]"
        />
        <DateFilter
          recentFrom={meta.recentFrom}
          recentTo={meta.recentTo}
          from={dateFrom}
          to={dateTo}
          days={meta.days}
          total={meta.total}
          recentLimit={meta.limit}
          onRecent={() => {
            setDateFrom(null);
            setDateTo(null);
            setSelectedId(null);
          }}
          onRange={(nextFrom, nextTo) => {
            setDateFrom(nextFrom);
            setDateTo(nextTo);
            setSelectedId(null);
          }}
        />
        <button
          type="button"
          onClick={() => {
            setTypeFilter("all");
            setSelectedId(null);
          }}
          className={`rounded-full px-3 py-1 text-sm ${
            typeFilter === "all" ? "bg-white text-[#0b1220]" : "bg-[#1b2740] text-[#d5deee]"
          }`}
        >
          전체 종류
        </button>
        {typeOptions.map((row) => {
          const style = disasterStyle(row.type);
          const active = typeFilter === row.type;
          return (
            <button
              key={row.type}
              type="button"
              onClick={() => {
                setTypeFilter(row.type);
                setSelectedId(null);
              }}
              className={`rounded-full px-3 py-1 text-sm ${
                active ? "bg-white text-[#0b1220]" : "bg-[#1b2740] text-[#d5deee]"
              }`}
            >
              {style.emoji} {row.type}
              <span className={`ml-1 ${active ? "text-[#4b5563]" : "text-[#93a0b8]"}`}>{row.count}</span>
            </button>
          );
        })}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[340px_1fr_320px]">
        <aside className="min-h-0 overflow-y-auto border-b border-[#243049] lg:border-b-0 lg:border-r">
          {loading ? (
            <p className="p-4 text-sm text-[#93a0b8]">불러오는 중…</p>
          ) : visible.length === 0 ? (
            <p className="p-4 text-sm text-[#93a0b8]">
              {queryDebounced || typeFilter !== "all" || dateFrom
                ? "조건에 맞는 재난이 없습니다."
                : "표시할 이벤트가 없습니다."}
            </p>
          ) : (
            <ul>
              {visible.map((event) => {
                const active = event.id === selectedId;
                return (
                  <li key={event.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(event.id)}
                      className={`block w-full border-b border-[#243049] px-4 py-3 text-left ${
                        active ? "bg-[#1b2740]" : "hover:bg-[#162036]"
                      }`}
                    >
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span
                          className="rounded px-1.5 py-0.5 text-[11px] font-medium"
                          style={{
                            background: `${disasterStyle(disasterTypeOf(event)).color}33`,
                            color: disasterStyle(disasterTypeOf(event)).color,
                          }}
                        >
                          {disasterStyle(disasterTypeOf(event)).emoji} {disasterTypeOf(event)}
                        </span>
                        <span className="text-[11px] text-[#93a0b8]">{formatOccurredShort(event.occurredAt)}</span>
                      </div>
                      <p className="mb-1 text-[11px] text-[#93a0b8]">{EVENT_SOURCE_CREDIT[event.source]}</p>
                      <p className="line-clamp-2 text-sm">
                        {event.llm?.summary ?? event.rawText}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <section className="relative h-[50vh] min-h-[320px] lg:h-auto lg:min-h-0">
          <div className="absolute inset-0">
            <AlertMap
              events={mapEvents}
              isolated={Boolean(selected)}
              selectedId={selected?.id ?? null}
              onSelect={setSelectedId}
            />
          </div>
          {selected ? (
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className="absolute top-3 right-3 z-[1000] rounded-full bg-[#0b1220]/85 px-3 py-1 text-[12px] text-[#d5deee] shadow"
            >
              지도 전체 보기
            </button>
          ) : null}
          <div className="pointer-events-none absolute bottom-3 left-3 z-[1000] max-w-[min(92%,28rem)] rounded-md bg-[#0b1220]/85 px-2.5 py-1.5 text-[11px] leading-4 text-[#d5deee] shadow">
            <p>💧 호우 · 🔆 폭염 · ⚡ 정전 · 👤 실종 · 🚗 교통</p>
            <p className="text-[#93a0b8]">주의보·시군구는 색칠 · 실종·사고는 좌표 마커</p>
            <p className="mt-1 text-[#93a0b8]">{DATA_CREDIT_LINE}</p>
          </div>
        </section>

        <aside className="min-h-0 overflow-y-auto border-t border-[#243049] p-4 lg:border-l lg:border-t-0">
          {selected ? (
            <article className="space-y-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold">
                  {disasterStyle(disasterTypeOf(selected)).emoji} {disasterTypeOf(selected)}
                </h2>
                <span className="rounded bg-[#1b2740] px-1.5 py-0.5 text-[11px] text-[#d5deee]">
                  {EVENT_SOURCE_LABEL[selected.source]}
                </span>
              </div>
              <dl className="space-y-2 text-[13px]">
                <div>
                  <dt className="text-[11px] text-[#93a0b8]">출처</dt>
                  <dd className="mt-0.5">{EVENT_SOURCE_CREDIT[selected.source]}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-[#93a0b8]">발생 시각</dt>
                  <dd className="mt-0.5">{formatOccurredAt(selected.occurredAt)}</dd>
                </div>
                {eventPlaceLine(selected) ? (
                  <div>
                    <dt className="text-[11px] text-[#93a0b8]">위치</dt>
                    <dd className="mt-0.5">
                      {(selected.llm?.locations?.length ? selected.llm.locations : selected.regions).join(
                        ", ",
                      )}
                    </dd>
                  </div>
                ) : null}
                {coordLabel(selected) ? (
                  <div>
                    <dt className="text-[11px] text-[#93a0b8]">좌표</dt>
                    <dd className="mt-0.5">{coordLabel(selected)}</dd>
                  </div>
                ) : null}
              </dl>
              {selected.llm?.summary ? <p>{selected.llm.summary}</p> : null}
              {selected.llm?.actions ? (
                <p className="rounded-lg bg-[#1b2740] p-3 text-[#d5deee]">{selected.llm.actions}</p>
              ) : null}
              {selected.llm?.appearance ? (
                <p>
                  <span className="text-[#93a0b8]">인상 </span>
                  {selected.llm.appearance}
                </p>
              ) : null}
              {selected.llm?.clothing ? (
                <p>
                  <span className="text-[#93a0b8]">착의 </span>
                  {selected.llm.clothing}
                </p>
              ) : null}
              {selected.photoUrl ? (
                <div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={selected.photoUrl}
                    alt="실종자 공개 사진"
                    className="max-h-48 rounded-lg object-cover"
                  />
                  <p className="mt-1 text-[11px] text-[#93a0b8]">자료 출처: 경찰청</p>
                </div>
              ) : null}
              <div>
                <h3 className="mb-1 text-xs font-medium tracking-wide text-[#93a0b8]">원문</h3>
                <p className="whitespace-pre-wrap rounded-lg border border-[#243049] bg-[#0b1220] p-3 text-[#d5deee]">
                  {selected.rawText}
                </p>
              </div>
              <p className="text-[11px] text-[#93a0b8]">
                {statusLabel(selected)}
                {" · "}
                {mapKindForEvent(selected) === "area" ? "지도: 지역 범위" : "지도: 지점 마커"}
              </p>
            </article>
          ) : (
            <div className="space-y-4 text-sm">
              <div>
                <h2 className="text-base font-semibold">현재 목록</h2>
                <p className="mt-1 text-[#93a0b8]">
                  {stats.total}건
                  {dateFrom && dateTo
                    ? dateFrom === dateTo
                      ? ` · ${dateFrom}`
                      : ` · ${dateFrom} ~ ${dateTo}`
                    : ` · 최근 ${meta.limit}건`}
                  {meta.recentFrom && meta.recentTo && !dateFrom
                    ? ` (${meta.recentFrom.slice(5).replace("-", ".")}–${meta.recentTo.slice(5).replace("-", ".")})`
                    : ""}
                  {` · 오늘 ${stats.today} · 최근 24시간 ${stats.last24h}`}
                </p>
                <p className="mt-2 text-[12px] text-[#93a0b8]">
                  목록에서 재난을 고르면 지도에 그 건만 표시됩니다.
                </p>
                <p className="mt-3 text-[11px] leading-4 text-[#93a0b8]">{DATA_CREDIT_LINE}</p>
              </div>
              {stats.byType.length > 0 ? (
                <div>
                  <h3 className="mb-2 text-xs font-medium tracking-wide text-[#93a0b8]">종류</h3>
                  <ul className="space-y-1.5">
                    {stats.byType.map((row) => {
                      const style = disasterStyle(row.type);
                      const width = Math.max(8, Math.round((row.count / stats.total) * 100));
                      return (
                        <li key={row.type}>
                          <button
                            type="button"
                            onClick={() => {
                              setTypeFilter(row.type);
                              setSelectedId(null);
                            }}
                            className="flex w-full items-center gap-2 text-left"
                          >
                            <span className="w-[5.5rem] shrink-0 text-[13px]">
                              {style.emoji} {row.type}
                            </span>
                            <span className="h-1.5 min-w-0 flex-1 rounded-full bg-[#1b2740]">
                              <span
                                className="block h-1.5 rounded-full"
                                style={{ width: `${width}%`, background: style.color }}
                              />
                            </span>
                            <span className="w-8 text-right text-[12px] text-[#93a0b8]">{row.count}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
              {stats.regions.length > 0 ? (
                <div>
                  <h3 className="mb-2 text-xs font-medium tracking-wide text-[#93a0b8]">지역</h3>
                  <ul className="space-y-1">
                    {stats.regions.map((row) => (
                      <li key={row.name} className="flex justify-between gap-2 text-[13px]">
                        <span>{row.name}</span>
                        <span className="text-[#93a0b8]">{row.count}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
