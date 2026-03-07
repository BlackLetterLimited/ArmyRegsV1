export type ChatRole = "user" | "assistant" | "system";

export interface SourceExcerpt {
  id: string;
  citation: string;
  label: string;
  source_id: string;
  regulation: string;
  paragraph: string;
  page: string;
  excerpt: string;
  chunk_id: string;
  title?: string;
  quote?: string;
  source?: string;
  sourceType?: string;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  isStreaming?: boolean;
  sources?: SourceExcerpt[];
}

export interface BackendMessage {
  role: ChatRole;
  content: string;
}

export interface JagChatRequest {
  message: string;
  query: string;
  input: string;
  messages: BackendMessage[];
}

export interface StreamCallbacks {
  onToken: (token: string) => void;
  onSources?: (sources: SourceExcerpt[]) => void;
}

function normalizeBackendBaseUrl(value?: string) {
  if (!value || !value.trim()) return "";
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function extractToken(rawChunk: string): string | null {
  const value = rawChunk.trim();
  if (!value || value === "[DONE]") return null;

  try {
    const parsed = JSON.parse(value);

    if (typeof parsed === "string") {
      return parsed;
    }

    if (parsed && typeof parsed === "object") {
      if (typeof parsed.content === "string") return parsed.content;
      if (typeof parsed.text === "string") return parsed.text;
      if (typeof parsed.response === "string") return parsed.response;
      if (typeof parsed.output === "string") return parsed.output;
      if (typeof parsed.message === "string") return parsed.message;
      if (typeof parsed.deltaText === "string") return parsed.deltaText;

      if (parsed.delta && typeof parsed.delta.content === "string") {
        return parsed.delta.content;
      }

      if (Array.isArray(parsed.choices) && parsed.choices.length > 0) {
        const choice = parsed.choices[0];
        if (choice?.delta && typeof choice.delta.content === "string") {
          return choice.delta.content;
        }
        if (typeof choice?.text === "string") {
          return choice.text;
        }
      }
    }
  } catch {
    return value;
  }

  return null;
}

function stripSsePrefix(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("data:") ? trimmed.replace(/^data:\s*/, "") : trimmed;
}

function getSourceCandidates(payload: unknown): unknown[] {
  if (!payload || typeof payload !== "object") return [];

  const record = payload as Record<string, unknown>;

  if (Array.isArray(record.sources)) return record.sources;
  if (Array.isArray(record.citations)) return record.citations;
  if (Array.isArray(record.source_excerpts)) return record.source_excerpts;

  if (record.payload && typeof record.payload === "object") {
    return getSourceCandidates(record.payload);
  }

  return [];
}

function normalizeSourceCandidate(value: Record<string, unknown>): SourceExcerpt | null {
  const rawId = value.id;
  const sourceId =
    typeof value.source_id === "string"
      ? value.source_id.trim()
      : typeof value.sourceId === "string"
        ? value.sourceId.trim()
        : typeof value.source_id === "number"
          ? String(value.source_id)
          : typeof value.sourceId === "number"
            ? String(value.sourceId)
            : "";
  const id =
    typeof rawId === "string" && rawId.trim().length > 0
      ? rawId.trim()
      : sourceId && sourceId.trim().length > 0
        ? sourceId.trim()
        : `source-${Math.random().toString(36).slice(2, 9)}`;

  const citation = value.citation;
  const normalizedCitation =
    typeof citation === "string"
      ? citation.trim()
      : typeof citation === "number"
        ? String(citation)
        : "";
  const label =
    typeof value.label === "string" && value.label.trim().length > 0
      ? value.label.trim()
      : normalizedCitation.length > 0
        ? normalizedCitation
        : typeof value.title === "string" && value.title.trim().length > 0
          ? value.title.trim()
          : "Citation unavailable";

  const rawTitle = typeof value.title === "string" ? value.title : "";
  const paragraph =
    typeof value.paragraph === "string"
      ? value.paragraph.trim()
      : typeof value.paragraph === "number"
        ? String(value.paragraph)
        : "";
  const regulation =
    typeof value.regulation === "string"
      ? value.regulation.trim()
      : typeof value.regulation === "number"
        ? String(value.regulation)
        : rawTitle.trim().length > 0
          ? rawTitle.trim()
        : "Regulation";
  const page =
    typeof value.page === "string"
      ? value.page.trim()
      : typeof value.pageNumber === "string"
        ? value.pageNumber.trim()
        : typeof value.page === "number"
          ? String(value.page)
          : typeof value.pageNumber === "number"
            ? String(value.pageNumber)
            : typeof value.page_no === "number"
              ? String(value.page_no)
              : typeof value.pageNo === "number"
                ? String(value.pageNo)
                : typeof value.page_no === "string"
                  ? String(value.page_no).trim()
                  : typeof value.pageNo === "string"
                    ? String(value.pageNo).trim()
            : "";
  const excerpt =
    typeof value.excerpt === "string"
      ? value.excerpt.trim()
      : typeof value.quote === "string"
        ? value.quote.trim()
        : "";
  const chunk_id =
    typeof value.chunk_id === "string"
      ? value.chunk_id.trim()
      : typeof value.chunkId === "string"
        ? value.chunkId.trim()
        : typeof value.chunk_id === "number"
          ? String(value.chunk_id)
          : typeof value.chunkId === "number"
            ? String(value.chunkId)
            : "";

  const source: SourceExcerpt = {
    id,
    citation: normalizedCitation,
    label,
    source_id: sourceId || id,
    title: rawTitle || undefined,
    paragraph,
    regulation,
    quote: typeof value.quote === "string" ? value.quote : undefined,
    excerpt,
    page,
    chunk_id,
    source: typeof value.source === "string" ? value.source : undefined,
    sourceType: typeof value.sourceType === "string" ? value.sourceType : undefined
  };

  return source.label ||
    source.source_id ||
    source.citation ||
    source.regulation ||
    source.excerpt ||
    source.source
    ? source
    : null;
}

function parseSseLine(line: string, onToken: (token: string) => void) {
  const trimmed = line.trim();
  if (!trimmed) return;

  const withoutPrefix = stripSsePrefix(trimmed);

  const token = extractToken(withoutPrefix);
  if (token) onToken(token);
}

function parseSources(rawChunk: string): SourceExcerpt[] {
  try {
    const normalizedChunk = stripSsePrefix(rawChunk);
    if (!normalizedChunk || normalizedChunk === "[DONE]") return [];

    const parsed = JSON.parse(normalizedChunk);
    if (!parsed || typeof parsed !== "object") {
      return [];
    }

    const candidates = getSourceCandidates(parsed);

    const sourceItems = candidates
      .filter((entry: unknown): entry is Record<string, unknown> =>
        entry !== null && typeof entry === "object"
      )
      .map(normalizeSourceCandidate)
      .filter((source): source is SourceExcerpt => source !== null);

    return sourceItems;
  } catch {
    return [];
  }
}

export function getJagChatEndpoint(baseUrl?: string): string {
  const normalized = normalizeBackendBaseUrl(baseUrl);
  if (!normalized) {
    return "/api/jag-chat";
  }
  return `${normalized}/api/jag-chat`;
}

interface StreamOptions {
  signal?: AbortSignal;
  idToken?: string | null;
}

export function mergeSources(
  current: SourceExcerpt[] | undefined,
  incoming: SourceExcerpt[]
): SourceExcerpt[] {
  const map = new Map<string, SourceExcerpt>();

  const identity = (source: SourceExcerpt) =>
    source.source_id || source.id || source.citation || source.regulation || source.chunk_id;

  for (const source of current ?? []) {
    const key = identity(source);
    if (key) map.set(key, source);
  }

  for (const source of incoming) {
    const key = identity(source);
    const existing = key ? map.get(key) : undefined;
    if (!existing) {
      map.set(key, source);
      continue;
    }

    map.set(key, {
      ...existing,
      ...source,
      id: existing.id
    });
  }

  return Array.from(map.values());
}

export async function streamJagChatResponse(
  request: JagChatRequest,
  callbacks: StreamCallbacks,
  options?: StreamOptions
): Promise<void> {
  const endpoint = getJagChatEndpoint(process.env.NEXT_PUBLIC_BACKEND_API_BASE_URL);
  const headers = new Headers({ "Content-Type": "application/json" });

  if (options?.idToken) {
    headers.set("Authorization", `Bearer ${options.idToken}`);
  }

  const response = await fetch(endpoint, {
    method: "POST",
    signal: options?.signal,
    headers,
    body: JSON.stringify(request)
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "Unable to parse error body");
    throw new Error(`Backend request failed (${response.status}): ${text}`);
  }

  if (!response.body) {
    throw new Error("Backend returned an empty response stream.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    pending += decoder.decode(value, { stream: true });
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";

    for (const line of lines) {
      parseSseLine(line, callbacks.onToken);
      if (callbacks.onSources) {
        const incomingSources = parseSources(line);
        if (incomingSources.length > 0) {
          callbacks.onSources(incomingSources);
        }
      }
    }
  }

  if (pending) {
    parseSseLine(pending, callbacks.onToken);
    if (callbacks.onSources) {
      const incomingSources = parseSources(pending);
      if (incomingSources.length > 0) {
        callbacks.onSources(incomingSources);
      }
    }
  }
}
