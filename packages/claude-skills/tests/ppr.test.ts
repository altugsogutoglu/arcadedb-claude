import { describe, it, expect } from "vitest";
import { personalizedPageRank, hubDamping } from "../src/ppr.js";

const graph = (edges: [string, string][]) => {
  const neighbors = new Map<string, string[]>();
  for (const [a, b] of edges) {
    (neighbors.get(a) ?? neighbors.set(a, []).get(a)!).push(b);
    (neighbors.get(b) ?? neighbors.set(b, []).get(b)!).push(a);
  }
  return { neighbors };
};

describe("personalizedPageRank", () => {
  it("keeps mass near the seed and gives none to a disconnected island", () => {
    // seed - a - b - c, plus an unrelated island x - y
    const g = graph([["seed", "a"], ["a", "b"], ["b", "c"], ["x", "y"]]);
    const r = personalizedPageRank(g, new Map([["seed", 1]]));
    const top2 = [...r.entries()].sort((x, y) => y[1] - x[1]).slice(0, 2).map(e => e[0]).sort();
    expect(top2).toEqual(["a", "seed"]);
    expect(r.get("a")!).toBeGreaterThan(r.get("b")!);
    expect(r.get("b")!).toBeGreaterThan(r.get("c")!);
    expect(r.get("x") ?? 0).toBe(0);
  });

  it("a node connected to two seeds beats a node connected to one", () => {
    const g = graph([["s1", "shared"], ["s2", "shared"], ["s1", "single"]]);
    const r = personalizedPageRank(g, new Map([["s1", 1], ["s2", 1]]));
    expect(r.get("shared")!).toBeGreaterThan(r.get("single")!);
  });

  it("hub damping stops a high-degree node from dominating", () => {
    const edges: [string, string][] = [["seed", "hub"], ["seed", "leaf"]];
    for (let i = 0; i < 50; i++) edges.push(["hub", `t${i}`]);
    const g = graph(edges);
    const plain = personalizedPageRank(g, new Map([["seed", 1]]));
    expect(plain.get("hub")!).toBeGreaterThan(plain.get("leaf")!);
    const degree = (n: string) => g.neighbors.get(n)?.length ?? 0;
    const damped = personalizedPageRank(g, new Map([["seed", 1]]), { nodeWeight: hubDamping(degree) });
    expect(damped.get("hub")! / damped.get("leaf")!).toBeLessThan(plain.get("hub")! / plain.get("leaf")!);
  });

  it("handles empty graphs and seeds outside the graph", () => {
    expect(personalizedPageRank({ neighbors: new Map() }, new Map([["a", 1]])).size).toBe(0);
    expect(personalizedPageRank(graph([["a", "b"]]), new Map([["zzz", 1]])).size).toBe(0);
  });
});
