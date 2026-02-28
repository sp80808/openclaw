type Sp8TaskType = "reasoning" | "vision" | "speed";

type OpenRouterPricing = {
  prompt?: string | number;
  completion?: string | number;
};

type OpenRouterModel = {
  id: string;
  name?: string;
  description?: string;
  architecture?: {
    modality?: string;
  };
  pricing?: OpenRouterPricing;
};

export type Sp8RouterModel = {
  id: string;
  name: string;
  scoreReasoning: number;
  scoreVision: number;
  scoreSpeed: number;
};

type Sp8RouterOptions = {
  apiKey?: string;
  fetchImpl?: typeof fetch;
};

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }
  const n = Number(value.trim());
  return Number.isFinite(n) ? n : null;
}

function looksFree(entry: OpenRouterModel): boolean {
  if (entry.id.endsWith(":free")) {
    return true;
  }
  const prompt = toNumber(entry.pricing?.prompt);
  const completion = toNumber(entry.pricing?.completion);
  return prompt === 0 && completion === 0;
}

function scoreModel(entry: OpenRouterModel): Sp8RouterModel {
  const id = entry.id;
  const name = entry.name?.trim() || id;
  const haystack = `${id} ${name} ${entry.description ?? ""}`.toLowerCase();
  const modality = entry.architecture?.modality?.toLowerCase() ?? "";

  const scoreReasoning =
    (/(reason|think|r1|deep|o1|o3)/.test(haystack) ? 5 : 0) +
    (/(pro|large|70b|72b|405b)/.test(haystack) ? 2 : 0);

  const scoreVision =
    (/(vision|image|multimodal|vl)/.test(haystack) ? 5 : 0) + (modality.includes("image") ? 3 : 0);

  const scoreSpeed =
    (/(fast|flash|mini|nano|turbo)/.test(haystack) ? 5 : 0) +
    (/(small|8b|7b|3b)/.test(haystack) ? 2 : 0);

  return { id, name, scoreReasoning, scoreVision, scoreSpeed };
}

function byTask(a: Sp8RouterModel, b: Sp8RouterModel, task: Sp8TaskType): number {
  const sa =
    task === "reasoning" ? a.scoreReasoning : task === "vision" ? a.scoreVision : a.scoreSpeed;
  const sb =
    task === "reasoning" ? b.scoreReasoning : task === "vision" ? b.scoreVision : b.scoreSpeed;
  if (sa !== sb) {
    return sb - sa;
  }
  return a.id.localeCompare(b.id);
}

function messageToLower(value: unknown): string {
  if (typeof value === "string") {
    return value.toLowerCase();
  }
  if (value instanceof Error) {
    return value.message.toLowerCase();
  }
  return "";
}

function isRetriable(err: unknown): boolean {
  if (!err || typeof err !== "object") {
    return false;
  }
  const rec = err as Record<string, unknown>;
  const status = typeof rec.status === "number" ? rec.status : undefined;
  if (status === 429 || status === 529) {
    return true;
  }
  const msg = messageToLower(rec.message);
  return msg.includes("timeout") || msg.includes("timed out") || msg.includes("econnreset");
}

export class Sp8Router {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private initialized = false;
  private models: Sp8RouterModel[] = [];
  private cursor = new Map<Sp8TaskType, number>();
  private readonly responseCache = new Map<string, string>();

  constructor(options: Sp8RouterOptions = {}) {
    this.apiKey = options.apiKey?.trim() || process.env.OPENROUTER_API_KEY?.trim() || "";
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.cursor.set("reasoning", 0);
    this.cursor.set("vision", 0);
    this.cursor.set("speed", 0);
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    const models = await this.fetchFreeModels();
    this.models = models.map(scoreModel);
    this.initialized = true;
  }

  private async fetchFreeModels(): Promise<OpenRouterModel[]> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const urls = [
      "https://openrouter.ai/api/v1/models?pricing=free",
      "https://openrouter.ai/api/v1/models",
    ];

    for (const url of urls) {
      const res = await this.fetchImpl(url, { headers });
      if (!res.ok) {
        continue;
      }
      const payload = (await res.json()) as { data?: unknown };
      const data = Array.isArray(payload.data) ? payload.data : [];
      const parsed = data
        .filter((item): item is OpenRouterModel => Boolean(item) && typeof item === "object")
        .map((item) => item)
        .filter((item) => typeof item.id === "string" && item.id.length > 0)
        .filter(looksFree);
      if (parsed.length > 0) {
        return parsed;
      }
    }

    return [];
  }

  getStatus() {
    return {
      initialized: this.initialized,
      freeModels: this.models.length,
      cacheEntries: this.responseCache.size,
      queues: {
        reasoning: this.rank("reasoning")
          .slice(0, 5)
          .map((m) => m.id),
        vision: this.rank("vision")
          .slice(0, 5)
          .map((m) => m.id),
        speed: this.rank("speed")
          .slice(0, 5)
          .map((m) => m.id),
      },
    };
  }

  cacheSet(key: string, value: string): void {
    this.responseCache.set(key, value);
  }

  cacheGet(key: string): string | undefined {
    return this.responseCache.get(key);
  }

  rank(task: Sp8TaskType): Sp8RouterModel[] {
    return [...this.models].toSorted((a, b) => byTask(a, b, task));
  }

  pickModels(task: Sp8TaskType, count: number): Sp8RouterModel[] {
    const queue = this.rank(task);
    if (queue.length === 0) {
      return [];
    }
    const start = this.cursor.get(task) ?? 0;
    const picks: Sp8RouterModel[] = [];
    for (let idx = 0; idx < Math.min(count, queue.length); idx += 1) {
      const pos = (start + idx) % queue.length;
      picks.push(queue[pos]);
    }
    this.cursor.set(task, (start + picks.length) % queue.length);
    return picks;
  }

  async runWithFailover<T>(params: {
    task: Sp8TaskType;
    maxAttempts?: number;
    run: (model: Sp8RouterModel, attempt: number) => Promise<T>;
  }): Promise<T> {
    await this.initialize();
    const queue = this.rank(params.task);
    if (queue.length === 0) {
      throw new Error("Sp8Router: no free OpenRouter models available");
    }
    const maxAttempts = Math.min(params.maxAttempts ?? queue.length, queue.length);
    const start = this.cursor.get(params.task) ?? 0;
    let lastError: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const model = queue[(start + attempt) % queue.length];
      try {
        const result = await params.run(model, attempt + 1);
        this.cursor.set(params.task, (start + attempt + 1) % queue.length);
        return result;
      } catch (err) {
        lastError = err;
        if (!isRetriable(err)) {
          throw err;
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error("Sp8Router failover exhausted");
  }
}

export type { Sp8TaskType };
