package com.opengravel.gh;

import java.util.Arrays;

/**
 * Dead-end territory, found by the graph itself.
 *
 * Over the usable edges (an undirected multigraph), find bridges with an iterative Tarjan (no
 * recursion: the PA + NJ graph has millions of edges), remove them, and call every remaining
 * connected part with at least {@link #MIN_PART_METERS} of road "big". An edge is through when
 * it lies in a big part, or when it lies on the way between two big parts (a single connector
 * road between two road networks is not a dead end: there is somewhere to go at both ends).
 * Everything else (spurs, cul-de-sac clusters, small islands) is dead-end territory.
 *
 * Callers pass each road once: artificial copies of an edge (made for via-way turn
 * restrictions) must be folded into their original first, or the pair would look like a loop.
 */
public final class OgThroughFlags {
    public static final double MIN_PART_METERS = 20_000;

    private OgThroughFlags() {
    }

    /**
     * @param nodes    node count
     * @param from     edge start node
     * @param to       edge end node
     * @param meters   edge length
     * @param usable   whether the edge takes part at all (unusable edges are never through)
     * @return through flag per edge
     */
    public static boolean[] compute(int nodes, int[] from, int[] to, double[] meters, boolean[] usable) {
        return analyze(nodes, from, to, meters, usable).through;
    }

    /** The verdict and why: which edges are bridges, how long each edge's part is, big parts on each side of a bridge. */
    public static final class Analysis {
        public boolean[] through, bridge;
        public double[] partMetersOfEdge;
        /** For a bridge: big parts on its child side and on the other side of the same tree. */
        public int[] bigBelow, bigOther;
    }

    public static Analysis analyze(int nodes, int[] from, int[] to, double[] meters, boolean[] usable) {
        int edges = from.length;
        // Compressed adjacency over usable, non-loop edges.
        int[] degree = new int[nodes + 1];
        for (int e = 0; e < edges; e++) {
            if (!usable[e] || from[e] == to[e]) continue;
            degree[from[e]]++;
            degree[to[e]]++;
        }
        int[] start = new int[nodes + 1];
        for (int v = 0; v < nodes; v++) start[v + 1] = start[v] + degree[v];
        int[] adjEdge = new int[start[nodes]];
        int[] fill = Arrays.copyOf(start, nodes);
        for (int e = 0; e < edges; e++) {
            if (!usable[e] || from[e] == to[e]) continue;
            adjEdge[fill[from[e]]++] = e;
            adjEdge[fill[to[e]]++] = e;
        }

        // Iterative Tarjan bridge finding, keyed by edge id so parallel roads are not bridges.
        int[] disc = new int[nodes];
        int[] low = new int[nodes];
        int[] parentEdge = new int[nodes];
        int[] cursor = new int[nodes];
        Arrays.fill(disc, -1);
        boolean[] bridge = new boolean[edges];
        int[] stack = new int[nodes];
        int time = 0;
        for (int root = 0; root < nodes; root++) {
            if (disc[root] >= 0 || start[root] == start[root + 1]) continue;
            int top = 0;
            stack[top++] = root;
            disc[root] = low[root] = time++;
            parentEdge[root] = -1;
            cursor[root] = start[root];
            while (top > 0) {
                int v = stack[top - 1];
                if (cursor[v] < start[v + 1]) {
                    int e = adjEdge[cursor[v]++];
                    if (e == parentEdge[v]) continue;
                    int w = from[e] == v ? to[e] : from[e];
                    if (disc[w] < 0) {
                        disc[w] = low[w] = time++;
                        parentEdge[w] = e;
                        cursor[w] = start[w];
                        stack[top++] = w;
                    } else if (disc[w] < low[v]) {
                        low[v] = disc[w];
                    }
                } else {
                    top--;
                    int pe = parentEdge[v];
                    if (pe >= 0) {
                        int p = from[pe] == v ? to[pe] : from[pe];
                        if (low[v] < low[p]) low[p] = low[v];
                        if (low[v] > disc[p]) bridge[pe] = true;
                    }
                }
            }
        }

        // Parts left after removing bridges.
        int[] part = new int[nodes];
        for (int v = 0; v < nodes; v++) part[v] = v;
        for (int e = 0; e < edges; e++)
            if (usable[e] && from[e] != to[e] && !bridge[e]) union(part, from[e], to[e]);
        double[] partMeters = new double[nodes];
        for (int e = 0; e < edges; e++)
            if (usable[e] && !bridge[e]) partMeters[find(part, from[e])] += meters[e];
        boolean[] big = new boolean[nodes];
        for (int v = 0; v < nodes; v++) if (find(part, v) == v && partMeters[v] >= MIN_PART_METERS) big[v] = true;

        // The bridges join the parts into a forest. Count big parts below each part (iterative DFS),
        // then a bridge is through when there is a big part on both sides of it, and a small part is
        // through when big parts hang off at least two of its sides.
        int[] tDegree = new int[nodes + 1];
        for (int e = 0; e < edges; e++) if (bridge[e]) { tDegree[find(part, from[e])]++; tDegree[find(part, to[e])]++; }
        int[] tStart = new int[nodes + 1];
        for (int v = 0; v < nodes; v++) tStart[v + 1] = tStart[v] + tDegree[v];
        int[] tAdj = new int[tStart[nodes]];
        int[] tFill = Arrays.copyOf(tStart, nodes);
        for (int e = 0; e < edges; e++) if (bridge[e]) { tAdj[tFill[find(part, from[e])]++] = e; tAdj[tFill[find(part, to[e])]++] = e; }
        int[] sub = new int[nodes];
        int[] tParentEdge = new int[nodes];
        int[] treeRoot = new int[nodes];
        int[] order = new int[nodes];
        boolean[] seen = new boolean[nodes];
        int ordered = 0;
        for (int r = 0; r < nodes; r++) {
            if (find(part, r) != r || seen[r]) continue;
            int head = ordered;
            order[ordered++] = r; seen[r] = true; tParentEdge[r] = -1; treeRoot[r] = r;
            for (int k = head; k < ordered; k++) {
                int c = order[k];
                for (int i = tStart[c]; i < tStart[c + 1]; i++) {
                    int e = tAdj[i];
                    int a = find(part, from[e]), b = find(part, to[e]);
                    int o = a == c ? b : a;
                    if (seen[o]) continue;
                    seen[o] = true; tParentEdge[o] = e; treeRoot[o] = r; order[ordered++] = o;
                }
            }
        }
        for (int k = ordered - 1; k >= 0; k--) {
            int c = order[k];
            sub[c] += big[c] ? 1 : 0;
            int pe = tParentEdge[c];
            if (pe >= 0) {
                int a = find(part, from[pe]), b = find(part, to[pe]);
                sub[a == c ? b : a] += sub[c];
            }
        }
        boolean[] partThrough = new boolean[nodes];
        for (int k = 0; k < ordered; k++) {
            int c = order[k];
            if (big[c]) { partThrough[c] = true; continue; }
            int total = sub[treeRoot[c]];
            int sides = total - sub[c] > 0 ? 1 : 0;
            for (int i = tStart[c]; i < tStart[c + 1]; i++) {
                int e = tAdj[i];
                if (e == tParentEdge[c]) continue;
                int a = find(part, from[e]), b = find(part, to[e]);
                if (sub[a == c ? b : a] > 0) sides++;
            }
            partThrough[c] = sides >= 2;
        }

        boolean[] through = new boolean[edges];
        Analysis out = new Analysis();
        out.bridge = bridge;
        out.partMetersOfEdge = new double[edges];
        out.bigBelow = new int[edges];
        out.bigOther = new int[edges];
        for (int e = 0; e < edges; e++) {
            if (!usable[e]) continue;
            out.partMetersOfEdge[e] = partMeters[find(part, from[e])];
            if (!bridge[e]) { through[e] = partThrough[find(part, from[e])]; continue; }
            int a = find(part, from[e]), b = find(part, to[e]);
            int child = tParentEdge[a] == e ? a : b;
            int total = sub[treeRoot[child]];
            out.bigBelow[e] = sub[child];
            out.bigOther[e] = total - sub[child];
            through[e] = sub[child] > 0 && total - sub[child] > 0;
        }
        out.through = through;
        return out;
    }

    static int find(int[] parent, int v) {
        while (parent[v] != v) {
            parent[v] = parent[parent[v]];
            v = parent[v];
        }
        return v;
    }

    static void union(int[] parent, int a, int b) {
        int ra = find(parent, a), rb = find(parent, b);
        if (ra != rb) parent[ra] = rb;
    }
}
