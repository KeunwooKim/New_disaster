"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

type DateFilterProps = {
  recentFrom: string | null;
  recentTo: string | null;
  from: string | null;
  to: string | null;
  days: Record<string, number>;
  total: number;
  recentLimit: number;
  onRecent: () => void;
  onRange: (from: string, to: string) => void;
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function ymd(year: number, month: number, day: number): string {
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function ordered(a: string, b: string): [string, string] {
  return a <= b ? [a, b] : [b, a];
}

function formatTabLabel(from: string | null, to: string | null, recentLimit: number): string {
  if (!from || !to) return `최근 ${recentLimit}건`;
  if (from === to) {
    const [, month, day] = from.split("-");
    return `${Number(month)}월 ${Number(day)}일`;
  }
  const [fy, fm, fd] = from.split("-");
  const [ty, tm, td] = to.split("-");
  if (fy === ty && fm === tm && fd === "01" && Number(td) === lastDayOfMonth(Number(ty), Number(tm) - 1)) {
    return `${ty}년 ${Number(tm)}월`;
  }
  if (fy === ty) return `${Number(fm)}.${Number(fd)} – ${Number(tm)}.${Number(td)}`;
  return `${fy.slice(2)}.${Number(fm)}.${Number(fd)} – ${ty.slice(2)}.${Number(tm)}.${Number(td)}`;
}

export function DateFilter({
  recentFrom,
  recentTo,
  from,
  to,
  days,
  total,
  recentLimit,
  onRecent,
  onRange,
}: DateFilterProps) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [draftFrom, setDraftFrom] = useState(from ?? "");
  const [draftTo, setDraftTo] = useState(to ?? "");
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = from && to;
  const initial = (to ?? recentTo ?? new Date().toISOString().slice(0, 10)).split("-");
  const [year, setYear] = useState(Number(initial[0]));
  const [month, setMonth] = useState(Number(initial[1]) - 1);

  useEffect(() => {
    if (!open) return;
    setAnchor(null);
    setHover(null);
    setDraftFrom(from ?? "");
    setDraftTo(to ?? "");
    const cursor = (to ?? recentTo)?.split("-");
    if (cursor?.length === 3) {
      setYear(Number(cursor[0]));
      setMonth(Number(cursor[1]) - 1);
    }
  }, [open, to, recentTo, from]);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const cells = useMemo(() => {
    const first = new Date(year, month, 1);
    const start = first.getDay();
    const daysInMonth = lastDayOfMonth(year, month);
    const out: Array<{ day: string; inMonth: boolean; date: number }> = [];
    for (let i = 0; i < start; i += 1) {
      const date = lastDayOfMonth(year, month - 1) - start + 1 + i;
      const prev = new Date(year, month, 0);
      out.push({ day: ymd(prev.getFullYear(), prev.getMonth(), date), inMonth: false, date });
    }
    for (let date = 1; date <= daysInMonth; date += 1) {
      out.push({ day: ymd(year, month, date), inMonth: true, date });
    }
    while (out.length % 7 !== 0) {
      const date = out.length - start - daysInMonth + 1;
      const next = new Date(year, month + 1, 1);
      out.push({ day: ymd(next.getFullYear(), next.getMonth(), date), inMonth: false, date });
    }
    return out;
  }, [year, month]);

  const preview = anchor && hover ? ordered(anchor, hover) : null;
  const paintFrom = preview?.[0] ?? (selected ? from : recentFrom);
  const paintTo = preview?.[1] ?? (selected ? to : recentTo);
  const monthFrom = ymd(year, month, 1);
  const monthTo = ymd(year, month, lastDayOfMonth(year, month));

  function applyRange(nextFrom: string, nextTo: string) {
    const [start, end] = ordered(nextFrom, nextTo);
    onRange(start, end);
    setAnchor(null);
    setHover(null);
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
        className={`rounded-full px-3 py-1.5 text-sm ${
          open || selected ? "bg-white text-[#0b1220]" : "bg-[#1b2740] text-[#d5deee]"
        }`}
      >
        {formatTabLabel(from, to, recentLimit)}
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="기간으로 재난 검색"
          className="absolute top-[calc(100%+6px)] left-0 z-[1100] w-[300px] rounded-xl border border-[#243049] bg-[#121b2e] p-3 shadow-xl"
        >
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              aria-label="이전 달"
              onClick={() => {
                const next = new Date(year, month - 1, 1);
                setYear(next.getFullYear());
                setMonth(next.getMonth());
              }}
              className="rounded-full px-2 py-1 text-[#d5deee] hover:bg-[#1b2740]"
            >
              ‹
            </button>
            <p className="text-sm font-medium">
              {year}년 {month + 1}월
            </p>
            <button
              type="button"
              aria-label="다음 달"
              onClick={() => {
                const next = new Date(year, month + 1, 1);
                setYear(next.getFullYear());
                setMonth(next.getMonth());
              }}
              className="rounded-full px-2 py-1 text-[#d5deee] hover:bg-[#1b2740]"
            >
              ›
            </button>
          </div>
          <p className="mb-2 text-[11px] text-[#93a0b8]">
            {anchor ? "종료일을 선택하세요." : "시작일과 종료일을 차례로 누르세요."}
          </p>
          <div className="grid grid-cols-7 text-center text-[11px] text-[#93a0b8]">
            {WEEKDAYS.map((label) => (
              <span key={label} className="py-1">
                {label}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-7 text-center">
            {cells.map((cell) => {
              const count = days[cell.day] ?? 0;
              const inPaint = Boolean(paintFrom && paintTo && cell.day >= paintFrom && cell.day <= paintTo);
              const isEdge = Boolean(
                (paintFrom && cell.day === paintFrom) || (paintTo && cell.day === paintTo) || cell.day === anchor,
              );
              const isApplied = Boolean(from && to && cell.day >= from && cell.day <= to);
              return (
                <button
                  key={cell.day}
                  type="button"
                  title={count > 0 ? `${cell.day} · ${count}건` : cell.day}
                  onMouseEnter={() => setHover(cell.day)}
                  onFocus={() => setHover(cell.day)}
                  onClick={() => {
                    if (!anchor) {
                      setAnchor(cell.day);
                      setHover(cell.day);
                      setDraftFrom(cell.day);
                      return;
                    }
                    applyRange(anchor, cell.day);
                  }}
                  className={`relative mx-auto flex h-8 w-8 flex-col items-center justify-center rounded-full text-[13px] ${
                    !cell.inMonth ? "opacity-35" : ""
                  } ${
                    isEdge
                      ? "bg-white text-[#0b1220]"
                      : inPaint
                        ? isApplied || preview
                          ? "bg-[#334155] text-[#d5deee]"
                          : "bg-[#1b2740] text-[#d5deee]"
                        : "text-[#d5deee] hover:bg-[#1b2740]"
                  }`}
                >
                  {cell.date}
                  {count > 0 && !isEdge ? (
                    <span className="absolute bottom-0.5 h-1 w-1 rounded-full bg-[#ef4444]" />
                  ) : null}
                </button>
              );
            })}
          </div>
          <form
            className="mt-3 flex items-center gap-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              if (!draftFrom && !draftTo) return;
              applyRange(draftFrom || draftTo, draftTo || draftFrom);
            }}
          >
            <input
              type="date"
              aria-label="시작일"
              value={draftFrom}
              onChange={(event) => setDraftFrom(event.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-[#243049] bg-[#0b1220] px-1.5 py-1 text-[12px] text-[#d5deee]"
            />
            <span className="text-[12px] text-[#93a0b8]">~</span>
            <input
              type="date"
              aria-label="종료일"
              value={draftTo}
              onChange={(event) => setDraftTo(event.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-[#243049] bg-[#0b1220] px-1.5 py-1 text-[12px] text-[#d5deee]"
            />
            <button
              type="submit"
              className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[12px] text-[#0b1220]"
            >
              조회
            </button>
          </form>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => {
                onRecent();
                setAnchor(null);
                setOpen(false);
              }}
              className={`rounded-full px-2.5 py-1 text-[12px] ${
                selected ? "bg-[#1b2740] text-[#d5deee]" : "bg-white text-[#0b1220]"
              }`}
            >
              최근 {recentLimit}건
            </button>
            <button
              type="button"
              onClick={() => applyRange(monthFrom, monthTo)}
              className="rounded-full bg-[#1b2740] px-2.5 py-1 text-[12px] text-[#d5deee]"
            >
              이 달 전체
            </button>
            {total > recentLimit ? (
              <button
                type="button"
                onClick={() => {
                  const keys = Object.keys(days).sort();
                  if (keys.length === 0) return;
                  applyRange(keys[0], keys[keys.length - 1]);
                }}
                className="rounded-full bg-[#1b2740] px-2.5 py-1 text-[12px] text-[#d5deee]"
              >
                저장된 전체
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
