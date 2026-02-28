import fs from "node:fs/promises";
import path from "node:path";
import { resolveUserPath } from "../utils.js";

type EvolveRecord = {
  at: string;
  signal: string;
  scoreDelta: number;
};

export async function appendEvolutionSignal(
  signal: string,
  scoreDelta = 1,
): Promise<{ total: number }> {
  const file = path.join(resolveUserPath("~/.openclaw/sp8"), "evolve.jsonl");
  await fs.mkdir(path.dirname(file), { recursive: true });
  const record: EvolveRecord = {
    at: new Date().toISOString(),
    signal,
    scoreDelta,
  };
  await fs.appendFile(file, `${JSON.stringify(record)}\n`);

  const raw = await fs.readFile(file, "utf8");
  const total = raw
    .split(/\n+/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as EvolveRecord)
    .reduce((acc, entry) => acc + entry.scoreDelta, 0);

  return { total };
}
