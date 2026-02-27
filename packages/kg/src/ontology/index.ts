import fs from "node:fs/promises";
import path from "node:path";
import { HybridGraphQueryEngine, type OntologyEntity, type OntologyRelation } from "./graph.js";

export type OntologyPaths = {
  rootDir: string;
  graphPath: string;
  schemaPath: string;
  legacyMemoryPath: string;
};

export type OntologyQuery = {
  text: string;
  limit?: number;
};

export type OntologyTaskPlan = {
  id: string;
  objective: string;
  steps: Array<{
    id: string;
    label: string;
    blockedBy?: string[];
  }>;
};

export type SkillOntologyAccess = {
  reads: string[];
  writes: string[];
};

function toIsoNow(): string {
  return new Date().toISOString();
}

function sanitizeId(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export class OntologyPersonalKG {
  protected readonly graph: HybridGraphQueryEngine;
  protected readonly paths: OntologyPaths;

  constructor(paths: OntologyPaths) {
    this.paths = paths;
    this.graph = new HybridGraphQueryEngine({ graphPath: paths.graphPath });
  }

  static defaultPaths(baseDir: string): OntologyPaths {
    return {
      rootDir: baseDir,
      graphPath: path.join(baseDir, "graph.jsonl"),
      schemaPath: path.join(baseDir, "schema.yaml"),
      legacyMemoryPath: path.join(baseDir, "MEMORY.md"),
    };
  }

  async init(): Promise<void> {
    await fs.mkdir(this.paths.rootDir, { recursive: true });
    await this.graph.ensureReady();
    await this.migrateLegacyDataOnce();
  }

  async upsertEntity(params: {
    id: string;
    type: string;
    label: string;
    properties?: Record<string, unknown>;
  }): Promise<OntologyEntity> {
    const entity: OntologyEntity = {
      id: sanitizeId(params.id),
      type: params.type,
      label: params.label,
      properties: params.properties,
      updatedAt: toIsoNow(),
    };
    await this.graph.append({ kind: "entity", value: entity });
    return entity;
  }

  async upsertRelation(params: {
    id: string;
    type: string;
    from: string;
    to: string;
    weight?: number;
    properties?: Record<string, unknown>;
  }): Promise<OntologyRelation> {
    const relation: OntologyRelation = {
      id: sanitizeId(params.id),
      type: params.type,
      from: sanitizeId(params.from),
      to: sanitizeId(params.to),
      weight: params.weight,
      properties: params.properties,
      updatedAt: toIsoNow(),
    };
    await this.graph.append({ kind: "relation", value: relation });
    return relation;
  }

  async query(input: OntologyQuery) {
    return this.graph.query(input.text, input.limit ?? 10);
  }

  async snapshot() {
    return this.graph.snapshot();
  }

  async planTaskWithGraph(task: string): Promise<OntologyTaskPlan> {
    const context = await this.query({ text: task, limit: 6 });
    const steps = context.slice(0, 4).map((entry, index) => ({
      id: `step-${index + 1}`,
      label: `Use ${entry.entity.label} (${entry.entity.type}) to advance task`,
      blockedBy: index === 0 ? undefined : [`step-${index}`],
    }));

    if (steps.length === 0) {
      steps.push({
        id: "step-1",
        label: "Capture first-class entities for this task before execution",
      });
    }

    return {
      id: `plan-${sanitizeId(task).slice(0, 24) || "task"}`,
      objective: task,
      steps,
    };
  }

  async learnSchemaExtensionFromFeedback(params: {
    signal: string;
    source: "rl-loop" | "style-mirror";
    confidence?: number;
  }): Promise<OntologyEntity> {
    return this.upsertEntity({
      id: `schema-proposal-${Date.now()}`,
      type: "concept",
      label: `Schema extension proposal from ${params.source}`,
      properties: {
        signal: params.signal,
        confidence: params.confidence ?? 0.5,
        source: params.source,
      },
    });
  }

  async importForkEntityTypes(params: {
    fork: string;
    entityTypes: string[];
  }): Promise<OntologyEntity[]> {
    const entities: OntologyEntity[] = [];
    for (const entityType of params.entityTypes) {
      const entity = await this.upsertEntity({
        id: `fork-${sanitizeId(params.fork)}-${sanitizeId(entityType)}`,
        type: "concept",
        label: `Imported type ${entityType}`,
        properties: {
          fork: params.fork,
          importedType: entityType,
          source: "fork-intelligence",
        },
      });
      entities.push(entity);
    }
    return entities;
  }

  parseSkillOntologyAccess(frontmatter: Record<string, unknown>): SkillOntologyAccess {
    const ontologyRaw =
      frontmatter["ontology"] && typeof frontmatter["ontology"] === "object"
        ? (frontmatter["ontology"] as Record<string, unknown>)
        : {};

    const reads = Array.isArray(ontologyRaw.reads)
      ? ontologyRaw.reads.map((entry) => String(entry)).filter(Boolean)
      : [];
    const writes = Array.isArray(ontologyRaw.writes)
      ? ontologyRaw.writes.map((entry) => String(entry)).filter(Boolean)
      : [];

    return { reads, writes };
  }

  protected async migrateLegacyDataOnce(): Promise<void> {
    const marker = path.join(this.paths.rootDir, ".migration-v0.1.2.done");
    try {
      await fs.access(marker);
      return;
    } catch {
      // Continue; migration has not run.
    }

    let legacy = "";
    try {
      legacy = await fs.readFile(this.paths.legacyMemoryPath, "utf-8");
    } catch {
      await fs.writeFile(marker, `${toIsoNow()}\n`, "utf-8");
      return;
    }

    const lines = legacy
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("- "))
      .slice(0, 200);

    for (const [index, line] of lines.entries()) {
      const label = line.slice(2).trim().slice(0, 200);
      if (!label) {
        continue;
      }
      await this.upsertEntity({
        id: `legacy-memory-${index + 1}`,
        type: "concept",
        label,
        properties: {
          source: "MEMORY.md",
          migratedAt: toIsoNow(),
        },
      });
    }

    await fs.writeFile(marker, `${toIsoNow()}\n`, "utf-8");
  }
}

export class PersonalKG extends OntologyPersonalKG {}
