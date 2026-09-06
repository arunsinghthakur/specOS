import type { SpecNode } from "./schema.js";

export class TaskGraph {
  private readonly nodes: Map<string, SpecNode>;

  constructor(nodes: SpecNode[]) {
    this.nodes = new Map(nodes.map((node) => [node.id, node]));
    assertNoUnknownDependencies(this.nodes);
    assertAcyclic(this.nodes);
  }

  get size(): number {
    return this.nodes.size;
  }

  getNode(id: string): SpecNode | undefined {
    return this.nodes.get(id);
  }

  /** Nodes whose dependencies are all in `completed`, excluding nodes already in `completed`. */
  getReady(completed: ReadonlySet<string>): SpecNode[] {
    const ready: SpecNode[] = [];
    for (const node of this.nodes.values()) {
      if (completed.has(node.id)) continue;
      if (node.dependencies.every((dep) => completed.has(dep))) {
        ready.push(node);
      }
    }
    return ready;
  }

  /** Full topological order, for display/dry-run purposes. */
  topologicalOrder(): string[] {
    const completed = new Set<string>();
    const order: string[] = [];
    while (completed.size < this.nodes.size) {
      const ready = this.getReady(completed);
      if (ready.length === 0) {
        throw new Error("TaskGraph: unable to make progress — this should be unreachable after acyclicity check.");
      }
      for (const node of ready) {
        order.push(node.id);
        completed.add(node.id);
      }
    }
    return order;
  }
}

function assertNoUnknownDependencies(nodes: Map<string, SpecNode>): void {
  for (const node of nodes.values()) {
    for (const dep of node.dependencies) {
      if (!nodes.has(dep)) {
        throw new Error(`Task graph error: "${node.id}" depends on unknown task "${dep}".`);
      }
    }
  }
}

function assertAcyclic(nodes: Map<string, SpecNode>): void {
  const state = new Map<string, "visiting" | "done">();

  function visit(id: string, path: string[]): void {
    const status = state.get(id);
    if (status === "done") return;
    if (status === "visiting") {
      throw new Error(`Task graph has a dependency cycle: ${[...path, id].join(" -> ")}`);
    }
    state.set(id, "visiting");
    for (const dep of nodes.get(id)!.dependencies) {
      visit(dep, [...path, id]);
    }
    state.set(id, "done");
  }

  for (const id of nodes.keys()) {
    visit(id, []);
  }
}
