export type Sp8SwarmAgent = {
  id: string;
  role: string;
  focus: string;
};

const SWARM_TEMPLATE: Sp8SwarmAgent[] = [
  { id: "scout", role: "Discovery Scout", focus: "requirements + ambiguity" },
  { id: "architect", role: "System Architect", focus: "design + interfaces" },
  { id: "coder", role: "Implementation Agent", focus: "code changes" },
  { id: "tester", role: "Test Agent", focus: "verification + regressions" },
  { id: "security", role: "Security Agent", focus: "threat model + hardening" },
  { id: "performance", role: "Performance Agent", focus: "latency + scale" },
  { id: "docs", role: "Documentation Agent", focus: "readme + user guidance" },
  { id: "release", role: "Release Agent", focus: "packaging + rollout checks" },
];

export function createSp8Swarm(goal: string): { goal: string; agents: Sp8SwarmAgent[] } {
  return {
    goal,
    agents: SWARM_TEMPLATE,
  };
}
