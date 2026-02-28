import type { Command } from "commander";
import { defaultRuntime } from "../runtime.js";
import { launchAntigravityProject } from "../sp8/antigravity/bridge.js";
import { appendEvolutionSignal } from "../sp8/evolve.js";
import {
  createGeminiPkceAuthSession,
  exchangeGeminiOAuthCode,
  loadGeminiOAuthTokens,
  storeGeminiOAuthTokens,
} from "../sp8/gemini/oauth.js";
import {
  addSp8McpServer,
  autoWrapSkillsAsMcpServers,
  readSp8McpConfig,
} from "../sp8/mcp/server-registry.js";
import { Sp8Router } from "../sp8/router/sp8-router.js";
import { createSp8Swarm } from "../sp8/swarm.js";

export function registerSp8Cli(program: Command) {
  const sp8 = program.command("sp8").description("Sp8Claw controls and integrations");

  const router = sp8.command("router").description("Sp8Router model routing");
  router
    .command("status")
    .description("Show free-model queue status")
    .option("--refresh", "Force model refresh", false)
    .action(async () => {
      const instance = new Sp8Router();
      await instance.initialize();
      defaultRuntime.log(JSON.stringify(instance.getStatus(), null, 2));
    });

  sp8
    .command("swarm")
    .description("Spawn 8 specialized Sp8 agents")
    .option("--goal <text>", "Swarm objective", "Complete the current task reliably")
    .action((opts) => {
      const payload = createSp8Swarm(String(opts.goal));
      defaultRuntime.log(JSON.stringify(payload, null, 2));
    });

  sp8
    .command("antigravity")
    .description("Open Antigravity on a project path")
    .argument("<project-path>", "Project path")
    .option("--binary <bin>", "Antigravity executable name/path", "antigravity")
    .action((projectPath: string, opts) => {
      launchAntigravityProject(projectPath, {
        binary: String(opts.binary),
      });
      defaultRuntime.log(`Launched Antigravity for ${projectPath}`);
    });

  sp8
    .command("evolve")
    .description("Record a self-evolution feedback signal")
    .requiredOption("--signal <text>", "Feedback signal")
    .option("--delta <n>", "Score delta", "1")
    .action(async (opts) => {
      const delta = Number(opts.delta);
      const result = await appendEvolutionSignal(
        String(opts.signal),
        Number.isFinite(delta) ? delta : 1,
      );
      defaultRuntime.log(`Evolution score: ${result.total}`);
    });

  const mcp = sp8.command("mcp").description("Manage Sp8 MCP servers");
  mcp
    .command("add")
    .description("Add a user-defined MCP server")
    .requiredOption("--name <name>", "Server name")
    .requiredOption("--command <command>", "Server command")
    .option("--args <arg...>", "Server arguments")
    .action(async (opts) => {
      const config = await addSp8McpServer({
        server: {
          name: String(opts.name),
          command: String(opts.command),
          args: Array.isArray(opts.args) ? (opts.args as string[]) : [],
        },
      });
      defaultRuntime.log(JSON.stringify(config, null, 2));
    });

  mcp
    .command("list")
    .description("List configured MCP servers")
    .action(async () => {
      const config = await readSp8McpConfig();
      defaultRuntime.log(JSON.stringify(config, null, 2));
    });

  mcp
    .command("autowrap-skills")
    .description("Auto-wrap local skills as MCP server entries")
    .option("--skills-dir <path>", "Skills directory", "skills")
    .action(async (opts) => {
      const config = await autoWrapSkillsAsMcpServers({
        skillsDir: String(opts.skillsDir),
      });
      defaultRuntime.log(JSON.stringify(config, null, 2));
    });

  const gemini = sp8.command("gemini").description("Gemini CLI + OAuth controls");
  gemini
    .command("oauth-start")
    .description("Generate Google OAuth PKCE URL for Gemini CLI")
    .requiredOption("--client-id <id>", "Google OAuth client id")
    .requiredOption("--redirect-uri <uri>", "OAuth redirect URI")
    .option("--scope <scope>", "OAuth scope", "openid email profile")
    .action(async (opts) => {
      const session = createGeminiPkceAuthSession({
        clientId: String(opts.clientId),
        redirectUri: String(opts.redirectUri),
        scope: String(opts.scope),
      });
      defaultRuntime.log(JSON.stringify(session, null, 2));
      defaultRuntime.log("Open authorizationUrl in a browser, then exchange the returned code.");
    });

  gemini
    .command("oauth-exchange")
    .description("Exchange OAuth code and persist tokens in keychain/keytar fallback")
    .requiredOption("--client-id <id>", "Google OAuth client id")
    .requiredOption("--redirect-uri <uri>", "OAuth redirect URI")
    .requiredOption("--code <code>", "OAuth code")
    .requiredOption("--code-verifier <verifier>", "PKCE code verifier")
    .option("--client-secret <secret>", "OAuth client secret")
    .action(async (opts) => {
      const tokens = await exchangeGeminiOAuthCode({
        clientId: String(opts.clientId),
        clientSecret: opts.clientSecret as string | undefined,
        redirectUri: String(opts.redirectUri),
        code: String(opts.code),
        codeVerifier: String(opts.codeVerifier),
      });
      await storeGeminiOAuthTokens(tokens);
      defaultRuntime.log("Gemini OAuth tokens stored.");
    });

  gemini
    .command("oauth-status")
    .description("Show whether Gemini OAuth tokens are available")
    .action(async () => {
      const tokens = await loadGeminiOAuthTokens();
      if (!tokens) {
        defaultRuntime.log("No Gemini OAuth tokens found.");
        return;
      }
      defaultRuntime.log(
        JSON.stringify(
          {
            hasAccessToken: Boolean(tokens.accessToken),
            hasRefreshToken: Boolean(tokens.refreshToken),
            expiresAtMs: tokens.expiresAtMs,
            scope: tokens.scope,
          },
          null,
          2,
        ),
      );
    });
}
