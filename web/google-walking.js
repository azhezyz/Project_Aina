(() => {
  "use strict";

  // Directions are directional and live only for this page session.
  const entries = new Map();
  const changedRoutes = new Set();
  const caution = "步行路线可能缺少人行道或步行道。";
  let wanted = new Map(), running = 0, version = 0;
  let updateScheduled = false;
  const enabled = () => window.AINA_CONFIG?.googleWalkingRoutesEnabled === true &&
    window.atlasMap?.getBasemapState() === "google";
  const pairKey = (a, b) => JSON.stringify([a.id, b.id]);
  const located = p => Number.isFinite(p?.lat) && Number.isFinite(p?.lng);

  function pairs(route) {
    const byId = window.atlasSavedPlaces.byId;
    const result = [];
    for (let i = 1; i < route.stops.length; i++) {
      const from = byId.get(route.stops[i - 1]), to = byId.get(route.stops[i]);
      if (from && to && from.id !== to.id) result.push([from, to]);
    }
    return result;
  }

  function locallyRoutable(a, b) {
    if (window.atlasMap.hasLocalLeg) return window.atlasMap.hasLocalLeg(a, b);
    return Number.isFinite(window.kyotoGeo?.distances?.[[a.id, b.id].sort().join("|")]) ||
      Boolean(window.atlasWalking?.leg(a, b));
  }

  function notify(ids) {
    for (const id of ids) changedRoutes.add(id);
    if (updateScheduled || !changedRoutes.size) return;
    updateScheduled = true;
    queueMicrotask(() => {
      updateScheduled = false;
      const routeIds = [...changedRoutes];
      changedRoutes.clear();
      window.dispatchEvent(new CustomEvent("aina-google-walking-updated", {detail: {routeIds}}));
    });
  }

  async function calculate({from, to}) {
    const {Route} = await window.atlasGoogle.load("routes");
    const {Place} = from.googlePlaceId || to.googlePlaceId
      ? await window.atlasGoogle.load("places") : {};
    const endpoint = p => p.googlePlaceId ? new Place({id: p.googlePlaceId}) : {lat: p.lat, lng: p.lng};
    const {routes} = await Route.computeRoutes({
      origin: endpoint(from), destination: endpoint(to), travelMode: "WALKING",
      fields: ["path", "distanceMeters", "durationMillis", "warnings"]
    });
    const route = routes?.[0];
    if (!route?.path?.length || !Number.isFinite(route.distanceMeters)) return null;
    const path = route.path.map(position => position.toJSON());
    const points = path.map(({lat, lng}) => [(lng - 135.77) * 91300, (35.01 - lat) * 111000]);
    return {
      points, meters: route.distanceMeters, durationMillis: route.durationMillis,
      endpoints: [path[0], path[path.length - 1]], warnings: route.warnings || []
    };
  }

  async function fetchLeg(key, job) {
    running++;
    entries.set(key, {status: "loading"});
    notify(job.routeIds);
    try {
      const data = await calculate(job);
      entries.set(key, {status: data ? "ready" : "unavailable", data});
    } catch (error) {
      entries.set(key, {status: error?.code === "ZERO_RESULTS" || error?.code === "NOT_FOUND"
        ? "unavailable" : "error"});
    } finally {
      version++;
      running--;
      const current = wanted.get(key);
      if (current) notify(current.routeIds);
      pump();
    }
  }

  function pump() {
    if (!enabled()) return;
    for (const [key, job] of wanted) {
      if (running >= 2) break;
      if (!entries.has(key)) void fetchLeg(key, job);
    }
  }

  function sync(state) {
    const jobs = new Map(), warnings = new Set();
    if (enabled()) {
      const visible = new Set(state.visibleIds);
      for (const route of state.routes) {
        if (!visible.has(route.id)) continue;
        for (const [from, to] of pairs(route)) {
          if (locallyRoutable(from, to) || !(from.googlePlaceId || located(from)) ||
              !(to.googlePlaceId || located(to))) continue;
          const key = pairKey(from, to);
          if (!jobs.has(key)) jobs.set(key, {from, to, routeIds: []});
          jobs.get(key).routeIds.push(route.id);
          const data = entries.get(key)?.data;
          if (data) for (const warning of [caution, ...data.warnings]) warnings.add(warning);
        }
      }
    }
    const note = document.getElementById("walking-map-note");
    if (note) { note.hidden = !warnings.size; note.title = [...warnings].join("\n"); }
    wanted = jobs;
    pump();
  }

  function leg(a, b) {
    return a && b && enabled() ? entries.get(pairKey(a, b))?.data || null : null;
  }

  function summary(route) {
    const warnings = new Set(), statuses = new Set();
    if (enabled()) for (const [a, b] of pairs(route)) {
      if (locallyRoutable(a, b)) continue;
      const entry = entries.get(pairKey(a, b));
      statuses.add(entry?.status || (wanted.has(pairKey(a, b)) ? "loading" : "idle"));
      if (entry?.data) for (const warning of [caution, ...entry.data.warnings]) warnings.add(warning);
    }
    const status = ["loading", "error", "unavailable", "idle", "ready"].find(s => statuses.has(s)) || "idle";
    return {status, usesGoogle: warnings.size > 0, warnings: [...warnings]};
  }

  function minutes(route) {
    if (!enabled()) return null;
    let time = 0, hasRemote = false;
    for (const [a, b] of pairs(route)) {
      const meters = window.kyotoGeo?.distances?.[[a.id, b.id].sort().join("|")] ?? window.atlasWalking?.leg(a, b)?.meters;
      if (Number.isFinite(meters)) { time += meters / 67; continue; }
      const data = leg(a, b);
      if (!Number.isFinite(data?.durationMillis)) return null;
      hasRemote = true;
      time += data.durationMillis / 60000;
    }
    return hasRemote ? Math.max(time > 0 ? 1 : 0, Math.round(time)) : null;
  }

  function retry(route, state) {
    if (!route || !enabled()) return;
    for (const [a, b] of pairs(route)) {
      const key = pairKey(a, b);
      if (["error", "unavailable"].includes(entries.get(key)?.status)) entries.delete(key);
    }
    sync(state);
  }

  window.atlasGoogleWalking = {leg, summary, minutes, sync, retry, get version() { return version; }};
})();
