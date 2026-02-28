import { spawn } from "node:child_process";

async function runProcess(command: string, args: string[], timeoutMs = 90_000): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    const chunks: string[] = [];
    const errChunks: string[] = [];
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`gemini-cli timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => chunks.push(String(chunk)));
    child.stderr.on("data", (chunk) => errChunks.push(String(chunk)));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(chunks.join("").trim());
        return;
      }
      reject(new Error(errChunks.join("").trim() || `gemini-cli exited with code ${code}`));
    });
  });
}

export async function runGeminiCliPrompt(prompt: string): Promise<string> {
  const directArgs = ["-p", prompt];
  try {
    return await runProcess("gemini", directArgs);
  } catch {
    return await runProcess("pnpm", ["exec", "gemini", ...directArgs]);
  }
}
