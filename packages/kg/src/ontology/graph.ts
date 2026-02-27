import fs from "node:fs/promises";
import path from "node:path";

export type OntologyEntity = {
  id: string;
  type: string;
  label: string;
  properties?: Record<string, unknown>;
  updatedAt: string;
};

export type OntologyRelation = {
  id: string;
  type: string;
  from: string;
  to: string;
  weight?: number;
  properties?: Record<string, unknown>;
  updatedAt: string;
};

export type OntologyRecord =
  | { kind: "entity"; value: OntologyEntity }
  | { kind: "relation"; value: OntologyRelation };

export type GraphAlert = {
  severity: "low" | "medium" | "high";
  message: string;
  entityId?: string;
  relationId?: string;
};

export type GraphSnapshot = {
  entities: OntologyEntity[];
  relations: OntologyRelation[];
  alerts: GraphAlert[];
};

export type VectorQueryResult = {
  id: string;
  score: number;
  source: "vector";
};

export type VectorStoreAdapter = {
  search(query: string, limit: number): Promise<VectorQueryResult[]>;
};

export type SqliteStoreAdapter = {
  searchEntities(query: string, limit: number): Promise<string[]>;
};

export type GraphQueryResult = {
  entity: OntologyEntity;
  score: number;
  sources: Array<"graph" | "vector" | "sqlite">;
};

function containsIgnoreCase(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function scoreEntity(entity: OntologyEntity, query: string): number {
  let score = 0;
  if (containsIgnoreCase(entity.label, query)) {
    score += 0.8;
  }
  if (containsIgnoreCase(entity.id, query)) {
    score += 0.6;
  }
  const payload = JSON.stringify(entity.properties ?? {});
  if (containsIgnoreCase(payload, query)) {
    score += 0.4;
  }
  return Math.min(1, score);
}

export class HybridGraphQueryEngine {
  private readonly graphPath: string;
  private readonly vectorStore?: VectorStoreAdapter;
  private readonly sqliteStore?: SqliteStoreAdapter;

  constructor(params: {
    graphPath: string;
    vectorStore?: VectorStoreAdapter;
    sqliteStore?: SqliteStoreAdapter;
  }) {
    this.graphPath = params.graphPath;
    this.vectorStore = params.vectorStore;
    this.sqliteStore = params.sqliteStore;
  }

  async ensureReady(): Promise<void> {
    await fs.mkdir(path.dirname(this.graphPath), { recursive: true });
    try {
      await fs.access(this.graphPath);
    } catch {
      await fs.writeFile(this.graphPath, "", "utf-8");
    }
  }

  async append(record: OntologyRecord): Promise<void> {
    await this.ensureReady();
    await fs.appendFile(this.graphPath, `${JSON.stringify(record)}\n`, "utf-8");
  }

  async snapshot(): Promise<GraphSnapshot> {
    await this.ensureReady();
    const content = await fs.readFile(this.graphPath, "utf-8");
    const entities = new Map<string, OntologyEntity>();
    const relations = new Map<string, OntologyRelation>();
    for (const rawLine of content.split("\n")) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }
      try {
        const record = JSON.parse(line) as OntologyRecord;
        if (record.kind === "entity") {
          entities.set(record.value.id, record.value);
        } else if (record.kind === "relation") {
          relations.set(record.value.id, record.value);
        }
      } catch {
        // Keep append-only file resilient to partial/corrupt lines.
      }
    }

    const entityList = Array.from(entities.values());
    const relationList = Array.from(relations.values());
    const entityIds = new Set(entityList.map((entity) => entity.id));
    const alerts: GraphAlert[] = [];

    for (const relation of relationList) {
      if (!entityIds.has(relation.from) || !entityIds.has(relation.to)) {
        alerts.push({
          severity: "high",
          relationId: relation.id,
          message: `Relation ${relation.id} references missing entities (${relation.from} -> ${relation.to}).`,
        });
      }
    }

    return {
      entities: entityList,
      relations: relationList,
      alerts,
    };
  }

  async query(query: string, limit = 10): Promise<GraphQueryResult[]> {
    const snapshot = await this.snapshot();
    const scores = new Map<string, GraphQueryResult>();

    for (const entity of snapshot.entities) {
      const score = scoreEntity(entity, query);
      if (score > 0) {
        scores.set(entity.id, { entity, score, sources: ["graph"] });
      }
    }

    if (this.vectorStore) {
      const vector = await this.vectorStore.search(query, limit);
      for (const result of vector) {
        const base = scores.get(result.id);
        if (base) {
          base.score = Math.max(base.score, result.score);
          if (!base.sources.includes("vector")) {
            base.sources.push("vector");
          }
          continue;
        }
        const entity = snapshot.entities.find((entry) => entry.id === result.id);
        if (entity) {
          scores.set(entity.id, {
            entity,
            score: result.score,
            sources: ["vector"],
          });
        }
      }
    }

    if (this.sqliteStore) {
      const matches = await this.sqliteStore.searchEntities(query, limit);
      for (const id of matches) {
        const base = scores.get(id);
        if (base) {
          base.score = Math.max(base.score, 0.55);
          if (!base.sources.includes("sqlite")) {
            base.sources.push("sqlite");
          }
          continue;
        }
        const entity = snapshot.entities.find((entry) => entry.id === id);
        if (entity) {
          scores.set(entity.id, {
            entity,
            score: 0.55,
            sources: ["sqlite"],
          });
        }
      }
    }

    return Array.from(scores.values())
      .toSorted((left, right) => right.score - left.score)
      .slice(0, limit);
  }
}
