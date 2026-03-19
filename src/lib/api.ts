/**
 * Typed API client for VisionQuest.
 *
 * Handles JSON parsing, 401 redirects, and structured error extraction.
 * All methods throw ApiClientError on non-ok responses.
 *
 * Usage:
 *   const { documents } = await api.get<{ documents: Doc[] }>("/api/documents?category=ORIENTATION");
 *   const { student } = await api.post<{ student: Student }>("/api/auth/login", { studentId, password });
 */

// ─── Error type ─────────────────────────────────────────────────────────────

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

// ─── Internal helpers ───────────────────────────────────────────────────────

async function handleResponse<T>(res: Response): Promise<T> {
  if (res.status === 401) {
    window.location.href = "/";
    throw new ApiClientError(401, "Session expired", "UNAUTHORIZED");
  }

  // Try to parse JSON body for both success and error responses
  let body: Record<string, unknown> | null = null;
  try {
    body = await res.json();
  } catch {
    // Non-JSON response (e.g., file download, empty 204)
  }

  if (!res.ok) {
    const message = (body?.error as string) || `Request failed (${res.status})`;
    const code = (body?.code as string) || undefined;
    throw new ApiClientError(res.status, message, code);
  }

  return (body ?? {}) as T;
}

function jsonHeaders(): HeadersInit {
  return { "Content-Type": "application/json" };
}

// ─── Public API ─────────────────────────────────────────────────────────────

export const api = {
  /**
   * GET request with typed JSON response.
   */
  async get<T = unknown>(url: string): Promise<T> {
    const res = await fetch(url);
    return handleResponse<T>(res);
  },

  /**
   * POST request with typed JSON body and response.
   */
  async post<T = unknown>(url: string, body?: unknown): Promise<T> {
    const res = await fetch(url, {
      method: "POST",
      headers: jsonHeaders(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return handleResponse<T>(res);
  },

  /**
   * PUT request with typed JSON body and response.
   */
  async put<T = unknown>(url: string, body?: unknown): Promise<T> {
    const res = await fetch(url, {
      method: "PUT",
      headers: jsonHeaders(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return handleResponse<T>(res);
  },

  /**
   * PATCH request with typed JSON body and response.
   */
  async patch<T = unknown>(url: string, body?: unknown): Promise<T> {
    const res = await fetch(url, {
      method: "PATCH",
      headers: jsonHeaders(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return handleResponse<T>(res);
  },

  /**
   * DELETE request with typed JSON response.
   */
  async del<T = unknown>(url: string, body?: unknown): Promise<T> {
    const res = await fetch(url, {
      method: "DELETE",
      headers: body !== undefined ? jsonHeaders() : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return handleResponse<T>(res);
  },
};

// ─── Legacy export for backward compatibility ───────────────────────────────

export async function apiFetch(url: string, options?: RequestInit): Promise<Response> {
  const res = await fetch(url, options);
  if (res.status === 401) {
    window.location.href = "/";
    throw new Error("Session expired");
  }
  return res;
}
