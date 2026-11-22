(() => {
  const $ = id => document.getElementById(id);
  const {t, lang} = window.atlasLocale;
  const { places, routes: initialRoutes } = window.atlasData;
  const presets = new Map(initialRoutes.map(route => [route.id, route]));
  const copySuffix = " · 副本";
  const translatedCopySuffix = t(copySuffix, " · Copy");
  const catalog = window.atlasSavedPlaces, byId = catalog.byId;
  const sheet = window.atlasSheet, map = window.atlasMap, panels = window.atlasPanels, windows = window.atlasWindows;
  const query = $("query"), body = $("sheet-body");
  const storeKey = "kyoto.walking.atlas.v1";
  let restored;
  try { restored = JSON.parse(localStorage.getItem(storeKey)); } catch { /* Storage is optional. */ }
  const staleCoordinates = catalog.restore(restored?.savedPlaces);
  const recoveredPlaces = catalog.recoverReferences(restored?.routes, restored?.pinnedIds);
  const validRoutes = Array.isArray(restored?.routes) &&
    restored.routes.every(r => r && typeof r.id === "string" && typeof r.name === "string" &&
      /^#[0-9a-f]{6}$/i.test(r.color) && Array.isArray(r.stops) && r.stops.every(s => byId.has(s)));
  const migrating = validRoutes && (restored.schemaVersion === 1 || restored.schemaVersion == null);
  const routes = (validRoutes ? restored.routes : initialRoutes).map(route => {
    const demo = presets.get(route.id);
    // Earlier versions didn't distinguish a generated title from a user's edit.
    const oldDefault = validRoutes && (restored.schemaVersion || 1) < 4 && !demo &&
      /^步行路线 [1-9]\d*(?: · 副本)*$/.test(route.name) ? route.name : undefined;
    // Only preset IDs with their original titles can migrate as preset names.
    // A version-five route without a name origin has an explicitly chosen title.
    const presetTitle = demo && (!validRoutes || ((restored.schemaVersion || 1) < 5 && route.name === demo.zh));
    return { ...route, stops: [...route.stops], color: migrating && demo ? demo.color : route.color,
      nameOrigin: route.nameOrigin || (presetTitle ? {preset:demo.id} : undefined),
      defaultName: typeof route.defaultName === "string" ? route.defaultName : oldDefault,
      status: route.status || (route.stops.length >= 2 ? "complete" : "draft") };
  });
  const ids = new Set(routes.map(r => r.id));
  const initialVisible = validRoutes && Array.isArray(restored.visibleIds)
    ? restored.visibleIds.filter(id => ids.has(id)) : routes.map(r => r.id);
  // Version one initially displayed just the eastern route. Expose the second demo once.
  if (migrating && ids.has("gion-walk") && initialVisible.includes("east-walk") && !initialVisible.includes("gion-walk")) initialVisible.push("gion-walk");
  const state = {
    places, routes, activeRouteId: ids.has(restored?.activeRouteId) ? restored.activeRouteId : routes[0]?.id ?? null,
    visibleIds: initialVisible, editingRouteId: null,
    pinnedIds: Array.isArray(restored?.pinnedIds) ? [...new Set(restored.pinnedIds.filter(id => byId.has(id)))].slice(0, 2) : [],
    view: "routes", selectedId: null, webBack: "place",
    appearance: window.atlasLayerPrefs.read(), basemap: map.getBasemapState(),
    streetView: "closed", streetViewMessage: "", capturingMap:false, captureMessage:""
  };
  const palette = ["#3272a1", "#84619d", "#b25156", "#417943", "#087e83", "#c36138"];
  const recentlyDeleted = [];
  let nameTarget = null, namedStop = null, pendingFocus = null, noticeTimer = 0, undoTimer = 0, expiryTimer = 0;
  const directNames = new Map(), visibleLabels = new Set();
  const mapTargets = new Set(), editorTargets = new Set();
  let nameWorkers = 0, observeFrame = 0;
  function placeForLabel(target) {
    const routeId = target.dataset.routeId || target.dataset.nameRouteId;
    if (!routeId) return byId.get(target.dataset.placeId || target.dataset.value);
    const route = state.routes.find(r => r.id === routeId);
    return route?.defaultName ? byId.get(route.stops[0]) : undefined;
  }
  function nextName() {
    for (const [p,retry] of directNames) {
      directNames.delete(p);
      if (catalog.needsLookup(p,retry)) return {p,retry};
    }
    for (const target of visibleLabels) {
      if (!target.isConnected) { visibleLabels.delete(target); continue; }
      const p = placeForLabel(target);
      if (!catalog.needsLookup(p)) continue;
      const r = target.getBoundingClientRect();
      const clip = editorTargets.has(target) ? body.getBoundingClientRect() : {left:0, top:0, right:innerWidth, bottom:innerHeight};
      if (r.width > 0 && r.height > 0 && r.right > clip.left && r.left < clip.right &&
          r.bottom > clip.top && r.top < clip.bottom) return {p};
    }
  }
  function runNames() {
    while (nameWorkers < 2) {
      const job = nextName();
      if (!job) return;
      nameWorkers++;
      catalog.resolveName(job.p,job.retry).finally(() => { nameWorkers--; runNames(); });
    }
  }
  function requestName(p,retry = false) {
    if (catalog.needsLookup(p,retry)) { directNames.set(p,retry); runNames(); }
  }
  function intersections(entries) {
    for (const {target,isIntersecting} of entries) {
      if (isIntersecting && (mapTargets.has(target) || editorTargets.has(target))) visibleLabels.add(target);
      else visibleLabels.delete(target);
    }
    runNames();
  }
  const visiblePins = new IntersectionObserver(intersections);
  const visibleStops = new IntersectionObserver(intersections, {root:body});
  function watchTargets(observer, tracked, elements) {
    const next = new Set(elements);
    for (const old of tracked) {
      if (!next.has(old)) { observer.unobserve(old); tracked.delete(old); visibleLabels.delete(old); }
    }
    for (const target of next) {
      if (!tracked.has(target)) { tracked.add(target); observer.observe(target); }
    }
  }
  function watchMapLabels() {
    const enabled = window.AINA_CONFIG?.googlePlaceNamesEnabled === true && map.getBasemapState() === "google";
    watchTargets(visiblePins, mapTargets, enabled ? document.querySelectorAll(".aina-map-place[data-place-id]:not([data-name-hidden]),.aina-map-route[data-route-id]") : []);
    runNames();
  }
  function watchPanelLabels() {
    let targets = [];
    if (sheet.getLevel() !== "closed") {
      if (state.view === "route") targets = body.querySelectorAll('.ap-stop-place[data-action="place"]');
      if (state.view === "routes") targets = body.querySelectorAll('.ap-view-routes [data-name-route-id]');
    }
    watchTargets(visibleStops, editorTargets, targets);
  }

  function fixedTitle(route, localize) {
    const origin = route.nameOrigin;
    if (!origin) return route.name;
    const preset = presets.get(origin.preset);
    const base = (localize ? preset?.name : preset?.zh) ?? origin.text ?? route.name;
    // A valid saved copy has at least one character of suffix per copy.
    const depth = Number.isSafeInteger(origin.copies) && origin.copies > 0 && origin.copies <= route.name.length ? origin.copies : 0;
    return base + (localize ? translatedCopySuffix : copySuffix).repeat(depth);
  }

  function save() {
    try {
      const { routes, activeRouteId, visibleIds, pinnedIds } = state;
      const savedPlaces = catalog.snapshot(routes, pinnedIds);
      // A generated title can contain a Google display name. Rebuild it on screen.
      const savedRoutes = routes.map(({minutes, km, zh, en, ...r}) => ({...r, name: r.defaultName || fixedTitle(r,false)}));
      localStorage.setItem(storeKey, JSON.stringify({ schemaVersion: 5, routes: savedRoutes, activeRouteId, visibleIds, pinnedIds, savedPlaces }));
    } catch { notify(t("当前浏览器无法保存，行程仍可在本页使用","Your browser could not save this trip. You can still use it in this tab.")); }
  }
  function notify(message) {
    const notice = $("notice");
    notice.textContent = message;
    notice.classList.add("visible");
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => notice.classList.remove("visible"), 2100);
  }
  function updateEstimate(r) {
    const meters = r.stops.length < 2 ? 0 : map.getRouteMeters(r);
    if (!Number.isFinite(meters)) { r.km = r.minutes = null; return; }
    r.km = Math.round(meters / 100) / 10;
    r.minutes = window.atlasGoogleWalking?.minutes(r) ?? (meters > 0 ? Math.max(1, Math.round(meters / 67)) : 0);
  }
  function render() {
    for (const r of state.routes) {
      if (!r.defaultName) { r.name = fixedTitle(r,true); continue; }
      const first = byId.get(r.stops[0]);
      const title = first?.dynamic ? first.label || first.providerName : first?.name;
      const template = r.defaultName.split(copySuffix);
      const numberedTitle = template[0].replace(/^步行路线 /, t("步行路线 ", "Walking Route "));
      r.name = (title ? title + t(" · 步行路线"," · Walking Route") : numberedTitle) + translatedCopySuffix.repeat(template.length - 1);
    }
    map.setState(state);
    windows.refresh(state);
    updateEditingChip();
    if (state.view === "name") renderName();
    else panels.render(body, state, act);
    watchPanelLabels();
    cancelAnimationFrame(observeFrame);
    observeFrame = requestAnimationFrame(watchMapLabels);
    window.atlasGoogleWalking?.sync(state);
  }
  function updateEditingChip() {
    const chip = $("editing-chip");
    const route = state.routes.find(r => r.id === state.editingRouteId);
    chip.hidden = !route || (state.view === "route" && sheet.getLevel() !== "closed");
    if (!route || chip.hidden) return;
    chip.style.setProperty("--route-color", route.color);
    chip.querySelector("strong").textContent = route.name;
    const n = route.stops.length;
    chip.querySelector("small").textContent = n + t(" 站", n === 1 ? " stop" : " stops");
  }
  function setView(view, level = "half") {
    if (state.view === "layers" && view !== "layers" && state.streetView === "loading") map.closeStreetView();
    if (state.view !== view) body.scrollTop = 0;
    state.view = view;
    render();
    sheet.setLevel(level);
    updateEditingChip();
  }

  // Loading another language restarts the Google SDK. Hand off the current
  // workspace only for that navigation, separate from the saved itinerary.
  const handoffKey = "aina.language-workspace";
  window.addEventListener("aina-language-changing", event => {
    const nextLang = event.detail?.lang;
    if (!["en","zh-CN"].includes(nextLang) || nextLang === lang) return;
    const {view,selectedId,editingRouteId,webBack} = state;
    const handoff = {nextLang, time:Date.now(), view, query:query.value, selectedId, editingRouteId, webBack,
      nameTarget, namedStop, nameDraft:body.querySelector('.name-form input')?.value,
      level:sheet.getLevel(), windows:windows.snapshot()};
    try { sessionStorage.setItem(handoffKey, JSON.stringify(handoff)); } catch { /* Optional per-tab state. */ }
  });
  function restoreWorkspace() {
    let handoff;
    try {
      handoff = JSON.parse(sessionStorage.getItem(handoffKey));
      sessionStorage.removeItem(handoffKey);
    } catch { return; }
    if (handoff?.nextLang !== lang || !Number.isFinite(handoff.time) || Date.now() - handoff.time > 120000) return;
    const openWindows = Array.isArray(handoff.windows) ? handoff.windows : [];
    // A Google place that was only open in a window need not be in the saved trip.
    for (const id of [handoff.selectedId, ...openWindows.map(w => w.id)]) {
      if (typeof id === "string" && id.startsWith("google:") && !byId.has(id)) catalog.register({placeId:id.slice(7)});
    }
    if (ids.has(handoff.editingRouteId)) state.activeRouteId = state.editingRouteId = handoff.editingRouteId;
    if (byId.has(handoff.selectedId)) state.selectedId = handoff.selectedId;
    nameTarget = ids.has(handoff.nameTarget) ? handoff.nameTarget : null;
    namedStop = byId.has(handoff.namedStop) ? handoff.namedStop : null;
    const allowed = {routes:true, layers:true, compare:true, place:state.selectedId,
      route:state.editingRouteId, name:nameTarget || namedStop, web:byId.get(state.selectedId)?.url};
    state.view = Object.hasOwn(allowed,handoff.view) && allowed[handoff.view] ? handoff.view : "routes";
    if (handoff.view === "web" && state.view !== "web" && state.selectedId) state.view = "place";
    state.webBack = handoff.webBack === "compare" ? "compare" : "place";
    if (typeof handoff.query === "string") query.value = handoff.query.slice(0,query.maxLength);
    sheet.setLevel(handoff.view === "search" ? "closed" : handoff.level);
    render();
    const field = body.querySelector('.name-form input');
    if (field && typeof handoff.nameDraft === "string") field.value = handoff.nameDraft;
    windows.restore(openWindows);
    if (state.editingRouteId) map.focusRoute?.(state.editingRouteId);
  }
  function openPlace(id, focus = false) {
    const place = byId.get(id);
    if (!place) return;
    pendingFocus = focus && !Number.isFinite(place.lat) ? id : null;
    state.selectedId = id;
    if (windows.isDesktop()) {
      map.setState(state);
      windows.open(id);
    } else setView("place");
    if (focus && Number.isFinite(place.lat)) map.focusPlace(place);
    if (place.detailLoaded) requestName(place, true);
  }
  function refreshPlaceRoutes(place) {
    map.setState(state);
    const affected = state.routes.filter(r => r.stops.includes(place.id));
    affected.forEach(updateEstimate);
    if (affected.length || state.pinnedIds.includes(place.id)) save();
  }
  function googlePlace(data, fromPlaces = false) {
    const place = catalog.register(data, {fromPlaces});
    if (!place) return;
    if (place.dynamic) refreshPlaceRoutes(place);
    openPlace(place.id, fromPlaces);
    scheduleExpiry();
  }
  function scheduleExpiry() {
    clearTimeout(expiryTimer);
    const expired = catalog.expire();
    if (expired.length) {
      map.setState(state);
      state.routes.filter(r => r.stops.some(id => expired.includes(id))).forEach(updateEstimate);
      save(); render();
    }
    let next = Infinity;
    for (const place of places) {
      if (place.locatedAt) next = Math.min(next, place.locatedAt + catalog.coordinateLifetime);
    }
    if (Number.isFinite(next)) expiryTimer = setTimeout(scheduleExpiry, Math.min(2147483647, Math.max(1, next - Date.now())));
  }
  function openRoute(id) {
    const route = state.routes.find(r => r.id === id);
    if (!route) return;
    state.activeRouteId = state.editingRouteId = id;
    showRoute(id);
    state.selectedId = null;
    save(); setView("route");
    map.focusRoute?.(route);
    const first = byId.get(route.stops[0]);
    if (first && !Number.isFinite(first.lat)) requestName(first);
  }
  function showRoute(id) {
    if (!state.visibleIds.includes(id)) state.visibleIds.push(id);
  }
  function updateUndoNotice() {
    clearTimeout(undoTimer);
    const last = recentlyDeleted.at(-1);
    const banner = $("delete-feedback");
    banner.hidden = !last;
    if (!last) return;
    $("deleted-name").textContent = t("已删除「" + last.route.name + "」", "Deleted “" + last.route.name + "”");
    undoTimer = setTimeout(() => {
      recentlyDeleted.length = 0;
      banner.hidden = true;
    }, 8000);
  }
  function deleteRoute(route) {
    const index = state.routes.indexOf(route);
    if (index < 0) return;
    recentlyDeleted.push({ route, index, visibleIndex: state.visibleIds.indexOf(route.id) });
    state.routes.splice(index, 1);
    state.visibleIds = state.visibleIds.filter(id => id !== route.id);
    if (state.activeRouteId === route.id) {
      state.activeRouteId = state.visibleIds[0] ?? state.routes[0]?.id ?? null;
    }
    if (state.editingRouteId === route.id) state.editingRouteId = null;
    if (nameTarget === route.id) nameTarget = null;
    if (state.view === "route" || state.view === "name") {
      state.view = "routes";
      body.scrollTop = 0;
    }
    save(); render(); updateUndoNotice();
  }
  function undoDelete() {
    const entry = recentlyDeleted.pop();
    if (!entry) return;
    state.routes.splice(entry.index, 0, entry.route);
    if (entry.visibleIndex >= 0) state.visibleIds.splice(entry.visibleIndex, 0, entry.route.id);
    state.activeRouteId ??= entry.route.id;
    save(); render(); updateUndoNotice();
  }
  function nextDraft(firstStop) {
    let n = 1;
    while (state.routes.some(r => (r.defaultName || r.name) === "步行路线 " + n || r.name === t("步行路线 ", "Walking Route ") + n)) n++;
    const defaultName = "步行路线 " + n;
    const route = { id: crypto.randomUUID(), name: defaultName, defaultName,
      color: palette[(state.routes.length - initialRoutes.length + palette.length) % palette.length],
      stops: firstStop ? [firstStop] : [], minutes: 0, km: 0, status: "draft" };
    state.routes.unshift(route);
    openRoute(route.id);
    return route;
  }
  function leaveEditor(complete) {
    const route = state.routes.find(r => r.id === state.editingRouteId);
    if (!route || (complete && route.stops.length < 2)) return;
    if (complete) route.status = "complete";
    state.editingRouteId = null;
    state.selectedId = null;
    save();
    sheet.setLevel("closed");
    render();
    if (complete && state.visibleIds.includes(route.id)) map.focusRoute?.(route);
    notify(complete ? t("路线已完成，可点地图上的路线继续编辑", "Route complete. Select it on the map to edit it again.")
      : t("已退出规划，进度已保存", "Your route has been saved."));
  }
  function renderName() {
    const route = state.routes.find(r => r.id === nameTarget);
    const place = byId.get(namedStop);
    if (body.querySelector(".name-form")?.dataset.target === (place?.id || route?.id)) return;
    body.innerHTML = '<form class="name-form"><h2></h2><label><span></span><input name="routeName" maxlength="45" autocomplete="off"></label><div><button type="button">' +
      t("取消","Cancel") + '</button><button type="submit">' + t("保存","Save") + '</button></div></form>';
    const form = body.firstElementChild;
    form.dataset.target = place?.id || route?.id || "";
    form.querySelector("h2").textContent = place ? t("为地点设置备注名","Set a place nickname") : t("重命名路线","Rename route");
    form.querySelector("label span").textContent = place ? t("地点备注名","Place nickname") : t("路线名称","Route name");
    const field = form.elements.routeName;
    field.required = !place;
    field.value = place ? place.label || "" : route?.defaultName ? "" : route?.name || "";
    field.placeholder = place?.name || route?.name || "";
    form.querySelector('[type="button"]').onclick = () => setView(route || place ? "route" : "routes");
    form.onsubmit = event => {
      event.preventDefault();
      const name = field.value.trim();
      if (place) catalog.label(place, name);
      else if (!name) { field.focus(); return; }
      else if (route) {
        route.name = name;
        delete route.defaultName;
        delete route.nameOrigin;
      }
      save(); setView("route"); notify(t("已保存名称","Name saved"));
    };
    if (matchMedia("(pointer:fine)").matches) requestAnimationFrame(() => field.focus());
  }
  function updateAppearance(prefs) {
    if (state.streetView === "loading") map.closeStreetView();
    state.appearance = prefs;
    state.streetViewMessage = "";
    map.setAppearance(prefs);
    if (!window.atlasLayerPrefs.save(prefs)) {
      notify(t("当前浏览器无法保存图层设置，本页仍可使用。","Layer settings will last for this page session."));
    }
    render();
  }
  async function toggleStreetView() {
    if (state.streetView !== "closed") { map.closeStreetView(); return; }
    state.streetViewMessage = "";
    const result = await map.openStreetView();
    if (state.view !== "layers" || result === "open" || result === "cancelled") return;
    const messages = {
      unavailable: t("地图中心附近没有街景。移动地图后再试。","No Street View imagery near the map center. Move the map and try again."),
      offline: t("连接 Google 地图后即可查看街景。","Connect Google Maps to use Street View."),
      error: t("街景暂时无法加载，请稍后重试。","Street View could not load. Please try again.")
    };
    state.streetViewMessage = messages[result] || messages.error;
    render();
  }
  async function captureViewport() {
    if (state.capturingMap || state.basemap !== "google" || state.appearance.type !== "roadmap" || state.streetView !== "closed") return;
    state.capturingMap = true; state.captureMessage = "";
    render();
    try {
      await window.atlasGoogleArt.downloadViewport(state.appearance.labels);
      state.captureMessage = t("Google 地图截图已发送到浏览器下载。", "The Google screenshot is ready in your browser downloads.");
    } catch (error) {
      state.captureMessage = error.message || t("未能截取地图，请重试。", "Map capture failed. Try again.");
    } finally {
      state.capturingMap = false;
      if (state.view === "layers") render();
    }
  }
  function act(type, value, extra) {
    const route = state.routes.find(r => r.id === value);
    switch (type) {
      case "googleSettings": window.atlasPlaceCard.settings(); break;
      case "layers":
        state.streetViewMessage = ""; state.captureMessage = "";
        setView("layers", sheet.getLevel() === "full" ? "full" : "half");
        break;
      case "mapType":
        if (window.atlasLayerPrefs.types.includes(value) && (value === "roadmap" || state.basemap === "google")) {
          if (state.streetView === "open") map.closeStreetView();
          state.captureMessage = ""; updateAppearance({...state.appearance, type:value});
        }
        break;
      case "mapLabel":
        if (Object.hasOwn(state.appearance.labels, value)) {
          const labels = state.appearance.labels;
          updateAppearance({...state.appearance, labels:{...labels, [value]:!labels[value]}});
        }
        break;
      case "streetView": void toggleStreetView(); break;
      case "captureViewport": void captureViewport(); break;
      case "place": openPlace(value, byId.get(value)?.dynamic); break;
      case "route": openRoute(value); break;
      case "artMap": if (route) window.atlasArtMap.open(route); break;
      case "routes": state.selectedId = null; setView("routes"); break;
      case "pin": {
        if (!byId.has(value)) break;
        if (state.pinnedIds.includes(value)) state.pinnedIds = state.pinnedIds.filter(id => id !== value);
        else if (state.pinnedIds.length < 2) state.pinnedIds.push(value);
        else { notify(t("已固定两个地点，请先移除其中一个","Two places are pinned. Unpin one to compare another.")); break; }
        save();
        if (state.pinnedIds.length === 2) {
          clearTimeout(noticeTimer); $("notice").classList.remove("visible");
          state.selectedId = null; setView("compare");
        }
        else {
          if (state.view === "compare" && !state.pinnedIds.length) setView("routes");
          else render();
          if (state.pinnedIds.includes(value)) notify(t("已固定 A，再点一个地点进行比较","Pinned as A. Pick a second place to compare."));
        }
        break;
      }
      case "compare": state.selectedId = null; setView("compare"); break;
      case "toggle":
        if (!route) break;
        state.visibleIds = state.visibleIds.includes(value) ? state.visibleIds.filter(id => id !== value) : [...state.visibleIds,value];
        save(); render();
        if (state.visibleIds.includes(value)) map.focusRoute?.(route);
        break;
      case "selectRoute":
        if (route) openRoute(value);
        break;
      case "deleteRoute": if (route) deleteRoute(route); break;
      case "duplicate": {
        if (!route) break;
        const id = crypto.randomUUID();
        const origin = route.nameOrigin || {text:route.name};
        const copy = { ...route, id, name: route.name + translatedCopySuffix, stops: [...route.stops], status: "draft",
          nameOrigin: route.defaultName ? undefined : {...origin, copies:(origin.copies || 0) + 1},
          defaultName: route.defaultName ? route.defaultName + copySuffix : undefined,
          color: palette[(state.routes.length - initialRoutes.length + palette.length) % palette.length] };
        state.routes.unshift(copy); showRoute(id); openRoute(id); notify(t("路线副本已保存","Route copy saved")); break;
      }
      case "newRoute": nextDraft(); break;
      case "rename": if (route) { namedStop = null; nameTarget = route.id; setView("name"); } break;
      case "labelStop": if (byId.get(value)?.dynamic) { nameTarget = null; namedStop = value; setView("name"); } break;
      case "retryWalking": if (route) window.atlasGoogleWalking?.retry(route, state); break;
      case "findStop": query.focus(); break;
      case "exitPlanning": leaveEditor(false); break;
      case "finishPlanning": leaveEditor(true); break;
      case "website":
        if (!byId.get(value)?.url) break;
        state.webBack = state.view === "compare" ? "compare" : "place";
        state.selectedId = value; setView("web"); break;
      case "back":
        if (state.view === "web") setView(state.webBack);
        else setView("routes");
        break;
      case "add": {
        if (!byId.has(value)) break;
        const editing = state.routes.find(r => r.id === state.editingRouteId);
        if (!editing) { nextDraft(value); notify(t("已新建路线，并设为第一站","New route started here")); break; }
        if (editing.stops.includes(value)) { notify(t("这个地点已经在当前路线中","This place is already on your route")); break; }
        editing.stops.push(value);
        editing.status = "draft";
        updateEstimate(editing); openRoute(editing.id); notify(t("已加入第 " + editing.stops.length + " 站","Added stop " + editing.stops.length)); break;
      }
      case "removeStop": case "moveUp": case "moveDown": {
        if (!route || route.id !== state.editingRouteId) break;
        const i = Number(extra);
        if (!Number.isInteger(i) || i < 0 || i >= route.stops.length) break;
        if (type === "removeStop") route.stops.splice(i, 1);
        else {
          const to = i + (type === "moveUp" ? -1 : 1);
          if (to < 0 || to >= route.stops.length) break;
          [route.stops[i],route.stops[to]] = [route.stops[to],route.stops[i]];
        }
        route.status = "draft"; updateEstimate(route); save(); render(); break;
      }
      case "close": sheet.setLevel("closed"); query.blur(); break;
      case "resetView": map.resetView(); break;
    }
  }

  windows.mount({ container: $("place-windows"), byId, actions: act });
  $("map-source").addEventListener("click", () => window.atlasPlaceCard.settings());
  let streetViewPanelLevel = "closed";
  window.addEventListener("atlas:streetview-state", event => {
    const previous = state.streetView;
    state.streetView = event.detail.state;
    $("atlas").toggleAttribute("data-street-view", state.streetView === "open");
    if (state.streetView === "open" && previous !== "open") {
      streetViewPanelLevel = sheet.getLevel();
      sheet.setLevel("closed");
    } else if (previous === "open" && state.streetView === "closed" && streetViewPanelLevel !== "closed") {
      const level = streetViewPanelLevel;
      streetViewPanelLevel = "closed";
      setView("layers", level);
      body.querySelector('[data-action="streetView"]')?.focus({preventScroll:true});
      return;
    }
    render();
  });
  window.addEventListener("atlas:basemap-state", event => {
    state.basemap = event.detail.state;
    state.streetViewMessage = "";
    const labels = {offline:t("离线底图","Offline map"),loading:t("正在连接 Google 地图","Connecting to Google Maps"),
      google:t("Google 底图","Google Maps"),error:t("离线底图 · 查看连接状态","Offline map · Check connection")};
    $("map-source").textContent = labels[event.detail.state] || t("京都步行地图","Kyoto walking map");
    catalog.refreshNames();
    map.setState(state);
    state.routes.forEach(updateEstimate);
    if (event.detail.state === "google") {
      const active = state.routes.find(r => r.id === state.activeRouteId && state.visibleIds.includes(r.id));
      // Restore the starting badge even when a previous location cache expired.
      const first = byId.get(active?.stops[0]);
      if (first && !Number.isFinite(first.lat)) requestName(first);
    }
    render();
  });
  window.addEventListener("aina-map-labels-changed", () => {
    cancelAnimationFrame(observeFrame);
    observeFrame = requestAnimationFrame(watchMapLabels);
  });
  window.addEventListener("aina-place-name-updated", event => {
    if (event.detail.locationChanged) {
      refreshPlaceRoutes(byId.get(event.detail.id));
      scheduleExpiry();
    }
    render();
  });
  window.addEventListener("aina-google-walking-updated", event => {
    map.setState(state);
    const changed = event.detail?.routeIds || state.visibleIds;
    state.routes.filter(r => changed.includes(r.id)).forEach(updateEstimate);
    render();
  });
  map.mount({ canvas: $("map"), places, routes: state.routes, onPlace: id => openPlace(id),
    onGooglePlace: data => googlePlace(data, false), onRoute: openRoute, onViewChange: () => {} });
  window.addEventListener("aina-google-configured", () => {
    map.setGoogleBasemap(window.atlasGoogle.isConfigured());
    render();
  });
  window.addEventListener("aina-google-detail-loaded", event => {
    const data = event.detail;
    const existing = byId.get("google:" + data.placeId);
    if (!existing) return;
    existing.detailLoaded = true;
    catalog.register(data, {fromWidget: true});
    if (data.website) existing.url = data.website;
    refreshPlaceRoutes(existing);
    if (pendingFocus === existing.id && state.selectedId === existing.id && Number.isFinite(existing.lat)) {
      map.focusPlace(existing);
      pendingFocus = null;
    }
    render();
    requestName(existing);
    scheduleExpiry();
  });
  map.setAppearance(state.appearance);
  map.setGoogleBasemap(window.atlasGoogle.isConfigured());
  if (map.getRouteMeters) state.routes.forEach(updateEstimate);
  sheet.mount({ sheet: $("sheet"), handle: $("sheet-handle"), body, onHeight: height => map.setBottom(height),
    onCloseWindows: () => {
      const count = windows.closeAll();
      if (count) notify(t("已关闭 " + count + " 个地点窗口","Closed " + count + (count === 1 ? " place window" : " place windows")));
    },
    onLevelChange: level => {
      if (level === "closed") {
        if (state.streetView === "loading") map.closeStreetView();
        if (state.streetView === "open") { updateEditingChip(); watchPanelLabels(); return; }
        state.view = "routes"; state.selectedId = null; render();
      } else { updateEditingChip(); watchPanelLabels(); }
    }
  });
  render();
  scheduleExpiry();
  restoreWorkspace();
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) { scheduleExpiry(); window.atlasGoogleWalking?.sync(state); }
  });
  if (staleCoordinates || recoveredPlaces || restored?.schemaVersion !== 5 || !validRoutes) save();
  $("undo-delete").addEventListener("click", undoDelete);
  $("editing-chip").addEventListener("click", () => openRoute(state.editingRouteId));
  window.atlasSearchBox.mount({input:query, onPlace:data => googlePlace(data, true),
    onSettings:() => window.atlasPlaceCard.settings()});
  document.addEventListener("keydown", event => {
    if (event.target === query || event.isComposing || document.querySelector("dialog[open]")) return;
    if (state.streetView === "open") return;
    const editing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
    if (event.key === "/" && !editing) { event.preventDefault(); query.focus(); }
    if (event.key === "Escape" && (editing || sheet.getLevel() !== "closed")) { event.preventDefault(); query.blur(); sheet.setLevel("closed"); }
    if (event.target === $("map")) {
      if (event.key === "ArrowUp" || event.key === "Enter") { event.preventDefault(); setView("routes"); }
    }
  });
})();
