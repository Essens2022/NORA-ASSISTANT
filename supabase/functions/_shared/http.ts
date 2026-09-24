// HTTP helpers: CORS, JSON, structured logs with a correlation id.

export const cors: Record<string, string> = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id, x-timezone, x-locale',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'Access-Control-Max-Age': '86400',
};

export function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra } });
}

/** User-facing errors carry a stable code; the UI translates it. Details stay in logs. */
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

export function log(event: string, data: Record<string, unknown> = {}) {
  // never log secrets or raw user content here
  console.log(JSON.stringify({ t: new Date().toISOString(), event, ...data }));
}

/**
 * Fire a lazy Supabase query builder (or any thenable) without blocking the response.
 * `void someBuilder` alone never runs the request: supabase-js builders only send
 * once something calls `.then()`. `EdgeRuntime.waitUntil` keeps the isolate alive
 * long enough to finish after the response is sent, where the runtime supports it.
 */
export function background(p: PromiseLike<unknown>, event = 'background_task_failed') {
  const settled = Promise.resolve(p).then(
    () => {},
    (err) => log(event, { error: String(err).slice(0, 300) }),
  );
  (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime?.waitUntil(settled);
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, 'bad_json');
  }
}
