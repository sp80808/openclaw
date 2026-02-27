import { sp8KgEvolve, sp8KgGraph, sp8KgQuery, sp8KgValidate } from "../commands/sp8-kg.js";

export class OntologyMethods {
  async kgQuery(text: string, limit = 10) {
    return sp8KgQuery({ text, limit });
  }

  async kgGraph(params?: { physics?: boolean }) {
    return sp8KgGraph({ physics: params?.physics ?? false });
  }

  async kgEvolve(objective: string) {
    return sp8KgEvolve({ objective });
  }

  async kgValidate(workspaceDir: string) {
    return sp8KgValidate({ workspaceDir });
  }
}

export class PersonalKG extends OntologyMethods {}
