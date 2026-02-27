export type SkillName =
  | "PluginForge"
  | "StemUVT"
  | "SampleOracle"
  | "SetForge"
  | "ChordDreamer"
  | "LiveGuard"
  | "MixShadow"
  | "MemoGravity";

export type SwarmPlan = {
  enabled: boolean;
  workers: string[];
  strategy: "parallel" | "pipeline";
};

export type MultimodalPlan = {
  enabled: boolean;
  channels: Array<"audio" | "midi" | "text" | "image">;
};

export type EvolutionProfile = {
  styleMirrorEnabled: boolean;
  reinforcementLoopEnabled: boolean;
  signatureTags: string[];
};

export type CanvasCard = {
  id: string;
  title: string;
  subtitle?: string;
  kind: "card" | "timeline" | "spectrogram";
  payload: Record<string, unknown>;
};

export type CanvasScene = {
  layout: "grid" | "timeline";
  visuals: CanvasCard[];
  notes: string[];
};

export type MusicEntityType =
  | "sample"
  | "stem"
  | "track"
  | "set"
  | "progression"
  | "performancelog"
  | "uvtpreset"
  | "pluginpatch";

export type KgEntityRecord = {
  id: string;
  type: MusicEntityType;
  label: string;
  tags?: string[];
  properties?: Record<string, unknown>;
};

export type KgRelationRecord = {
  id: string;
  type: string;
  from: string;
  to: string;
  weight?: number;
  properties?: Record<string, unknown>;
};

export type UvtBridgeContext = {
  uvtCliPath: string;
  uvtRootDir: string;
  presetsDir: string;
  soundbanksDir: string;
  dropsDir: string;
};

export type SkillExecutionContext = {
  workspaceDir: string;
  projectName?: string;
  profile: EvolutionProfile;
  swarm: SwarmPlan;
  multimodal: MultimodalPlan;
};

export type SkillExecutionResult = {
  skill: SkillName;
  summary: string;
  artifacts: string[];
  kgEntities: KgEntityRecord[];
  kgRelations: KgRelationRecord[];
  canvas: CanvasScene;
  telemetry: {
    elapsedMs: number;
    localOnly: true;
  };
};
