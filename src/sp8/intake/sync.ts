import fs from "node:fs/promises";
import path from "node:path";
import { resolveUserPath } from "../../utils.js";

type IntakeKind = "mcp" | "skill" | "soul" | "prompt";
type IntakeTrust = "high" | "medium" | "low";

export type Sp8IntakeRecord = {
  kind: IntakeKind;
  id: string;
  title: string;
  source: string;
  tags: string[];
  license: string;
  trust: IntakeTrust;
  addedAt: string;
};

const EXTERNAL_SEEDS: ReadonlyArray<Omit<Sp8IntakeRecord, "addedAt">> = [
  {
    kind: "mcp",
    id: "punkpeye/awesome-mcp-servers",
    title: "Awesome MCP Servers",
    source: "https://github.com/punkpeye/awesome-mcp-servers",
    tags: ["sp8", "mcp", "catalog"],
    license: "unknown",
    trust: "high",
  },
  {
    kind: "mcp",
    id: "github/github-mcp-server",
    title: "GitHub MCP Server",
    source: "https://github.com/github/github-mcp-server",
    tags: ["sp8", "mcp", "github"],
    license: "unknown",
    trust: "high",
  },
  {
    kind: "mcp",
    id: "microsoft/playwright-mcp",
    title: "Playwright MCP",
    source: "https://github.com/microsoft/playwright-mcp",
    tags: ["sp8", "mcp", "browser"],
    license: "unknown",
    trust: "high",
  },
  {
    kind: "mcp",
    id: "awslabs/mcp",
    title: "AWS MCP Servers",
    source: "https://github.com/awslabs/mcp",
    tags: ["sp8", "mcp", "cloud"],
    license: "unknown",
    trust: "medium",
  },
  {
    kind: "prompt",
    id: "ai-boost/awesome-prompts",
    title: "Awesome Prompts",
    source: "https://github.com/ai-boost/awesome-prompts",
    tags: ["sp8", "prompt-bank"],
    license: "unknown",
    trust: "medium",
  },
  {
    kind: "prompt",
    id: "promptslab/Awesome-Prompt-Engineering",
    title: "Awesome Prompt Engineering",
    source: "https://github.com/promptslab/Awesome-Prompt-Engineering",
    tags: ["sp8", "prompt-bank", "research"],
    license: "unknown",
    trust: "medium",
  },
  {
    kind: "soul",
    id: "aaronjmars/soul.md",
    title: "soul.md",
    source: "https://github.com/aaronjmars/soul.md",
    tags: ["sp8", "soul", "persona"],
    license: "unknown",
    trust: "medium",
  },
  {
    kind: "soul",
    id: "thedaviddias/souls-directory",
    title: "souls-directory",
    source: "https://github.com/thedaviddias/souls-directory",
    tags: ["sp8", "soul", "catalog"],
    license: "unknown",
    trust: "medium",
  },
];

function normalizePath(value: string): string {
  return value.replaceAll(path.sep, "/");
}

function isMcpSignalPath(relPath: string): boolean {
  if (relPath.endsWith("mcp-servers.json")) {
    return true;
  }
  if (relPath.startsWith("src/sp8/mcp/")) {
    return true;
  }
  if (relPath === "src/cli/sp8-cli.ts" || relPath === "src/commands/sp8-power-pack.ts") {
    return true;
  }

  if (!relPath.startsWith("src/")) {
    return false;
  }

  const fileName = path.basename(relPath).toLowerCase();
  return fileName.includes("mcp") || fileName.includes("mcporter");
}

function resolveIntakeDir(baseDir?: string): string {
  const root = baseDir?.trim() || path.join(resolveUserPath("~/.openclaw/sp8"), "intake");
  return path.resolve(root);
}

async function walkFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") {
      continue;
    }
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(absolute)));
      continue;
    }
    if (entry.isFile()) {
      files.push(absolute);
    }
  }
  return files;
}

function toRecord(
  kind: IntakeKind,
  id: string,
  title: string,
  source: string,
  tags: string[],
): Sp8IntakeRecord {
  return {
    kind,
    id,
    title,
    source,
    tags,
    license: "unknown",
    trust: "high",
    addedAt: new Date().toISOString(),
  };
}

async function collectLocalRecords(workspaceRoot: string): Promise<Sp8IntakeRecord[]> {
  const files = await walkFiles(workspaceRoot);
  const records: Sp8IntakeRecord[] = [];

  for (const filePath of files) {
    const rel = normalizePath(path.relative(workspaceRoot, filePath));

    if (rel.endsWith("/SKILL.md") && (rel.startsWith("skills/") || rel.includes("/skills/"))) {
      const skillKey = rel.split("/").slice(0, -1).join("/");
      records.push(
        toRecord("skill", `local#${skillKey}`, skillKey, rel, ["sp8", "skill", "local"]),
      );
      continue;
    }

    if (rel.endsWith("/SOUL.md")) {
      records.push(toRecord("soul", `local#${rel}`, rel, rel, ["sp8", "soul", "local"]));
      continue;
    }

    if (rel.startsWith(".pi/prompts/") && rel.endsWith(".md")) {
      records.push(toRecord("prompt", `local#${rel}`, rel, rel, ["sp8", "prompt", "local"]));
      continue;
    }

    if (isMcpSignalPath(rel)) {
      records.push(toRecord("mcp", `local#${rel}`, rel, rel, ["sp8", "mcp", "local"]));
    }
  }

  return records;
}

async function readDedupe(dedupePath: string): Promise<Record<string, true>> {
  try {
    const raw = await fs.readFile(dedupePath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, true>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export async function syncSp8Intake(params?: { workspaceRoot?: string; outputDir?: string }) {
  const workspaceRoot = path.resolve(params?.workspaceRoot?.trim() || process.cwd());
  const intakeDir = resolveIntakeDir(params?.outputDir);
  const rawDir = path.join(intakeDir, "raw", "sync");
  const indexPath = path.join(intakeDir, "index.jsonl");
  const reviewPath = path.join(intakeDir, "review.jsonl");
  const dedupePath = path.join(intakeDir, "dedupe.json");

  await fs.mkdir(rawDir, { recursive: true });

  const local = await collectLocalRecords(workspaceRoot);
  const external = EXTERNAL_SEEDS.map((entry) => ({ ...entry, addedAt: new Date().toISOString() }));
  const merged = [...local, ...external];

  const dedupe = await readDedupe(dedupePath);
  const fresh = merged.filter((record) => !dedupe[record.id]);

  if (fresh.length > 0) {
    await fs.appendFile(indexPath, fresh.map((record) => JSON.stringify(record)).join("\n") + "\n");
    const reviewItems = fresh.filter((record) => record.trust !== "high");
    if (reviewItems.length > 0) {
      await fs.appendFile(
        reviewPath,
        reviewItems.map((record) => JSON.stringify(record)).join("\n") + "\n",
      );
    }
  }

  for (const record of merged) {
    dedupe[record.id] = true;
  }
  await fs.writeFile(dedupePath, `${JSON.stringify(dedupe, null, 2)}\n`);

  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const rawPath = path.join(rawDir, `${timestamp}.json`);
  await fs.writeFile(
    rawPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        workspaceRoot,
        counts: {
          local: local.length,
          external: external.length,
          fresh: fresh.length,
          totalKnown: Object.keys(dedupe).length,
        },
        records: merged,
      },
      null,
      2,
    )}\n`,
  );

  return {
    intakeDir,
    indexPath,
    reviewPath,
    dedupePath,
    rawPath,
    counts: {
      local: local.length,
      external: external.length,
      fresh: fresh.length,
      totalKnown: Object.keys(dedupe).length,
    },
  };
}
