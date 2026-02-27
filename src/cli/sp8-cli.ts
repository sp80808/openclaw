import type { Command } from "commander";
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
}
