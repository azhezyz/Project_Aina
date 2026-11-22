(() => {
  "use strict";

  const paths = {
    x: '<path d="m6 6 12 12M18 6 6 18"/>',
    next: '<path d="m9 5 7 7-7 7"/>',
    back: '<path d="m14 5-7 7 7 7"/>',
    up: '<path d="m6 14 6-6 6 6"/>',
    down: '<path d="m6 10 6 6 6-6"/>',
    pin: '<path d="M16.5 3.5 20.5 7.5l-3 1-3.1 4.9.7 2.5-1.2 1.2-7-7 1.2-1.2 2.5.7 4.9-3.1zM10 14l-6.5 6.5"/>',
    point: '<path d="M19.1 10c0 5.3-7.1 11-7.1 11S4.9 15.3 4.9 10a7.1 7.1 0 1 1 14.2 0Z"/><circle cx="12" cy="10" r="2.3"/>',
    globe: '<circle cx="12" cy="12" r="8.6"/><path d="M3.5 12h17M12 3.5c4 3.7 4 13.3 0 17-4-3.7-4-13.3 0-17Z"/>',
    ext: '<path d="M13 5h6v6m0-6L10 14M10 6H5v13h13v-5"/>',
    walk: '<circle cx="13.5" cy="4.1" r="1.5"/><path d="m8.2 20.2 3.9-6.7 3.4 3.1 1.4 3.6m-5.7-8 1.7-4.7 2.9 3.2 3.2.8M7 13l1.8-4 4.1-1.5"/>',
    route: '<circle cx="6" cy="6" r="2.4"/><circle cx="18" cy="18" r="2.4"/><path d="M8.4 6H15a3.2 3.2 0 1 1 0 6H9a3.1 3.1 0 1 0 0 6h6.5"/>',
    compare: '<rect x="3" y="5" width="7" height="14" rx="1.8"/><rect x="14" y="5" width="7" height="14" rx="1.8"/>',
    eye: '<path d="M2.2 12s3.5-6.3 9.8-6.3 9.8 6.3 9.8 6.3-3.5 6.3-9.8 6.3-9.8-6.3-9.8-6.3Z"/><circle cx="12" cy="12" r="2.7"/>',
    eyeoff: '<path d="m3 3 18 18M9.2 6.1a9.5 9.5 0 0 1 2.8-.4c6.3 0 9.8 6.3 9.8 6.3a18.5 18.5 0 0 1-3.3 3.7m-3.7 2.2a9.9 9.9 0 0 1-2.8.4c-6.3 0-9.8-6.3-9.8-6.3a17.5 17.5 0 0 1 3.4-3.8"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    copy: '<rect x="8" y="8" width="11" height="12" rx="2"/><path d="M15 5V4H4v12h2"/>',
    minus: '<path d="M6 12h12"/>',
    check: '<path d="m4.5 12.5 5 5 10-11"/>',
    edit: '<path d="m14.8 5.2 4 4M4 20l4.5-.9L20 7.6l-4-4L4.9 15.1z"/>',
    trash: '<path d="M4 6.5h16m-11.5 0V4h7v2.5m-10 0 .9 12.7A1.9 1.9 0 0 0 8.3 21h7.4a1.9 1.9 0 0 0 1.9-1.8l.9-12.7M10 10v7m4-7v7"/>',
    search: '<circle cx="10.4" cy="10.4" r="6.6"/><path d="m15.3 15.3 5 5"/>',
    temple: '<path d="M3 9c3.4-.1 6.2-2.3 9-5 2.8 2.7 5.6 4.9 9 5M5 11h14M6 18h12M4 20h16M7 11v7m5-7v7m5-7v7"/>',
    cafe: '<path d="M4 8h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zm12 1h1.5a2.8 2.8 0 1 1 0 5.6H16M3 21h16M7 3.4v2M11 3.4v2"/>',
    park: '<path d="m11 3-5 6h2l-4 5h5v3h4v-3h5l-4-5h2zM3 20h17"/>',
    food: '<path d="M5 3v6a3 3 0 0 0 6 0V3M8 3v18M18 3c-2.4 1.5-3.7 5.6-3.5 9H18m0-9v18"/>',
    market: '<path d="M3.5 10 6 4h12l2.5 6M4 10h16M5 10v10h14V10M9 20v-6h5v6"/>',
    museum: '<path d="m3 8 9-5 9 5zM5 20h14M7 10.5v6.8m5-6.8v6.8m5-6.8v6.8"/>',
    map: '<path d="m3 5 6-2 6 2 6-2v15l-6 3-6-3-6 3zM9 3v15m6-13v16"/>'
  };
  const icon = name => '<svg class="ap-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (paths[name] || paths.point) + '</svg>';
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const list = value => value instanceof Map || value instanceof Set ? Array.from(value.values()) : Object.values(value || {});
  const idEquals = (a, b) => String(a) === String(b);
  const lookup = (items, id) => items.find(item => idEquals(item.id, id));
  const includesId = (ids, id) => list(ids).some(entry => idEquals(entry, id));
  const pinLabel = index => index < 26 ? String.fromCharCode(65 + index) : String(index + 1);
  const getColor = color => /^#[a-f0-9]{3,8}$/i.test(color || "") ? color : "#087e83";
  const validUrl = value => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" ? url : null;
    } catch { return null; }
  };
  const primaryText = p => p?.name || p?.short || "未命名地点";
  const categoryText = p => [p?.kind, p?.area].filter(Boolean).join(" · ");
  const placeSymbol = p => {
    const value = [p?.icon, p?.kind, p?.name].join(" ");
    if (/cafe|coffee|茶屋|茶房|茶寮|咖啡/i.test(value)) return "cafe";
    if (/food|restaurant|ramen|餐|料理|面馆/i.test(value)) return "food";
    if (/temple|shrine|佛|寺|神社/i.test(value)) return "temple";
    if (/garden|park|樱|公园|庭园|庭園/i.test(value)) return "park";
    if (/shop|market|shopping|商店|市场|市集/i.test(value)) return "market";
    if (/museum|博物|美术/i.test(value)) return "museum";
    return "point";
  };
  function attrs(action, value, extra) {
    return ' data-action="' + esc(action) + '"' + (value == null ? "" : ' data-value="' + esc(value) + '"') + (extra == null ? "" : ' data-extra="' + esc(extra) + '"');
  }
  function button(action, value, label, symbol, variant = "", extra = null, options = {}) {
    const name = esc(label);
    const iconOnly = variant.split(" ").includes("ap-icon-btn");
    return '<button type="button" class="ap-btn ' + variant + '"' + attrs(action, value, extra) +
      (iconOnly ? ' aria-label="' + name + '" title="' + name + '"' : '') +
      (options.pressed === undefined ? "" : ' aria-pressed="' + options.pressed + '"') +
      (options.disabled ? " disabled" : "") + ">" + (symbol ? icon(symbol) : "") + (iconOnly ? "" : "<span>" + name + "</span>") + "</button>";
  }
  function header(title, options = {}) {
    const back = options.back ? button(options.back, options.value, "返回", "back", "ap-icon-btn ap-soft") : "";
    return '<header class="ap-header">' + back + '<div class="ap-heading"><h2>' + esc(title) + '</h2>' +
      (options.subtitle ? '<p>' + esc(options.subtitle) + '</p>' : '') + '</div>' +
      (options.count != null ? '<small class="ap-count">' + esc(options.count) + '</small>' : '') +
      '<span class="ap-spacer"></span>' + (options.tools || "") + button("close", null, "收起卡片", "x", "ap-icon-btn ap-soft") + "</header>";
  }
  function metrics(route) {
    const entries = [];
    if (route.stops.length > 1) {
      const hasTime = route.minutes != null && Number.isFinite(Number(route.minutes));
      const hasDistance = route.km != null && Number.isFinite(Number(route.km));
      if (hasTime) entries.push(esc(route.minutes) + " 分钟");
      if (hasDistance) entries.push(esc(route.km) + " km");
      if (!hasTime && !hasDistance) entries.push("步行里程与时间暂无估算");
      else if (!hasTime) entries.push("步行时间暂无估算");
      else if (!hasDistance) entries.push("步行里程暂无估算");
    }
    entries.push(esc(route.stops.length) + " 站");
    return entries.join('<i>·</i>');
  }
  function routeRow(route, s) {
    const visible = includesId(s.visibleIds, route.id);
    const editing = route.id === s.editingRouteId;
    const status = route.status === "draft" ? "草稿" : "已完成";
    return '<div class="ap-route-row" style="--ap-route:' + getColor(route.color) + '"><button type="button" class="ap-route-target"' + attrs("selectRoute", route.id) +
      '><span class="ap-route-symbol">' + icon("route") + '</span><span class="ap-row-content"><strong' +
      (route.defaultName ? ' data-name-route-id="' + esc(route.id) + '"' : '') + '>' + esc(route.name) +
      '</strong><small class="ap-metrics">' + (editing ? "编辑中" : status) + '<i>·</i>' + metrics(route) + '</small></span></button>' +
      button("toggle", route.id, visible ? "隐藏这条路线" : "在地图上显示这条路线", visible ? "eye" : "eyeoff", "ap-icon-btn " + (visible ? "ap-ink" : "ap-muted"), null, { pressed: visible }) +
      (s.view === "search" ? "" : button("deleteRoute", route.id, "删除路线「" + route.name + "」", "trash", "ap-icon-btn ap-danger")) + '</div>';
  }
  function planningStrip(s) {
    const editing = lookup(s.routes, s.editingRouteId);
    if (!editing) return "";
    return '<div class="ap-planning-strip">' + icon("edit") + '<span>正在规划<strong>' + esc(editing.name) + '</strong></span>' +
      '<div>' + button("route", editing.id, "继续编辑", null, "ap-link ap-small") +
      button("exitPlanning", null, "退出规划", null, "ap-outline ap-small") + '</div></div>';
  }
  function routesView(s) {
    const cafes = s.places.filter(p => placeSymbol(p) === "cafe").slice(0,2);
    const nearby = cafes.map(p => '<button type="button" class="ap-nearby"'+attrs("place",p.id)+'><span class="ap-place-symbol">'+icon("cafe")+
      '</span><span class="ap-row-content"><strong>'+esc(primaryText(p))+'</strong><small>'+esc(categoryText(p))+'</small></span>'+icon("next")+'</button>').join("");
    const title = header("我的路线", { count: s.routes.length, tools: button("newRoute",null,"开始规划","plus","ap-primary") });
    const settings = '<footer class="ap-data-settings">' + (s.routes.length ? '<small>步行时间和距离为估算值。</small>' : "") +
      button("googleSettings", null, "连接 Google 地图", "globe", "ap-small ap-link") + '</footer>';
    if (!s.routes.length) return title + '<p class="ap-empty">还没有保存的路线。</p>' + settings;
    return title + planningStrip(s) + '<div class="ap-route-list">' +
      s.routes.map(route => routeRow(route, s)).join("") + '</div>' +
      (nearby ? '<div class="ap-section-heading"><h3>沿途地点</h3>' + (list(s.pinnedIds).length ? button("compare",null,"地点比较","compare","ap-link ap-small") : "") +
        '</div><div class="ap-nearby-list">'+nearby+'</div>' : "") + settings;
  }
  function cardActions(p, s, dispatch, onWebsite) {
    const editing = s.routes?.find(route => route.id === s.editingRouteId);
    const routeDisabled = Boolean(editing?.stops.includes(p.id));
    return {
      routeLabel: routeDisabled ? "已在当前路线" : editing ? "加入当前路线" : "从这里规划",
      routeDisabled,
      onRoute: () => dispatch("add", p.id),
      onWebsite: validUrl(p.url) ? onWebsite : undefined
    };
  }
  function placeTools(p, s) {
    const pi = list(s.pinnedIds).findIndex(id => idEquals(id, p.id));
    const pinned = pi >= 0;
    return button("pin", p.id, pinned ? "已固定 " + pinLabel(pi) : "固定比较", "pin", "ap-small " + (pinned ? "ap-tinted" : "ap-link"), null, {pressed:pinned}) +
      (list(s.pinnedIds).length ? button("compare", null, "地点比较", "compare", "ap-small ap-link") : "");
  }
  function placeView(s) {
    const p = lookup(s.places, s.selectedId);
    if (!p) return searchView(s);
    return '<div class="ap-place-bar"><div class="ap-place-tools">' + placeTools(p, s) + '</div>' +
      button("close", null, "收起卡片", "x", "ap-icon-btn ap-soft") + '</div><div data-place-info="' + esc(p.id) + '"></div>';
  }
  function compareCard(p, i) {
    return '<article class="ap-place-card" data-compare-id="' + esc(p.id) + '"><div class="ap-card-top"><span class="ap-pin-letter">' + pinLabel(i) + '</span>' +
      button("place", p.id, "展开" + primaryText(p) + "详情", "next", "ap-icon-btn ap-link") +
      button("pin", p.id, "取消固定" + primaryText(p), "x", "ap-icon-btn ap-muted") + '</div>' +
      '<div data-place-info="' + esc(p.id) + '" data-compact></div></article>';
  }
  const choosePlace = '<button type="button" class="ap-choose"' + attrs("close") + '>' + icon("plus") + '<strong>从地图选择地点</strong><span>打开地点后点「固定比较」</span></button>';
  function compareView(s) {
    const pins = list(s.pinnedIds).map(id => lookup(s.places, id)).filter(Boolean);
    return header("地点比较", {count: pins.length}) + '<div class="ap-compare">' + pins.map((p,i) => compareCard(p, i)).join("") +
      (pins.length < 2 ? choosePlace : "") + '</div>';
  }
  function walkingStatus(route) {
    const summary = window.atlasGoogleWalking?.summary(route);
    if (!summary) return "";
    const notes = {loading:"正在获取 Google 步行路线…", unavailable:"Google 未找到部分站点之间的步行路线。",
      error:"暂时无法获取 Google 步行路线。"};
    const retry = summary.status === "error" || summary.status === "unavailable";
    const note = notes[summary.status];
    return (note ? '<div class="ap-edit-hint" role="status">' + esc(note) +
      (retry ? button("retryWalking", route.id, "重试步行路线", null, "ap-small ap-link") : "") + '</div>' : "") +
      (summary.usesGoogle ? (summary.warnings || []).map(warning => '<p class="ap-footnote">' + esc(warning) + '</p>').join("") : "");
  }
  function routeView(s) {
    const r = lookup(s.routes, s.editingRouteId || s.activeRouteId);
    if (!r) return routesView(s);
    const visible = includesId(s.visibleIds, r.id);
    const stops = r.stops.map((id, i) => {
      const p = lookup(s.places, id);
      return '<li class="ap-stop"><span class="ap-stop-no">' + (i+1) + '</span><button class="ap-stop-place" type="button"' + attrs("place", id) + '>' + esc(primaryText(p)) + '</button><div class="ap-stop-tools">' +
        (p?.dynamic ? p.label || p.providerName ? button("labelStop", p.id, "修改「" + primaryText(p) + "」的备注名", "edit", "ap-icon-btn") :
          button("labelStop", p.id, "为此站命名", "edit", "ap-small ap-link") : "") +
        button("moveUp", r.id, "上移" + primaryText(p), "up", "ap-icon-btn", i, { disabled: i===0 }) +
        button("moveDown", r.id, "下移" + primaryText(p), "down", "ap-icon-btn", i, { disabled: i===r.stops.length-1 }) +
        button("removeStop", r.id, "从路线移除" + primaryText(p), "minus", "ap-icon-btn", i) + '</div></li>';
    }).join("");
    const enoughStops = r.stops.length >= 2;
    const status = r.status === "draft" ? "草稿" : "已完成";
    const actions = '<div class="ap-actions ap-editor-actions">' +
      button("findStop", null, "搜索加站", "search", "ap-tinted") +
      button("exitPlanning", null, "退出规划", null, "ap-outline") +
      button("finishPlanning", null, "完成路线", "check", "ap-primary", null, {disabled: !enoughStops}) + '</div>';
    return header(r.name, {back:"routes", subtitle:status + " · 步行路线", tools:button("deleteRoute", r.id, "删除路线", "trash", "ap-small ap-danger")}) +
      '<div class="ap-route-detail" style="--ap-route:' + getColor(r.color) + '">' + actions +
      (!enoughStops ? '<p class="ap-edit-hint">' + (r.stops.length ? "起点已加入，再加一站即可查看步行路线。" : "点地图上的地点或搜索加站，选择路线起点。") + '</p>' : '') +
      '<div class="ap-stop-heading"><strong>路线站点</strong><span class="ap-detail-metrics ap-metrics">' + icon("walk") + metrics(r) + '</span></div>' +
      '<ol class="ap-stops">' + stops + '</ol>' + walkingStatus(r) + '<div class="ap-actions ap-route-options">' +
      button("toggle", r.id, visible ? "地图上已显示" : "在地图上显示", visible ? "eye" : "eyeoff", "ap-small ap-link", null, {pressed: visible}) +
      button("rename", r.id, "重命名", "edit", "ap-small ap-link") + button("duplicate", r.id, "复制", "copy", "ap-small ap-link") + '</div></div>';
  }
  function webView(s) {
    const p = lookup(s.places, s.selectedId), url = validUrl(p?.url);
    if (!p || !url) return placeView(s);
    return header(primaryText(p) + "官网", {back:"back"}) +
      '<div class="ap-browser-bar"><span>' + icon("globe") + esc(url.hostname.replace(/^www\./,"")) + '</span><a class="ap-btn ap-small ap-outline" href="' + esc(url.href) +
      '" target="_blank" rel="noopener noreferrer">' + icon("ext") + '新标签打开</a></div>' +
      '<iframe class="ap-frame" title="' + esc(primaryText(p) + "官方网站") + '" src="' + esc(url.href) + '" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" referrerpolicy="strict-origin-when-cross-origin"></iframe>' +
      '<p class="ap-footnote">若官网限制嵌入，可在新标签中查看。</p>';
  }
  const normalized = value => String(value ?? "").normalize("NFKC").toLowerCase().replace(/[\s·・_-]+/g, "");
  function searchPlaces(places, s) {
    const editing = lookup(s.routes, s.editingRouteId);
    return '<div class="ap-results">' + places.map(p => {
      const added = editing?.stops.includes(p.id);
      const add = editing ? button("add", p.id, primaryText(p) + (added ? "已在当前路线" : "，加入当前路线"),
        added ? "check" : "plus", "ap-icon-btn ap-tinted", null, {disabled:added}) : "";
      return '<div class="ap-result-row"><button type="button" class="ap-result"' + attrs("searchResult",p.id) +
        '><span class="ap-place-symbol">' + icon(placeSymbol(p)) + '</span><span class="ap-row-content"><strong>' + esc(primaryText(p)) +
        '</strong><small>' + esc(categoryText(p)) + '</small></span>' + (!editing ? icon("next") : "") + '</button>' + add + '</div>';
    }).join("") + '</div>';
  }
  function localSearchResults(s) {
    const q = normalized(s.query);
    const matches = !q ? [] : s.places.filter(p => [p.name,p.short,p.local,p.en,p.area,p.kind].some(field => normalized(field).includes(q)));
    const routes = !q ? [] : s.routes.filter(r => normalized(r.name).includes(q));
    if (!matches.length && !routes.length) return '<p class="ap-empty">本地地点和路线中没有匹配项。</p>';
    return '<div class="ap-section-heading"><h3>本地地点和路线</h3></div>' +
      (routes.length ? '<div class="ap-route-list">'+routes.map(r => routeRow(r,s)).join("")+'</div>' : "") + searchPlaces(matches,s);
  }
  function searchView(s) {
    const query = (s.query || "").trim();
    if (!query) return header(s.editingRouteId ? "选择下一站" : "搜索地点或路线") + planningStrip(s) + '<div class="ap-shortcuts">' +
      button("newRoute", null, "开始规划", "plus", "ap-primary") + button("routes", null, "我的路线", "route", "ap-outline") +
      button("compare", null, "地点比较", "compare", "ap-outline") + '</div>' +
      (s.editingRouteId ? '<div class="ap-section-heading"><h3>地图上的地点</h3><span>点 ＋ 加到路线末尾</span></div>' + searchPlaces(s.places,s) : "");
    const online = window.atlasGoogle.isConfigured();
    return header(s.editingRouteId ? "选择下一站" : "搜索地点或路线") +
      '<div class="ap-google-search" data-google-query="' + esc(query) + '" data-connected="' + online + '">' +
      (online ? button("searchGoogle", null, "搜索 Google 地点", "search", "ap-tinted") :
        button("googleSettings", null, "连接 Google 地图以搜索更多地点", "globe", "ap-outline")) +
      '<p class="ap-search-status" data-search-status role="status" tabindex="-1"></p><div data-search-results></div></div>' +
      '<div data-local-results>' + localSearchResults(s) + '</div>';
  }
  function searchGoogle(body) {
    const trigger = body.querySelector('[data-action="searchGoogle"]');
    if (!trigger) return false;
    if (!trigger.hidden) trigger.click();
    return true;
  }
  const views = {routes: routesView, place: placeView, route: routeView, compare: compareView, web: webView, search: searchView};
  const webKeys = new WeakMap();
  function updateComparison(body,s) {
    const grid = body.querySelector(".ap-compare");
    const pins = list(s.pinnedIds).map(id => lookup(s.places,id)).filter(Boolean);
    const retained = new Map([...grid.querySelectorAll("[data-compare-id]")].map(card => [card.dataset.compareId,card]));
    for (const [id,card] of retained) if (!pins.some(p => idEquals(p.id,id))) card.remove();
    const placeholder = grid.querySelector(".ap-choose");
    if (placeholder) placeholder.remove();
    pins.forEach((p,i) => {
      const card = retained.get(String(p.id));
      if (!card) { grid.insertAdjacentHTML("beforeend",compareCard(p,i)); return; }
      card.querySelector(".ap-pin-letter").textContent = pinLabel(i);
    });
    if (pins.length < 2) grid.insertAdjacentHTML("beforeend",choosePlace);
    body.querySelector(".ap-count").textContent = String(pins.length);
  }
  function render(body, state, actions) {
    if (!body) return;
    const s = {...state, places:list(state.places), routes:list(state.routes)};
    const routesScroll = s.view === "routes" && body.querySelector(".ap-view-routes") ? body.scrollTop : null;
    const page = views[s.view] || routesView;
    const sameWeb = s.view === "web" ? String(s.selectedId) + "|" + (lookup(s.places, s.selectedId)?.url || "") : null;
    const placeHost = body.querySelector(".ap-view-place > [data-place-info]");
    const search = body.querySelector(".ap-view-search [data-google-query]");
    if (s.view === "search" && search && search.dataset.googleQuery === s.query.trim() &&
        search.dataset.connected === String(window.atlasGoogle.isConfigured())) {
      // Leave an active widget connected so unrelated renders never repeat a Google search.
      body.querySelector("[data-local-results]").innerHTML = localSearchResults(s);
    } else if (s.view === "place" && placeHost && idEquals(placeHost.dataset.placeInfo,s.selectedId)) {
      body.querySelector(".ap-place-tools").innerHTML = placeTools(lookup(s.places,s.selectedId),s);
    } else if (s.view === "compare" && body.querySelector(".ap-view-compare")) {
      updateComparison(body,s);
    } else if (sameWeb === null || sameWeb !== webKeys.get(body) || !body.querySelector(".ap-frame")) {
      body.innerHTML = '<section class="atlas-panels ap-view-' + esc(s.view) + '">' + page(s) + '</section>';
    }
    for (const host of body.querySelectorAll("[data-place-info]")) {
      const p = lookup(s.places,host.dataset.placeInfo);
      window.atlasPlaceCard.fill(host,p,{
        compact: host.hasAttribute("data-compact"),
        actions: cardActions(p, s, actions, () => actions("website", p.id))
      });
    }
    webKeys.set(body, sameWeb);
    if (routesScroll !== null) body.scrollTop = routesScroll;
    body.onclick = event => {
      const trigger = event.target.closest?.("button[data-action]");
      if (!trigger || !body.contains(trigger) || trigger.disabled) return;
      const { action, value, extra } = trigger.dataset;
      if (action === "searchGoogle") {
        window.atlasPlaceSearch.run(trigger.closest("[data-google-query]"), place => actions("googleSearchResult", place));
      } else actions(action, value, extra == null ? undefined : Number(extra));
    };
  }
  window.atlasPanels = {render, cardActions, searchGoogle};
})();
