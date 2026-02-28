import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../../config/paths.js";

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
  stateDir?: string;
  nowMs?: () => number;
  persistHealth?: boolean;
  airgap?: boolean;
};

type Sp8RouterModelHealth = {
  attempts: number;
  successes: number;
  failures: number;
  retriableFailures: number;
  consecutiveRetriableFailures: number;
  rateLimit429: number;
  totalLatencyMs: number;
  totalCompletionTokens: number;
  lastSuccessAtMs?: number;
  lastErrorAtMs?: number;
  cooldownUntilMs?: number;
};

type Sp8RouterHealthSnapshot = {
  id: string;
  attempts: number;
  successRate: number;
  avgLatencyMs: number;
  rate429Frequency: number;
  tokenThroughput: number;
  cooldownUntilMs?: number;
};

type Sp8RouterHealthStore = {
  version: 1;
  models: Record<string, Sp8RouterModelHealth>;
};

const COOLDOWN_MS = 30 * 60 * 1000;
const CIRCUIT_BREAKER_FAILS = 3;

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

function createEmptyHealth(): Sp8RouterModelHealth {
  return {
    attempts: 0,
    successes: 0,
    failures: 0,
    retriableFailures: 0,
    consecutiveRetriableFailures: 0,
    rateLimit429: 0,
    totalLatencyMs: 0,
    totalCompletionTokens: 0,
  };
}

export class Sp8Router {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private initialized = false;
  private models: Sp8RouterModel[] = [];
  private cursor = new Map<Sp8TaskType, number>();
  private readonly responseCache = new Map<string, string>();
  private readonly health = new Map<string, Sp8RouterModelHealth>();
  private readonly healthPath: string;
  private readonly nowMs: () => number;
  private readonly persistHealth: boolean;
  private readonly airgap: boolean;
  private healthLoaded = false;

  constructor(options: Sp8RouterOptions = {}) {
    this.apiKey = options.apiKey?.trim() || process.env.OPENROUTER_API_KEY?.trim() || "";
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.healthPath = path.join(options.stateDir ?? resolveStateDir(), "sp8", "router-health.json");
    this.nowMs = options.nowMs ?? (() => Date.now());
    this.persistHealth = options.persistHealth ?? true;
    this.airgap = options.airgap ?? process.env.SP8_AIRGAP === "1";
    this.cursor.set("reasoning", 0);
    this.cursor.set("vision", 0);
    this.cursor.set("speed", 0);
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    await this.loadHealthState();
    const models = await this.fetchFreeModels();
    this.models = models.map(scoreModel);
    this.initialized = true;
  }

  private async fetchFreeModels(): Promise<OpenRouterModel[]> {
    if (this.airgap) {
      return [];
    }

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

  private async loadHealthState(): Promise<void> {
    if (this.healthLoaded || !this.persistHealth) {
      this.healthLoaded = true;
      return;
    }
    this.healthLoaded = true;
    try {
      const raw = await fs.readFile(this.healthPath, "utf-8");
      const parsed = JSON.parse(raw) as Partial<Sp8RouterHealthStore>;
      if (!parsed || parsed.version !== 1 || !parsed.models || typeof parsed.models !== "object") {
        return;
      }
      for (const [id, entry] of Object.entries(parsed.models)) {
        if (!entry || typeof entry !== "object") {
          continue;
        }
        this.health.set(id, {
          ...createEmptyHealth(),
          ...(entry as Partial<Sp8RouterModelHealth>),
        });
      }
    } catch (err) {
      const message = String(err);
      if (!message.includes("ENOENT")) {
        throw err;
      }
    }
  }

  private async persistHealthState(): Promise<void> {
    if (!this.persistHealth) {
      return;
    }
    const store: Sp8RouterHealthStore = {
      version: 1,
      models: Object.fromEntries(this.health.entries()),
    };
    await fs.mkdir(path.dirname(this.healthPath), { recursive: true });
    await fs.writeFile(this.healthPath, `${JSON.stringify(store, null, 2)}\n`, "utf-8");
  }

  private getOrCreateHealth(modelId: string): Sp8RouterModelHealth {
    const existing = this.health.get(modelId);
    if (existing) {
      return existing;
    }
    const next = createEmptyHealth();
    this.health.set(modelId, next);
    return next;
  }

  private isCoolingDown(modelId: string): boolean {
    const stats = this.health.get(modelId);
    if (!stats?.cooldownUntilMs) {
      return false;
    }
    return stats.cooldownUntilMs > this.nowMs();
  }

  private healthBoost(modelId: string): number {
    const stats = this.health.get(modelId);
    if (!stats || stats.attempts < 2) {
      return 0;
    }
    const successRate = stats.successes / Math.max(1, stats.attempts);
    const avgLatencyMs = stats.totalLatencyMs / Math.max(1, stats.attempts);
    const rate429 = stats.rateLimit429 / Math.max(1, stats.attempts);
    return successRate * 6 - Math.min(avgLatencyMs / 800, 4) - rate429 * 3;
  }

  private sortedHistory(limit = 10): Sp8RouterHealthSnapshot[] {
    const history: Sp8RouterHealthSnapshot[] = [];
    for (const [id, stats] of this.health.entries()) {
      if (stats.attempts <= 0) {
        continue;
      }
      history.push({
        id,
        attempts: stats.attempts,
        successRate: stats.successes / Math.max(1, stats.attempts),
        avgLatencyMs: stats.totalLatencyMs / Math.max(1, stats.attempts),
        rate429Frequency: stats.rateLimit429 / Math.max(1, stats.attempts),
        tokenThroughput:
          stats.totalCompletionTokens > 0 && stats.totalLatencyMs > 0
            ? (stats.totalCompletionTokens / stats.totalLatencyMs) * 1000
            : 0,
        cooldownUntilMs: stats.cooldownUntilMs,
      });
    }
    return history
      .toSorted((a, b) => {
        if (a.attempts !== b.attempts) {
          return b.attempts - a.attempts;
        }
        return b.successRate - a.successRate;
      })
      .slice(0, limit);
  }

  private async recordSuccess(model: Sp8RouterModel, latencyMs: number): Promise<void> {
    const stats = this.getOrCreateHealth(model.id);
    stats.attempts += 1;
    stats.successes += 1;
    stats.totalLatencyMs += Math.max(0, latencyMs);
    stats.consecutiveRetriableFailures = 0;
    stats.lastSuccessAtMs = this.nowMs();
    stats.cooldownUntilMs = undefined;
    await this.persistHealthState();
  }

  private async recordFailure(
    model: Sp8RouterModel,
    latencyMs: number,
    err: unknown,
  ): Promise<void> {
    const stats = this.getOrCreateHealth(model.id);
    const retriable = isRetriable(err);
    stats.attempts += 1;
    stats.failures += 1;
    stats.totalLatencyMs += Math.max(0, latencyMs);
    stats.lastErrorAtMs = this.nowMs();
    if (retriable) {
      stats.retriableFailures += 1;
      stats.consecutiveRetriableFailures += 1;
      if (stats.consecutiveRetriableFailures >= CIRCUIT_BREAKER_FAILS) {
        stats.cooldownUntilMs = this.nowMs() + COOLDOWN_MS;
      }
    } else {
      stats.consecutiveRetriableFailures = 0;
    }
    const rec = err as { status?: unknown };
    if (typeof rec?.status === "number" && rec.status === 429) {
      stats.rateLimit429 += 1;
    }
    await this.persistHealthState();
  }

  getStatus(opts?: { history?: boolean; historyLimit?: number }) {
    const cooldownModels = this.models.filter((model) => this.isCoolingDown(model.id)).length;
    return {
      initialized: this.initialized,
      freeModels: this.models.length,
      cooldownModels,
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
      history: opts?.history ? this.sortedHistory(opts.historyLimit ?? 10) : undefined,
    };
  }

  cacheSet(key: string, value: string): void {
    this.responseCache.set(key, value);
  }

  cacheGet(key: string): string | undefined {
    return this.responseCache.get(key);
  }

  rank(task: Sp8TaskType): Sp8RouterModel[] {
    return [...this.models].toSorted((a, b) => {
      const taskCompare = byTask(a, b, task);
      if (taskCompare !== 0) {
        return taskCompare;
      }
      const healthCompare = this.healthBoost(b.id) - this.healthBoost(a.id);
      if (healthCompare !== 0) {
        return healthCompare;
      }
      return a.id.localeCompare(b.id);
    });
  }

  pickModels(task: Sp8TaskType, count: number): Sp8RouterModel[] {
    const queue = this.rank(task).filter((model) => !this.isCoolingDown(model.id));
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
    const ranked = this.rank(params.task);
    if (ranked.length === 0) {
      throw new Error("Sp8Router: no free OpenRouter models available");
    }
    const queue = ranked.filter((model) => !this.isCoolingDown(model.id));
    if (queue.length === 0) {
      throw new Error("Sp8Router: all models are temporarily blacklisted by circuit breakers");
    }
    const maxAttempts = Math.min(params.maxAttempts ?? queue.length, queue.length);
    const start = this.cursor.get(params.task) ?? 0;
    let lastError: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const model = queue[(start + attempt) % queue.length];
      const beganAt = this.nowMs();
      try {
        const result = await params.run(model, attempt + 1);
        await this.recordSuccess(model, this.nowMs() - beganAt);
        this.cursor.set(params.task, (start + attempt + 1) % queue.length);
        return result;
      } catch (err) {
        await this.recordFailure(model, this.nowMs() - beganAt, err);
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
