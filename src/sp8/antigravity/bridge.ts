import { spawn } from "node:child_process";
import path from "node:path";
import WebSocket from "ws";

export type AntigravityBridgeEvent = {
  type: string;
  payload?: Record<string, unknown>;
};

export class AntigravityBridge {
  private socket: WebSocket | null = null;

  async connect(url: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.once("open", () => {
        this.socket = ws;
        resolve();
      });
      ws.once("error", reject);
    });
  }

  send(event: AntigravityBridgeEvent): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Antigravity bridge is not connected");
    }
    this.socket.send(JSON.stringify(event));
  }

  close(): void {
    this.socket?.close();
    this.socket = null;
  }
}

export function launchAntigravityProject(projectPath: string, options?: { binary?: string }): void {
  const binary = options?.binary?.trim() || "antigravity";
  const resolved = path.resolve(projectPath);
  const child = spawn(binary, [resolved], {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();
}
