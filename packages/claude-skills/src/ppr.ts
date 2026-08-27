/**
 * Personalized PageRank over a small in-memory subgraph (the HippoRAG idea at query time):
 * seeds are the retriever hits, the walk spreads their weight to nodes that share refs, sessions
 * and supersession links. Pure and synchronous; the caller fetches the adjacency.
 */

export interface PprOptions {
  damping?: number;
  iterations?: number;
  /** Per-node weight multiplier on outgoing mass, e.g. to dampen hub :Ref nodes. */
  nodeWeight?: (node: string) => number;
}

export interface PprGraph {
  /** Undirected adjacency: every edge appears in both lists. */
  neighbors: Map<string, string[]>;
}

export function personalizedPageRank(graph: PprGraph, seeds: Map<string, number>, opts: PprOptions = {}): Map<string, number> {
  const damping = opts.damping ?? 0.85;
  const iterations = opts.iterations ?? 30;
  const nodes = [...graph.neighbors.keys()];
  if (nodes.length === 0) return new Map();
  const seedTotal = [...seeds.values()].reduce((a, b) => a + b, 0) || 1;
  const teleport = new Map<string, number>();
  for (const [n, w] of seeds) if (graph.neighbors.has(n)) teleport.set(n, w / seedTotal);
  if (teleport.size === 0) return new Map();

  // Edge weight = nodeWeight(target): mass flowing INTO a hub is scaled down, so a symbol mentioned
  // everywhere does not become the strongest node and pull everything else up with it.
  const weight = opts.nodeWeight ?? (() => 1);
  const outW = new Map<string, number>();
  for (const n of nodes) outW.set(n, (graph.neighbors.get(n) ?? []).reduce((a, m) => a + weight(m), 0));

  let rank = new Map<string, number>(teleport);
  for (let i = 0; i < iterations; i++) {
    const next = new Map<string, number>();
    for (const [n, t] of teleport) next.set(n, (1 - damping) * t);
    for (const [n, r] of rank) {
      const total = outW.get(n) ?? 0;
      if (total === 0) {
        // Dangling: give the mass back to the seeds.
        for (const [s, t] of teleport) next.set(s, (next.get(s) ?? 0) + damping * r * t);
        continue;
      }
      for (const m of graph.neighbors.get(n) ?? []) {
        next.set(m, (next.get(m) ?? 0) + damping * r * (weight(m) / total));
      }
    }
    rank = next;
  }
  return rank;
}

/** HippoRAG-style node specificity: hubs (many neighbours) pass on less weight. */
export function hubDamping(degree: (node: string) => number): (node: string) => number {
  return (node) => 1 / Math.log2(2 + degree(node));
}
