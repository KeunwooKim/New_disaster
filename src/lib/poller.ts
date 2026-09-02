import { ingestAll } from "./ingest";

let started = false;
let timer: ReturnType<typeof setInterval> | null = null;

export function startPoller(): void {
  if (started) return;
  started = true;
  const interval = Number(process.env.POLL_INTERVAL_MS || 240000);
  const run = () => {
    void ingestAll().catch((error: unknown) => {
      console.error("[urban-alert] ingest failed", error);
    });
  };
  run();
  timer = setInterval(run, interval);
  if (timer && typeof timer === "object" && "unref" in timer) {
    timer.unref();
  }
}
