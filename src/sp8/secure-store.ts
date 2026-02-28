import fs from "node:fs/promises";
import path from "node:path";
import { resolveUserPath } from "../utils.js";

type KeytarLike = {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
};

async function tryLoadKeytar(): Promise<KeytarLike | null> {
  try {
    const mod = (await import("keytar")) as unknown as KeytarLike;
    if (typeof mod.getPassword === "function" && typeof mod.setPassword === "function") {
      return mod;
    }
    return null;
  } catch {
    return null;
  }
}

function fallbackPath(service: string, account: string): string {
  const safe = `${service}--${account}`.replace(/[^a-zA-Z0-9_.-]/g, "_");
  return path.join(resolveUserPath("~/.openclaw/credentials/sp8"), `${safe}.json`);
}

export async function writeSecureJson(
  service: string,
  account: string,
  data: unknown,
): Promise<void> {
  const payload = JSON.stringify(data);
  const keytar = await tryLoadKeytar();
  if (keytar) {
    await keytar.setPassword(service, account, payload);
    return;
  }
  const file = fallbackPath(service, account);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${payload}\n`, { mode: 0o600 });
}

export async function readSecureJson<T>(service: string, account: string): Promise<T | null> {
  const keytar = await tryLoadKeytar();
  if (keytar) {
    const raw = await keytar.getPassword(service, account);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as T;
  }

  const file = fallbackPath(service, account);
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
