// Client-side fetch helpers for the JSON API. Unwrap the `{ data }` envelope
// (CLAUDE.md §8) and throw the `{ error }` message so TanStack Query and
// mutations surface a clean string.

async function parse<T>(res: Response): Promise<T> {
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      (json && typeof json === "object" && "error" in json
        ? (json as { error?: string }).error
        : null) ?? `Request failed (${res.status})`;
    throw new Error(message);
  }
  return (json as { data: T }).data;
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { "content-type": "application/json" } });
  return parse<T>(res);
}

export async function apiSend<T>(
  path: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return parse<T>(res);
}
