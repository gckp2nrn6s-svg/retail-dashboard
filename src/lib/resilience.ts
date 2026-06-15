// Fault isolation for multi-source API routes.
//
// Every dashboard route pulls from up to three independent sources: NAV (via a
// fragile laptop+ngrok proxy), Shopify (reliable cloud API), and Neon Postgres.
// Historically they were combined in a single `Promise.all`, so ONE source
// failing rejected the whole batch and zeroed the others — NAV going offline
// would hide perfectly good Shopify revenue.
//
// `safeSource` wraps a source so it NEVER throws: on failure it logs and returns
// the provided fallback plus status:"offline". Wrap each source separately and
// combine the statuses to tell the client what's degraded.

export type SourceStatus = "ok" | "offline";

export interface SourceResult<T> {
  value: T;
  status: SourceStatus;
}

export async function safeSource<T>(
  label: string,
  fn: () => Promise<T>,
  fallback: T
): Promise<SourceResult<T>> {
  try {
    const value = await fn();
    return { value, status: "ok" };
  } catch (e) {
    console.error(`[source:${label}] failed:`, e instanceof Error ? e.message : e);
    return { value: fallback, status: "offline" };
  }
}

export type Sources = Record<string, SourceStatus>;

/** True if any tracked source is offline. */
export function isDegraded(sources: Sources): boolean {
  return Object.values(sources).some((s) => s === "offline");
}
