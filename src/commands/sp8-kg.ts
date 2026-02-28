import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { parseFrontmatterBlock } from "../markdown/frontmatter.js";
import { resolveOpenClawManifestBlock } from "../shared/frontmatter.js";

type KgEntity = {
  id: string;
  type: string;
  label: string;
  properties?: Record<string, unknown>;
  updatedAt: string;
};

type KgRelation = {
  id: string;
  type: string;
  from: string;
  to: string;
  weight?: number;
  properties?: Record<string, unknown>;
  updatedAt: string;
};

type KgRecord = { kind: "entity"; value: KgEntity } | { kind: "relation"; value: KgRelation };

type KgSnapshot = {
  entities: KgEntity[];
  relations: KgRelation[];
  alerts: Array<{ severity: "low" | "medium" | "high"; message: string }>;
};

type SkillOntologyDeclaration = {
  reads: string[];
  writes: string[];
};

function normalizeId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function resolveKgRoot(stateDir?: string): string {
  return path.join(stateDir ?? resolveStateDir(process.env, os.homedir), "sp8", "kg");
}

function resolveKgGraphPath(stateDir?: string): string {
  return path.join(resolveKgRoot(stateDir), "graph.jsonl");
}

function resolveLegacyMemoryPath(stateDir?: string): string {
  return path.join(resolveKgRoot(stateDir), "MEMORY.md");
}

async function ensureGraph(stateDir?: string): Promise<string> {
  const graphPath = resolveKgGraphPath(stateDir);
  await fs.mkdir(path.dirname(graphPath), { recursive: true });
  try {
    await fs.access(graphPath);
  } catch {
    await fs.writeFile(graphPath, "", "utf-8");
  }
  return graphPath;
}

async function appendRecord(record: KgRecord, stateDir?: string): Promise<void> {
  const graphPath = await ensureGraph(stateDir);
  await fs.appendFile(graphPath, `${JSON.stringify(record)}\n`, "utf-8");
}

async function migrateOnce(stateDir?: string): Promise<void> {
  const marker = path.join(resolveKgRoot(stateDir), ".migration-v0.1.2.done");
  try {
    await fs.access(marker);
    return;
  } catch {
    // Run migration.
  }

  const legacyMemoryPath = resolveLegacyMemoryPath(stateDir);
  let text = "";
  try {
    text = await fs.readFile(legacyMemoryPath, "utf-8");
  } catch {
    await fs.writeFile(marker, `${new Date().toISOString()}\n`, "utf-8");
    return;
  }

  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .slice(0, 200);

  for (const [index, line] of lines.entries()) {
    const label = line.slice(2).trim();
    if (!label) {
      continue;
    }
    await appendRecord(
      {
        kind: "entity",
        value: {
          id: `legacy-${index + 1}`,
          type: "concept",
          label,
          updatedAt: new Date().toISOString(),
          properties: {
            source: "MEMORY.md",
          },
        },
      },
      stateDir,
    );
  }

  await fs.writeFile(marker, `${new Date().toISOString()}\n`, "utf-8");
}

async function loadSnapshot(stateDir?: string): Promise<KgSnapshot> {
  const graphPath = await ensureGraph(stateDir);
  const content = await fs.readFile(graphPath, "utf-8");
  const entities = new Map<string, KgEntity>();
  const relations = new Map<string, KgRelation>();

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    try {
      const record = JSON.parse(line) as KgRecord;
      if (record.kind === "entity") {
        entities.set(record.value.id, record.value);
      } else if (record.kind === "relation") {
        relations.set(record.value.id, record.value);
      }
    } catch {
      // Keep append-only history resilient to partial writes.
    }
  }

  const entityList = Array.from(entities.values());
  const relationList = Array.from(relations.values());
  const known = new Set(entityList.map((entity) => entity.id));
  const alerts: KgSnapshot["alerts"] = [];

  for (const relation of relationList) {
    if (!known.has(relation.from) || !known.has(relation.to)) {
      alerts.push({
        severity: "high",
        message: `Dangling relation ${relation.id}: ${relation.from} -> ${relation.to}`,
      });
    }
  }

  return {
    entities: entityList,
    relations: relationList,
    alerts,
  };
}

function scoreEntity(entity: KgEntity, query: string): number {
  const q = query.toLowerCase();
  let score = 0;
  if (entity.label.toLowerCase().includes(q)) {
    score += 0.8;
  }
  if (entity.id.toLowerCase().includes(q)) {
    score += 0.6;
  }
  if (
    JSON.stringify(entity.properties ?? {})
      .toLowerCase()
      .includes(q)
  ) {
    score += 0.4;
  }
  return Math.min(1, score);
}

async function collectSkillFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }> = [];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) {
        continue;
      }
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (entry.isFile() && entry.name === "SKILL.md") {
        result.push(full);
      }
    }
  }
  return result;
}

function parseSkillOntologyDeclaration(
  frontmatter: Record<string, unknown>,
): SkillOntologyDeclaration {
  const metadata = resolveOpenClawManifestBlock({
    frontmatter: frontmatter as Record<string, string>,
  });
  const ontologyRaw =
    metadata && typeof metadata.ontology === "object" && metadata.ontology
      ? (metadata.ontology as Record<string, unknown>)
      : {};
  const reads = Array.isArray(ontologyRaw.reads)
    ? ontologyRaw.reads.map((entry) => String(entry).trim()).filter(Boolean)
    : [];
  const writes = Array.isArray(ontologyRaw.writes)
    ? ontologyRaw.writes.map((entry) => String(entry).trim()).filter(Boolean)
    : [];
  return { reads, writes };
}

export async function sp8KgQuery(params: {
  text: string;
  limit?: number;
  stateDir?: string;
}): Promise<Array<{ id: string; type: string; label: string; score: number }>> {
  await migrateOnce(params.stateDir);
  const snapshot = await loadSnapshot(params.stateDir);
  const limit = Math.max(1, Math.min(50, params.limit ?? 10));
  return snapshot.entities
    .map((entity) => ({
      id: entity.id,
      type: entity.type,
      label: entity.label,
      score: scoreEntity(entity, params.text),
    }))
    .filter((entry) => entry.score > 0)
    .toSorted((left, right) => right.score - left.score)
    .slice(0, limit);
}

export async function sp8KgGraph(params?: {
  stateDir?: string;
  physics?: boolean;
}): Promise<KgSnapshot & { physics?: { engine: string; notes: string[] } }> {
  await migrateOnce(params?.stateDir);
  const snapshot = await loadSnapshot(params?.stateDir);
  if (!params?.physics) {
    return snapshot;
  }
  return {
    ...snapshot,
    physics: {
      engine: "antigravity-lite",
      notes: [
        "Nodes should float with soft repulsion.",
        "Relations should render as spring constraints.",
        "Graph alerts should pulse as visual constraint warnings.",
      ],
    },
  };
}

export async function sp8KgEvolve(params: {
  objective: string;
  fromForks?: Array<{ fork: string; entityTypes: string[] }>;
  stateDir?: string;
}): Promise<{
  createdEntityIds: string[];
  createdRelationIds: string[];
  schemaProposals: string[];
}> {
  await migrateOnce(params.stateDir);
  const createdEntityIds: string[] = [];
  const createdRelationIds: string[] = [];

  const rootEntity: KgEntity = {
    id: normalizeId(`task-${Date.now()}`),
    type: "task",
    label: params.objective,
    updatedAt: new Date().toISOString(),
    properties: {
      planner: "sp8router-graph",
      intensity: "high",
    },
  };
  await appendRecord({ kind: "entity", value: rootEntity }, params.stateDir);
  createdEntityIds.push(rootEntity.id);

  const schemaProposals = [
    "style-mirror: suggest style_preference entity property",
    "rl-loop: suggest success_signal relation weight calibration",
  ];
  for (const proposal of schemaProposals) {
    const proposalEntity: KgEntity = {
      id: normalizeId(`proposal-${Date.now()}-${proposal}`),
      type: "concept",
      label: proposal,
      updatedAt: new Date().toISOString(),
      properties: {
        source: proposal.startsWith("style-mirror") ? "style-mirror" : "self-evolving-rl-loop",
      },
    };
    await appendRecord({ kind: "entity", value: proposalEntity }, params.stateDir);
    createdEntityIds.push(proposalEntity.id);

    const rel: KgRelation = {
      id: normalizeId(`informs-${rootEntity.id}-${proposalEntity.id}`),
      type: "references",
      from: rootEntity.id,
      to: proposalEntity.id,
      updatedAt: new Date().toISOString(),
    };
    await appendRecord({ kind: "relation", value: rel }, params.stateDir);
    createdRelationIds.push(rel.id);
  }

  for (const fork of params.fromForks ?? []) {
    for (const entityType of fork.entityTypes) {
      const imported: KgEntity = {
        id: normalizeId(`fork-${fork.fork}-${entityType}`),
        type: "concept",
        label: `Fork type ${entityType}`,
        updatedAt: new Date().toISOString(),
        properties: {
          source: "fork-intelligence",
          fork: fork.fork,
          importedType: entityType,
        },
      };
      await appendRecord({ kind: "entity", value: imported }, params.stateDir);
      createdEntityIds.push(imported.id);
    }
  }

  return {
    createdEntityIds,
    createdRelationIds,
    schemaProposals,
  };
}

export async function writeN8nKgWorkflowProfile(params: {
  filePath: string;
  objective: string;
}): Promise<void> {
  const workflow = {
    name: "Sp8 KG Planner",
    nodes: [
      {
        id: "trigger",
        name: "Manual Trigger",
        type: "n8n-nodes-base.manualTrigger",
        position: [220, 280],
        parameters: {},
      },
      {
        id: "kg-query",
        name: "sp8 kg query",
        type: "n8n-nodes-base.executeCommand",
        position: [520, 280],
        parameters: {
          command: `sp8 kg query "${params.objective.replaceAll('"', '\\"')}" --limit 12`,
        },
      },
      {
        id: "kg-evolve",
        name: "sp8 kg evolve",
        type: "n8n-nodes-base.executeCommand",
        position: [840, 280],
        parameters: {
          command: `sp8 kg evolve "${params.objective.replaceAll('"', '\\"')}"`,
        },
      },
    ],
    connections: {
      "Manual Trigger": {
        main: [[{ node: "sp8 kg query", type: "main", index: 0 }]],
      },
      "sp8 kg query": {
        main: [[{ node: "sp8 kg evolve", type: "main", index: 0 }]],
      },
    },
  };

  await fs.mkdir(path.dirname(params.filePath), { recursive: true });
  await fs.writeFile(params.filePath, `${JSON.stringify(workflow, null, 2)}\n`, "utf-8");
}

export async function sp8KgValidate(params: { workspaceDir: string; stateDir?: string }): Promise<{
  ok: boolean;
  scannedSkills: number;
  missingDeclarations: Array<{ skillPath: string; missing: Array<"reads" | "writes"> }>;
}> {
  await migrateOnce(params.stateDir);
  const roots = [
    path.join(params.workspaceDir, "skills"),
    path.join(params.workspaceDir, "extensions"),
  ];
  const skillFiles = (await Promise.all(roots.map((root) => collectSkillFiles(root)))).flat();

  const missingDeclarations: Array<{ skillPath: string; missing: Array<"reads" | "writes"> }> = [];
  for (const skillPath of skillFiles) {
    const content = await fs.readFile(skillPath, "utf-8");
    const frontmatter = parseFrontmatterBlock(content);
    const declaration = parseSkillOntologyDeclaration(frontmatter);
    const missing: Array<"reads" | "writes"> = [];
    if (declaration.reads.length === 0) {
      missing.push("reads");
    }
    if (declaration.writes.length === 0) {
      missing.push("writes");
    }
    if (missing.length > 0) {
      missingDeclarations.push({ skillPath, missing });
    }
  }

  return {
    ok: missingDeclarations.length === 0,
    scannedSkills: skillFiles.length,
    missingDeclarations,
  };
}
