/**
 * Coarse navigation over a hand-authored waypoint graph.
 *
 * No navmesh, no triangle A*. The level is three connected areas, so ~28 nodes
 * describe every route through it. Once per re-plan we run Dijkstra *backwards*
 * from the player's node and store a next-hop per node - a flow field. Every
 * zombie then navigates by reading one array entry, which costs nothing, instead
 * of each running its own search.
 *
 * Doors are edges, not geometry: a shut shutter simply removes its edges from
 * the graph, so the Blighted correctly route the long way round (or not at all)
 * until the player pays to open it.
 */

export interface WpNode {
  id: string;
  x: number;
  z: number;
  zone: string;
}

export interface WpEdge {
  a: string;
  b: string;
  /** Edge only traversable while this door is open. */
  doorId?: string;
}

interface Link {
  to: number;
  cost: number;
  doorId: string | null;
}

export class WaypointGraph {
  readonly nodes: WpNode[];
  private readonly adj: Link[][];
  private readonly indexById = new Map<string, number>();

  /** nextHop[i] = index of the node to walk to from i, or -1 if unreachable. */
  readonly nextHop: Int16Array;
  readonly distance: Float32Array;
  private target = -1;

  // Reusable Dijkstra scratch - the graph is tiny and fixed, so we never
  // allocate during a re-plan.
  private readonly visited: Uint8Array;
  private readonly bestDist: Float32Array;
  private readonly cameFrom: Int16Array;

  constructor(nodes: WpNode[], edges: WpEdge[]) {
    this.nodes = nodes;
    nodes.forEach((n, i) => this.indexById.set(n.id, i));
    this.adj = nodes.map(() => []);
    for (const e of edges) {
      const a = this.indexById.get(e.a);
      const b = this.indexById.get(e.b);
      if (a === undefined || b === undefined) {
        throw new Error(`Waypoint edge references unknown node: ${e.a} -> ${e.b}`);
      }
      const cost = Math.hypot(nodes[a].x - nodes[b].x, nodes[a].z - nodes[b].z);
      const doorId = e.doorId ?? null;
      this.adj[a].push({ to: b, cost, doorId });
      this.adj[b].push({ to: a, cost, doorId });
    }
    this.nextHop = new Int16Array(nodes.length).fill(-1);
    this.distance = new Float32Array(nodes.length).fill(Infinity);
    this.visited = new Uint8Array(nodes.length);
    this.bestDist = new Float32Array(nodes.length);
    this.cameFrom = new Int16Array(nodes.length);
  }

  indexOf(id: string): number {
    const i = this.indexById.get(id);
    if (i === undefined) throw new Error(`Unknown waypoint: ${id}`);
    return i;
  }

  /** Nearest node by straight-line distance, optionally restricted to a zone. */
  nearest(x: number, z: number, zone?: string): number {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      if (zone && n.zone !== zone) continue;
      const d = (n.x - x) * (n.x - x) + (n.z - z) * (n.z - z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  /**
   * Rebuild the flow field toward `targetIdx`. O(V^2) Dijkstra, which for 28
   * nodes is ~800 compares - a rounding error, and simpler than a heap.
   */
  computeFlow(targetIdx: number, openDoors: Set<string>): void {
    const n = this.nodes.length;
    this.target = targetIdx;
    this.visited.fill(0);
    this.cameFrom.fill(-1);
    for (let i = 0; i < n; i++) this.bestDist[i] = Infinity;
    if (targetIdx < 0) {
      this.nextHop.fill(-1);
      return;
    }
    this.bestDist[targetIdx] = 0;

    for (let step = 0; step < n; step++) {
      let u = -1;
      let bd = Infinity;
      for (let i = 0; i < n; i++) {
        if (!this.visited[i] && this.bestDist[i] < bd) {
          bd = this.bestDist[i];
          u = i;
        }
      }
      if (u < 0) break;
      this.visited[u] = 1;
      const links = this.adj[u];
      for (let k = 0; k < links.length; k++) {
        const l = links[k];
        if (l.doorId !== null && !openDoors.has(l.doorId)) continue;
        const nd = bd + l.cost;
        if (nd < this.bestDist[l.to]) {
          this.bestDist[l.to] = nd;
          // We searched *from* the target, so "came from" is literally the
          // next hop toward it.
          this.cameFrom[l.to] = u;
        }
      }
    }

    for (let i = 0; i < n; i++) {
      this.distance[i] = this.bestDist[i];
      this.nextHop[i] = i === targetIdx ? targetIdx : this.cameFrom[i];
    }
  }

  get targetNode(): number {
    return this.target;
  }

  node(i: number): WpNode {
    return this.nodes[i];
  }

  /** Is any route from this node to the current target available? */
  reachable(i: number): boolean {
    return i >= 0 && Number.isFinite(this.distance[i]);
  }
}
