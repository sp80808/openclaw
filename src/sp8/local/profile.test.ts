import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildLocalRecommendations,
  readSp8Profile,
  type Sp8HardwareProfile,
  writeSp8Profile,
} from "./profile.js";

describe("sp8 local profile", () => {
  it("round-trips profile JSON", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sp8-profile-test-"));
    const file = path.join(dir, "sp8-profile.json");

    await writeSp8Profile(
      {
        version: 1,
        routing: "full-local",
        localEnabled: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      file,
    );

    const profile = await readSp8Profile(file);
    expect(profile?.routing).toBe("full-local");
    expect(profile?.localEnabled).toBe(true);
  });

  it("returns high-tier recommendation for 64GB unified profile", () => {
    const hardware: Sp8HardwareProfile = {
      cpu: "Apple M3 Max",
      cpuCores: 14,
      ramGb: 64,
      gpu: "Apple Silicon (Unified)",
      gpuMemoryGb: null,
      capabilityClass: "Perfect for 32B-72B class models",
      profileLabel: "m3-max-64gb",
    };

    const rec = buildLocalRecommendations(hardware);
    expect(rec.models[0]?.model).toContain("32B");
    expect(rec.models.some((entry) => entry.role === "Vision")).toBe(true);
  });
});
