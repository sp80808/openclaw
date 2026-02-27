export type PhysicsKgNode = {
  id: string;
  label: string;
  type: string;
  x?: number;
  y?: number;
};

export type PhysicsKgEdge = {
  id: string;
  from: string;
  to: string;
  type: string;
  strength?: number;
};

export type PhysicsKgAlert = {
  severity: "low" | "medium" | "high";
  message: string;
  targetId?: string;
};

export type PhysicsKgState = {
  nodes: PhysicsKgNode[];
  edges: PhysicsKgEdge[];
  alerts?: PhysicsKgAlert[];
};

type Body = {
  vx: number;
  vy: number;
  x: number;
  y: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export class PhysicsKgRenderer {
  private readonly width: number;
  private readonly height: number;

  constructor(width = 1280, height = 720) {
    this.width = width;
    this.height = height;
  }

  tick(input: PhysicsKgState, dtMs = 16): PhysicsKgState {
    const dt = Math.max(0.001, dtMs / 1000);
    const bodies = new Map<string, Body>();
    const nodeById = new Map(input.nodes.map((node) => [node.id, node] as const));

    for (const [index, node] of input.nodes.entries()) {
      bodies.set(node.id, {
        x: node.x ?? ((index % 12) + 1) * 80,
        y: node.y ?? (Math.floor(index / 12) + 1) * 80,
        vx: 0,
        vy: 0,
      });
    }

    const ids = Array.from(bodies.keys());
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const left = bodies.get(ids[i]);
        const right = bodies.get(ids[j]);
        if (!left || !right) {
          continue;
        }
        const dx = right.x - left.x;
        const dy = right.y - left.y;
        const distanceSq = Math.max(1, dx * dx + dy * dy);
        const force = 1200 / distanceSq;
        left.vx -= dx * force * dt;
        left.vy -= dy * force * dt;
        right.vx += dx * force * dt;
        right.vy += dy * force * dt;
      }
    }

    for (const edge of input.edges) {
      const from = bodies.get(edge.from);
      const to = bodies.get(edge.to);
      if (!from || !to) {
        continue;
      }
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const distance = Math.max(0.001, Math.sqrt(dx * dx + dy * dy));
      const target = 170;
      const k = clamp(edge.strength ?? 0.08, 0.01, 0.2);
      const stretch = distance - target;
      const nx = dx / distance;
      const ny = dy / distance;
      from.vx += nx * stretch * k;
      from.vy += ny * stretch * k;
      to.vx -= nx * stretch * k;
      to.vy -= ny * stretch * k;
    }

    const nextNodes: PhysicsKgNode[] = input.nodes.map((node) => {
      const body = bodies.get(node.id);
      if (!body) {
        return node;
      }
      body.vx *= 0.92;
      body.vy *= 0.92;
      body.x = clamp(body.x + body.vx, 24, this.width - 24);
      body.y = clamp(body.y + body.vy, 24, this.height - 24);
      return {
        ...node,
        x: body.x,
        y: body.y,
      };
    });

    return {
      nodes: nextNodes,
      edges: input.edges,
      alerts: (input.alerts ?? []).map((alert) => {
        if (!alert.targetId) {
          return alert;
        }
        const target = nodeById.get(alert.targetId);
        if (!target) {
          return {
            ...alert,
            message: `[dangling-target] ${alert.message}`,
          };
        }
        return {
          ...alert,
          message: `${alert.message} (${target.label})`,
        };
      }),
    };
  }
}
