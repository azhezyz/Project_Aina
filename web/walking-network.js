/* Local pedestrian routing over the Kyoto OpenStreetMap extract. */
(() => {
  "use strict";
  const maxSnap = 45; // Metres from a POI pin to the nearest walkable segment.
  const gridSize = 80;
  const weights = [1, 1.02, 1.07, 1.10, 1.13];
  const snaps = new Map(), routes = new Map();
  let graph;

  function remember(cache, key, value) {
    if (cache.size >= 256) cache.delete(cache.keys().next().value);
    cache.set(key, value);
    return value;
  }

  function bytes(encoded) {
    return new DataView(Uint8Array.from(atob(encoded), c => c.charCodeAt(0)).buffer);
  }

  function getGraph() {
    if (graph) return graph;
    const data = window.kyotoWalkingData;
    if (!data) return null;
    const vertices = bytes(data.vertices), segments = bytes(data.segments);
    const nodes = [], grid = new Map();
    for (let i = 0; i < vertices.byteLength; i += 4) {
      nodes.push({point: [vertices.getInt16(i, true), vertices.getInt16(i+2, true)], outgoing: []});
    }
    for (let i = 0; i < segments.byteLength; i += 5) {
      const a = segments.getUint16(i, true), b = segments.getUint16(i+2, true);
      const flags = segments.getUint8(i+4);
      const [x, y] = nodes[a].point, [xx, yy] = nodes[b].point;
      const length = Math.hypot(xx-x, yy-y);
      const edge = {a, b, forward: Boolean(flags & 8), reverse: Boolean(flags & 16),
        dx: xx-x, dy: yy-y, cost: length * weights[flags & 7]};
      if (edge.forward) nodes[a].outgoing.push([b, edge.cost]);
      if (edge.reverse) nodes[b].outgoing.push([a, edge.cost]);
      // A long OSM segment may run through several search cells.
      for (let gx = Math.floor(Math.min(x,xx)/gridSize); gx <= Math.floor(Math.max(x,xx)/gridSize); gx++) {
        for (let gy = Math.floor(Math.min(y,yy)/gridSize); gy <= Math.floor(Math.max(y,yy)/gridSize); gy++) {
          const cell = gx + "," + gy;
          if (!grid.has(cell)) grid.set(cell, []);
          grid.get(cell).push(edge);
        }
      }
    }
    graph = {nodes, grid};
    return graph;
  }

  function inBounds(place) {
    const bounds = window.kyotoWalkingData?.bounds;
    return bounds && Number.isFinite(place?.lat) && Number.isFinite(place?.lng) &&
      place.lng >= bounds[0] && place.lat >= bounds[1] && place.lng <= bounds[2] && place.lat <= bounds[3];
  }

  const locationKey = p => p.lat + "," + p.lng;
  function snap(place) {
    if (!inBounds(place)) return null;
    const key = locationKey(place);
    if (snaps.has(key)) return snaps.get(key);
    const {nodes, grid} = getGraph();
    const x = (place.lng - 135.77) * 91300, y = (35.01 - place.lat) * 111000;
    let best = null, limit = maxSnap * maxSnap;
    const visited = new Set();
    for (let gx = Math.floor((x-maxSnap)/gridSize); gx <= Math.floor((x+maxSnap)/gridSize); gx++) {
      for (let gy = Math.floor((y-maxSnap)/gridSize); gy <= Math.floor((y+maxSnap)/gridSize); gy++) {
        for (const edge of grid.get(gx + "," + gy) || []) {
          if (visited.has(edge)) continue;
          visited.add(edge);
          const [ax, ay] = nodes[edge.a].point;
          const squared = edge.dx ** 2 + edge.dy ** 2;
          if (!squared) continue;
          const t = Math.max(0, Math.min(1, ((x-ax)*edge.dx + (y-ay)*edge.dy) / squared));
          const px = ax+t*edge.dx, py = ay+t*edge.dy;
          const distance = (x-px) ** 2 + (y-py) ** 2;
          if (distance < limit) {
            limit = distance;
            best = {edge, t, pin: [x,y], point: [px,py]};
          }
        }
      }
    }
    return remember(snaps, key, best);
  }

  // A binary min-heap ordered by estimated total walking cost.
  function push(heap, row) {
    let i = heap.length;
    heap.push(row);
    while (i > 0) {
      const parent = (i-1) >> 1;
      if (heap[parent][0] <= row[0]) break;
      heap[i] = heap[parent];
      i = parent;
    }
    heap[i] = row;
  }
  function pop(heap) {
    const first = heap[0], tail = heap.pop();
    if (!heap.length) return first;
    let i = 0;
    while (i*2+1 < heap.length) {
      let child = i*2+1;
      if (child+1 < heap.length && heap[child+1][0] < heap[child][0]) child++;
      if (tail[0] <= heap[child][0]) break;
      heap[i] = heap[child];
      i = child;
    }
    heap[i] = tail;
    return first;
  }

  function path(start, end) {
    const {nodes} = getGraph();
    const scores = new Map(), parent = new Map(), goals = new Map(), heap = [];
    const e = start.edge, f = end.edge;
    function relax(node, cost, previous) {
      if (cost >= (scores.get(node) ?? Infinity)) return;
      scores.set(node, cost);
      parent.set(node, previous);
      const [x, y] = nodes[node].point;
      push(heap, [cost + Math.hypot(x-end.point[0], y-end.point[1]), node, cost]);
    }
    // Start and end can fall midway along a street. Seed both legal directions
    // with only the fractional edge cost, respecting pedestrian one-way tags.
    if (e.reverse || start.t === 0) relax(e.a, e.cost*start.t, -1);
    if (e.forward || start.t === 1) relax(e.b, e.cost*(1-start.t), -1);
    if (f.forward || end.t === 0) goals.set(f.a, f.cost*end.t);
    if (f.reverse || end.t === 1) goals.set(f.b, f.cost*(1-end.t));
    let bestCost = Infinity, last = -1;
    if (e === f && ((start.t <= end.t && e.forward) || (start.t >= end.t && e.reverse))) {
      bestCost = Math.abs(end.t-start.t)*e.cost;
    }
    while (heap.length && heap[0][0] < bestCost) {
      const [, node, cost] = pop(heap);
      if (scores.get(node) !== cost) continue;
      const remaining = goals.get(node);
      if (remaining !== undefined && cost+remaining < bestCost) {
        bestCost = cost+remaining;
        last = node;
      }
      for (const [other, weight] of nodes[node].outgoing) relax(other, cost+weight, node);
    }
    if (!Number.isFinite(bestCost)) return null;
    const middle = [];
    while (last !== -1) {
      middle.push(nodes[last].point);
      last = parent.get(last);
    }
    const points = [start.pin];
    let meters = 0;
    for (const point of [start.point, ...middle.reverse(), end.point, end.pin]) {
      const previous = points[points.length-1];
      if (point[0] === previous[0] && point[1] === previous[1]) continue;
      meters += Math.hypot(point[0]-previous[0], point[1]-previous[1]);
      points.push(point);
    }
    return {points, meters: Math.round(meters)};
  }

  function leg(from, to) {
    if (!inBounds(from) || !inBounds(to)) return null;
    const key = locationKey(from) + "|" + locationKey(to);
    if (routes.has(key)) return routes.get(key);
    const a = snap(from), b = snap(to);
    const result = a && b ? (a === b ? {points:[a.pin, a.pin], meters:0} : path(a,b)) : null;
    return remember(routes, key, result);
  }
  window.atlasWalking = {leg, canRoute: place => Boolean(snap(place))};
})();
