import { disasterStyle, disasterTypeOf } from "./map-shape";
import { EVENT_SOURCE_CREDIT } from "./types";
import type { AlertEvent } from "./types";

export function seoulDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function formatOccurredAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatOccurredShort(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function eventPlaceLine(event: AlertEvent): string {
  const locs = event.llm?.locations?.length ? event.llm.locations : event.regions;
  if (locs.length === 0) return "";
  if (locs.length <= 3) return locs.join(", ");
  return `${locs.slice(0, 3).join(", ")} 외 ${locs.length - 3}곳`;
}

export function eventBrief(event: AlertEvent): string {
  const text = (event.llm?.summary || event.rawText).replace(/\s+/g, " ").trim();
  return text.length > 110 ? `${text.slice(0, 110)}…` : text;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function eventPopupHtml(event: AlertEvent): string {
  const type = disasterTypeOf(event);
  const { emoji } = disasterStyle(type);
  const place = eventPlaceLine(event);
  const rows = [
    `<div style="font-weight:600;margin-bottom:6px">${escapeHtml(emoji)} ${escapeHtml(type)}</div>`,
    `<div style="color:#475569;margin-bottom:4px">출처 ${escapeHtml(EVENT_SOURCE_CREDIT[event.source])}</div>`,
    `<div style="color:#475569;margin-bottom:4px">발생 ${escapeHtml(formatOccurredAt(event.occurredAt))}</div>`,
  ];
  if (place) {
    rows.push(`<div style="color:#475569;margin-bottom:6px">위치 ${escapeHtml(place)}</div>`);
  }
  rows.push(`<div>${escapeHtml(eventBrief(event))}</div>`);
  return `<div style="min-width:200px;max-width:260px;font-size:13px;line-height:1.45;color:#0f172a">${rows.join("")}</div>`;
}
