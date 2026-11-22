/* Route framing and transparent guides for Kyoto map posters. */
(() => {
  "use strict";
  const {t} = window.atlasLocale;
  const width = 1024, height = 1280;
  const padding = {left: 90, right: 90, top: 150, bottom: 224};
  const degrees = Math.PI / 180;
  const scaleX = 91300, scaleY = 111000, originLng = 135.77, originLat = 35.01;
  const radius = scaleX / degrees;
  const originMercator = Math.asinh(Math.tan(originLat * degrees));
  const osmCredit = "© OpenStreetMap contributors";
  const osmUrl = "https://www.openstreetmap.org/copyright";

  // The explicitly offline export uses only the bundled editorial catalog.
  const places = new Map(window.atlasData.places.filter(p => !p.dynamic).map(p => [
    p.id, {id: p.id, name: window.atlasLocale.en ? p.en : p.zh, lat: p.lat, lng: p.lng}
  ]));

  function mercator(lat, lng) {
    return [(lng - originLng) * scaleX, radius * (originMercator - Math.asinh(Math.tan(lat * degrees)))];
  }
  function fromLocal([x, y]) {
    return mercator(originLat - y / scaleY, originLng + x / scaleX);
  }
  function viewport(paths, stops) {
    let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
    function include([x, y]) {
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
    for (const path of paths) for (const point of path) include(point);
    for (const stop of stops) include(mercator(stop.lat, stop.lng));
    const innerWidth = width - padding.left - padding.right;
    const innerHeight = height - padding.top - padding.bottom;
    const pixelsPerMeter = Math.min(innerWidth / Math.max(right - left, 100),
      innerHeight / Math.max(bottom - top, 100));
    const offsetX = padding.left + innerWidth / 2 - pixelsPerMeter * (left + right) / 2;
    const offsetY = padding.top + innerHeight / 2 - pixelsPerMeter * (top + bottom) / 2;
    const pixel = ([x, y]) => [offsetX + x * pixelsPerMeter, offsetY + y * pixelsPerMeter];
    const project = (lat, lng) => pixel(mercator(lat, lng));
    const unproject = (x, y) => ({
      lng: originLng + (x - offsetX) / (pixelsPerMeter * scaleX),
      lat: Math.atan(Math.sinh(originMercator - (y - offsetY) / (pixelsPerMeter * radius))) / degrees
    });
    const nw = unproject(0, 0), se = unproject(width, height);
    return {pixel, project, unproject, pixelsPerMeter, center: unproject(width / 2, height / 2),
      bounds: {west: nw.lng, north: nw.lat, east: se.lng, south: se.lat}};
  }

  function makeCanvas() {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  function drawBasemap(frame, layers) {
    const canvas = makeCanvas(), ctx = canvas.getContext("2d");
    ctx.fillStyle = "#f5f1e7";
    ctx.fillRect(0, 0, width, height);
    const {west, east, north, south} = frame.bounds;
    const left = (west - originLng) * scaleX, right = (east - originLng) * scaleX;
    const top = (originLat - north) * scaleY, bottom = (originLat - south) * scaleY;
    // Existing Path2D layers are in Kyoto local metres. Over this compact
    // extract, interpolating between the Mercator edges incurs subpixel error.
    const sx = width / (right - left), sy = height / (bottom - top);
    ctx.setTransform(sx, 0, 0, sy, -left * sx, -top * sy);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    function layer(kind, color, weight = 0) {
      if (weight) { ctx.strokeStyle = color; ctx.lineWidth = weight; }
      else ctx.fillStyle = color;
      for (const item of layers[kind] || []) {
        const [x0, y0, x1, y1] = item.bounds;
        if (x0 > right + weight || x1 < left - weight || y0 > bottom + weight || y1 < top - weight) continue;
        if (weight) ctx.stroke(item.path);
        else ctx.fill(item.path);
      }
    }
    layer("shrine", "#e5e6d6");
    layer("park", "#dce5d2");
    layer("forest", "#c8d9c2");
    layer("stream", "#a5c9cd", 3);
    layer("water", "#b8d6d6");
    layer("building", "#dbd5c9");
    for (const [kind, meters, outline, fill] of [
      ["foot", 2.6, "#d1cbbd", "#fffcf3"], ["lane", 4, "#d9d1c3", "#fffcf6"],
      ["street", 7, "#cfc8ba", "#fffefa"], ["main", 12, "#c9beb0", "#fffaf0"],
      ["artery", 15, "#ccbaa1", "#f6ead0"]
    ]) {
      layer(kind, outline, meters + 1.6 / sx);
      layer(kind, fill, meters);
    }
    return canvas;
  }

  function drawMarkup(paths, stops) {
    const canvas = makeCanvas(), ctx = canvas.getContext("2d");
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (const path of paths) {
      ctx.moveTo(...path[0]);
      for (let i = 1; i < path.length; i++) ctx.lineTo(...path[i]);
    }
    ctx.strokeStyle = "#cd1964";
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.font = "bold 22px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    stops.forEach(({x, y}, index) => {
      ctx.beginPath();
      ctx.arc(x, y, 17, 0, Math.PI * 2);
      ctx.fillStyle = "#1b3058";
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#fff";
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.fillText(String(index + 1), x, y + 1);
    });
    return canvas;
  }

  function validate(route, stopsOnly = false) {
    const count = Array.isArray(route?.stops) ? new Set(route.stops).size : 0;
    if (stopsOnly && !count) throw new Error(t("请至少选择一个站点。", "Choose at least one stop."));
    if (!stopsOnly && count < 2) {
      throw new Error(t("请至少选择两个不同的站点。", "Choose at least two different stops."));
    }
  }

  function framed(projected, selected) {
    const frame = viewport(projected, selected);
    const paths = projected.map(path => path.map(frame.pixel));
    const stops = selected.map(({id, name, lat, lng}) => {
      const [x, y] = frame.project(lat, lng);
      return {id, name, x, y};
    });
    return {...frame, width, height, paths, stops, markedCanvas: drawMarkup(paths, stops)};
  }

  function render(route) {
    validate(route);
    const selected = route.stops.map(id => places.get(id));
    if (selected.some(p => !p)) {
      throw new Error(t("这条路线有站点缺少离线地图资料。", "Offline map data is unavailable for a stop on this route."));
    }
    const geometry = window.atlasMap?.getOfflineCartography();
    if (!geometry?.layers) throw new Error(t("京都离线底图尚未加载。", "The offline Kyoto map has not loaded."));
    const projected = [];
    for (let i = 1; i < selected.length; i++) {
      const from = selected[i - 1], to = selected[i];
      if (from.id === to.id) continue;
      const leg = geometry.bundledPath(from.id, to.id) || window.atlasWalking?.leg(from, to)?.points;
      if (!leg || leg.length < 2) throw new Error(t("离线路网缺少一段步行路线。", "A walking segment is missing from the offline network."));
      projected.push(leg.map(fromLocal));
    }
    const frame = framed(projected, selected);
    return {...frame, canvas: drawBasemap(frame, geometry.layers), attribution: osmCredit, attributionUrl: osmUrl,
      routeAttribution: t("步行路线", "Walking route") + " · " + osmCredit};
  }

  const located = p => Number.isFinite(p?.lat) && Math.abs(p.lat) < 85.05113 &&
    Number.isFinite(p.lng) && Math.abs(p.lng) <= 180;

  function liveFrame(route, stopsOnly, lookups) {
    const catalog = window.atlasSavedPlaces;
    const selected = route.stops.map(id => catalog.byId.get(id));
    if (selected.some(p => !p)) throw new Error(t("找不到行程中的一个站点。", "A stop is missing from this itinerary."));
    const positions = new Map(selected.filter(located).map(p => [p.id, p]));
    const projected = [], sources = new Set();
    const missing = [];
    for (let i = 1; i < selected.length; i++) {
      const from = selected[i - 1], to = selected[i];
      if (from.id === to.id) continue;
      if (stopsOnly && positions.has(from.id) && positions.has(to.id)) continue;
      const segment = window.atlasMap.getWalkingSegment(from.id, to.id);
      if (!segment?.points || segment.points.length < 2) {
        missing.push([from.id, to.id]);
        continue;
      }
      // A restored Google place may only have a place ID. The walking route
      // supplies the same entrance coordinates used for its on-map marker.
      [from, to].forEach((p, end) => {
        const position = segment.endpoints?.[end];
        if (!positions.has(p.id) && located(position)) positions.set(p.id, position);
      });
      if (!stopsOnly) {
        projected.push(segment.points.map(fromLocal));
        sources.add(segment.source);
      }
    }
    const unlocated = selected.find(p => !positions.has(p.id));
    if ((!stopsOnly && missing.length) || unlocated) {
      const state = window.atlasMap.getBasemapState();
      if (state === "loading") return null;
      const statuses = missing.map(stops => window.atlasGoogleWalking?.summary({stops}).status);
      if (statuses.includes("loading")) return null;
      if (unlocated) {
        if (!lookups.has(unlocated.id) && catalog.needsLookup(unlocated, stopsOnly)) {
          lookups.add(unlocated.id);
          void catalog.resolveName(unlocated, stopsOnly);
        }
        if (catalog.isLookupPending(unlocated)) return null;
        throw new Error(t("部分站点尚无坐标。请检查 Google 地点连接后重试。",
          "Some stops have no coordinates yet. Check the Google Places connection and try again."));
      }
      if (statuses.includes("unavailable")) throw new Error(t("Google 未找到部分站点之间的步行路线。",
        "Google could not find a walking route between some stops."));
      if (statuses.includes("error")) throw new Error(t("Google 步行路线请求失败。请在路线详情中重试步行路线。",
        "Google walking directions failed. Retry directions in the route details."));
      throw new Error(t("部分站点之间缺少步行路线。请检查 Google 地图和步行路线连接。",
        "Some walking directions are unavailable. Check the Google Maps and walking directions connection."));
    }
    const stops = selected.map(p => ({id: p.id, name: p.name, lat: positions.get(p.id).lat, lng: positions.get(p.id).lng}));
    const frame = framed(projected, stops);
    const credits = [sources.has("google") && "Google Maps", sources.has("osm") && osmCredit].filter(Boolean);
    const routeAttribution = credits.length ? t("步行路线", "Walking route") + " · " + credits.join(" / ") : "";
    return {...frame, routeAttribution, attribution: routeAttribution, attributionUrl: sources.has("osm") ? osmUrl : ""};
  }

  async function googleFrame(route, {signal, stopsOnly = false} = {}) {
    validate(route, stopsOnly);
    signal?.throwIfAborted();
    const selected = {id: route.id, stops: [...route.stops]};
    const lookups = new Set();
    const release = !stopsOnly && window.atlasGoogleWalking?.watchForPoster(selected);
    const events = ["aina-google-walking-updated", "aina-place-name-updated", "atlas:basemap-state"];
    try {
      const ready = liveFrame(selected, stopsOnly, lookups);
      if (ready) return ready;
      return await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => finish(reject, new Error(stopsOnly
          ? t("站点位置仍在加载，请稍后重试。", "Stop locations are still loading. Try again shortly.")
          : t("步行路线仍在加载，请稍后重试。", "Walking directions are still loading. Try again shortly."))), 20000);
        function finish(callback, result) {
          clearTimeout(timeout);
          for (const event of events) window.removeEventListener(event, check);
          signal?.removeEventListener("abort", cancel);
          callback(result);
        }
        function cancel() { finish(reject, signal.reason); }
        function check() {
          try {
            const frame = liveFrame(selected, stopsOnly, lookups);
            if (frame) finish(resolve, frame);
          } catch (error) { finish(reject, error); }
        }
        for (const event of events) window.addEventListener(event, check);
        signal?.addEventListener("abort", cancel, {once:true});
      });
    } finally { if (release) release(); }
  }
  window.atlasArtSource = {render, googleFrame};
})();
