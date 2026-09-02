export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.POLL_ENABLED !== "1") return;
  const { startPoller } = await import("./lib/poller");
  startPoller();
}
