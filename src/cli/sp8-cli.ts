import type { Command } from "commander";
import { sp8KgEvolve, sp8KgGraph, sp8KgQuery, sp8KgValidate } from "../commands/sp8-kg.js";
import {
  addSp8Mcp,
  getTrustedMcpCatalog,
  getTrustedSkillCatalog,
  installSp8SkillSafe,
} from "../commands/sp8-power-pack.js";
import { defaultRuntime } from "../runtime.js";

type SafeOpts = {
  safe?: boolean;
  consent?: boolean;
  sandboxProfile?: string;
  vtReport?: string;
};

function resolveSandboxProfile(value: string | undefined): string {
  return (value ?? "strict").trim().toLowerCase();
}

function renderCatalogLine(name: string, summary: string): string {
  return `- ${name}: ${summary}`;
}

export function registerSp8Cli(program: Command) {
  const sp8 = program
    .command("sp8")
    .description("Sp8 trusted skill + MCP porting layer (privacy-first and safe by default)");

  const skill = sp8.command("skill").description("Install and manage trusted Sp8 skills");

  skill
    .command("install")
    .argument("<name>", "Trusted skill name")
    .requiredOption("--safe", "Require safe-mode installation")
    .option("--consent", "Acknowledge and allow vetted install", false)
    .option("--sandbox-profile <profile>", "Sandbox profile (must be strict)", "strict")
    .option("--vt-report <path>", "Path to VirusTotal JSON report")
    .action(async (name: string, opts: SafeOpts) => {
      try {
        const result = await installSp8SkillSafe({
          name,
          safe: Boolean(opts.safe),
          consent: Boolean(opts.consent),
          sandboxProfile: resolveSandboxProfile(opts.sandboxProfile),
          vtReportPath: opts.vtReport,
        });
        defaultRuntime.log(result.message);
        defaultRuntime.log(`State: ${result.statePath}`);
      } catch (err) {
        defaultRuntime.error(String(err));
        defaultRuntime.exit(1);
      }
    });

  skill
    .command("list")
    .description("List trusted Sp8 skill catalog")
    .action(() => {
      defaultRuntime.log("Trusted Sp8 skills (Feb 2026 vetted snapshot):");
      for (const entry of getTrustedSkillCatalog()) {
        defaultRuntime.log(renderCatalogLine(entry.name, entry.summary));
      }
    });

  const mcp = sp8.command("mcp").description("Add trusted MCP servers through mcporter");

  mcp
    .command("add")
    .argument("<name>", "Trusted MCP server name")
    .option("--consent", "Acknowledge and allow vetted MCP addition", false)
    .option("--sandbox-profile <profile>", "Sandbox profile (must be strict)", "strict")
    .option("--vt-report <path>", "Path to VirusTotal JSON report")
    .action(async (name: string, opts: SafeOpts) => {
      try {
        const result = await addSp8Mcp({
          name,
          consent: Boolean(opts.consent),
          sandboxProfile: resolveSandboxProfile(opts.sandboxProfile),
          vtReportPath: opts.vtReport,
        });
        defaultRuntime.log(result.message);
        defaultRuntime.log(`State: ${result.statePath}`);
        defaultRuntime.log(`MCP config: ${result.mcpConfigPath}`);
      } catch (err) {
        defaultRuntime.error(String(err));
        defaultRuntime.exit(1);
      }
    });

  mcp
    .command("list")
    .description("List trusted MCP catalog")
    .action(() => {
      defaultRuntime.log("Trusted Sp8 MCP servers (mcporter-first, Feb 2026 vetted snapshot):");
      for (const entry of getTrustedMcpCatalog()) {
        defaultRuntime.log(renderCatalogLine(entry.name, entry.summary));
      }
    });

  const kg = sp8.command("kg").description("Ontology-powered Personal KG commands");

  kg.command("query")
    .argument("<text>", "Query text")
    .option("--limit <n>", "Max results", "10")
    .action(async (text: string, opts: { limit?: string }) => {
      try {
        const limit = Number.parseInt(String(opts.limit ?? "10"), 10);
        const results = await sp8KgQuery({
          text,
          limit: Number.isFinite(limit) ? limit : 10,
        });
        if (results.length === 0) {
          defaultRuntime.log("No matching entities.");
          return;
        }
        for (const result of results) {
          defaultRuntime.log(
            `- ${result.label} (${result.type}) [${result.id}] score=${result.score.toFixed(2)}`,
          );
        }
      } catch (err) {
        defaultRuntime.error(String(err));
        defaultRuntime.exit(1);
      }
    });

  kg.command("graph")
    .description("Print current ontology graph snapshot")
    .option("--physics", "Include physics-rendering hints", false)
    .action(async (opts: { physics?: boolean }) => {
      try {
        const graph = await sp8KgGraph({ physics: Boolean(opts.physics) });
        defaultRuntime.log(JSON.stringify(graph, null, 2));
      } catch (err) {
        defaultRuntime.error(String(err));
        defaultRuntime.exit(1);
      }
    });

  kg.command("evolve")
    .argument("<objective>", "Objective for graph planning + schema evolution")
    .option(
      "--fork-type <forkType...>",
      "Import fork entity type as <fork>:<type> (repeatable)",
      [],
    )
    .action(async (objective: string, opts: { forkType?: string[] }) => {
      try {
        const fromForks = (opts.forkType ?? [])
          .map((value) => {
            const [fork, entityType] = value.split(":", 2);
            if (!fork || !entityType) {
              return undefined;
            }
            return { fork, entityTypes: [entityType] };
          })
          .filter((entry): entry is { fork: string; entityTypes: string[] } => Boolean(entry));
        const result = await sp8KgEvolve({
          objective,
          fromForks,
        });
        defaultRuntime.log(`Created entities: ${result.createdEntityIds.length}`);
        defaultRuntime.log(`Created relations: ${result.createdRelationIds.length}`);
        if (result.schemaProposals.length > 0) {
          defaultRuntime.log("Schema proposals:");
          for (const proposal of result.schemaProposals) {
            defaultRuntime.log(`- ${proposal}`);
          }
        }
      } catch (err) {
        defaultRuntime.error(String(err));
        defaultRuntime.exit(1);
      }
    });

  kg.command("validate")
    .description("Validate SKILL.md ontology reads/writes declarations")
    .action(async () => {
      try {
        const result = await sp8KgValidate({ workspaceDir: process.cwd() });
        defaultRuntime.log(`Scanned skills: ${result.scannedSkills}`);
        if (result.ok) {
          defaultRuntime.log("All scanned skills declare ontology reads/writes.");
          return;
        }
        defaultRuntime.log("Missing declarations:");
        for (const missing of result.missingDeclarations) {
          defaultRuntime.log(`- ${missing.skillPath}: ${missing.missing.join(", ")}`);
        }
        defaultRuntime.exit(1);
      } catch (err) {
        defaultRuntime.error(String(err));
        defaultRuntime.exit(1);
      }
    });
}
