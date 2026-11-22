(() => {
  "use strict";

  const desktop = matchMedia("(min-width: 760px)");
  const drawings = {
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    shrink: '<path d="M5 12h14"/>',
    expand: '<path d="M5 12h14m-7-7v14"/>',
    pin: '<path d="m14 4 6 6-2.6.8-3.6 4.9.4 2.2-1 1-8-8 1-1 2.2.4 4.9-3.6zM9 15l-5 5"/>',
    external: '<path d="M13 5h6v6m0-6-9 9m-1-9H5v14h14v-4"/>',
    back: '<path d="m14 5-7 7 7 7"/>'
  };
  const panels = new Map();
  let layer, placeById, dispatch, events, sizeObserver, state = {}, front = 0;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function icon(key) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = drawings[key];
    return svg;
  }

  function button(label, symbol, className, handler, iconOnly = false) {
    const node = element("button", className);
    node.type = "button";
    node.append(icon(symbol));
    if (iconOnly) {
      node.title = label;
      node.setAttribute("aria-label", label);
    } else node.append(element("span", "", label));
    node.addEventListener("click", handler);
    return node;
  }

  function raise(record, focus = false) {
    if (!record.node.hasAttribute("data-front")) {
      for (const panel of panels.values()) panel.node.removeAttribute("data-front");
      record.node.setAttribute("data-front", "");
      record.node.style.zIndex = ++front;
    }
    if (focus) record.bar.focus({preventScroll: true});
  }

  function placeAt(record, x, y) {
    if (!desktop.matches) return;
    const width = record.node.offsetWidth, height = record.node.offsetHeight;
    const right = layer.clientWidth - width - 8;
    const bottom = layer.clientHeight - height - 8;
    record.x = Math.max(8, Math.min(right, Math.round(x)));
    record.y = Math.max(8, Math.min(bottom, Math.round(y)));
    record.node.style.transform = "translate(" + record.x + "px," + record.y + "px)";
  }

  function layoutNew(record) {
    // Try the left and right map margins before cascading. A user may already
    // have dragged a previous window away and freed one of these slots.
    const inset = layer.clientWidth >= 1000 ? 24 : 12;
    const top = 92, w = record.node.offsetWidth, h = record.node.offsetHeight;
    const others = [...panels.values()].filter(p => p !== record);
    const positions = [];
    const rows = [top, ...others.map(p => p.y + p.node.offsetHeight + 13)].sort((a,b) => a-b);
    for (const y of rows) {
      for (const x of [inset, layer.clientWidth - w - inset]) {
        if (y + h <= layer.clientHeight - 44) positions.push([x, y]);
      }
    }
    const free = positions.find(([x, y]) => others.every(p =>
      x+w+7 <= p.x || x >= p.x+p.node.offsetWidth+7 || y+h+7 <= p.y || y >= p.y+p.node.offsetHeight+7));
    const n = others.length;
    const offset = Math.floor(n/2) % 6 * 23;
    const fallbackX = n%2 ? layer.clientWidth - w - inset - offset : inset + offset;
    placeAt(record, free?.[0] ?? fallbackX, free?.[1] ?? top + offset);
  }

  function moveWithHeader(record) {
    const {bar} = record;
    let drag;
    bar.addEventListener("pointerdown", e => {
      if (!e.isPrimary || e.button !== 0 || e.target.closest("button, a")) return;
      drag = {id: e.pointerId, x: e.clientX, y: e.clientY, left: record.x, top: record.y};
      bar.setPointerCapture(e.pointerId);
      record.node.setAttribute("data-moving", "");
      e.preventDefault();
    });
    bar.addEventListener("pointermove", e => {
      if (!drag || e.pointerId !== drag.id) return;
      placeAt(record, drag.left + e.clientX - drag.x, drag.top + e.clientY - drag.y);
    });
    function finish(e) {
      if (!drag || drag.id !== e.pointerId) return;
      drag = null;
      record.node.removeAttribute("data-moving");
    }
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) bar.addEventListener(type, finish);
    bar.addEventListener("keydown", e => {
      if (e.target !== bar) return;
      const step = e.shiftKey ? 32 : 10;
      const delta = {ArrowLeft:[-step,0], ArrowRight:[step,0], ArrowUp:[0,-step], ArrowDown:[0,step]}[e.key];
      if (!delta) return;
      e.preventDefault();
      placeAt(record, record.x + delta[0], record.y + delta[1]);
    });
  }

  function collapse(record, collapsed) {
    record.collapsed = collapsed;
    record.body.hidden = collapsed;
    record.node.classList.toggle("aw-folded", collapsed);
    const label = collapsed ? "展开窗口" : "折叠窗口";
    record.min.title = label;
    record.min.setAttribute("aria-label", label);
    record.min.setAttribute("aria-expanded", String(!collapsed));
    record.min.replaceChildren(icon(collapsed ? "expand" : "shrink"));
    placeAt(record, record.x, record.y);
  }

  function close(record) {
    const restoreFocus = record.node.contains(document.activeElement);
    const wasFront = record.node.hasAttribute("data-front");
    sizeObserver.unobserve(record.node);
    record.node.remove();
    panels.delete(record.p.id);
    if (wasFront && panels.size) {
      const next = [...panels.values()].sort((a,b) => +b.node.style.zIndex - +a.node.style.zIndex)[0];
      raise(next, restoreFocus);
    } else if (restoreFocus) document.getElementById("map")?.focus({preventScroll:true});
  }

  function closeAll() {
    const count = panels.size;
    if (!count) return 0;
    const restoreFocus = layer.contains(document.activeElement);
    sizeObserver.disconnect();
    for (const record of panels.values()) record.node.remove();
    panels.clear();
    front = 0;
    if (restoreFocus) document.getElementById("map")?.focus({preventScroll:true});
    return count;
  }

  function sync(record) {
    const {p, placeInfo} = record;
    const inRoute = route => route?.stops.includes(p.id);
    const route = state.routes?.find(r => r.id === state.editingRouteId && inRoute(r)) ||
      state.routes?.find(r => state.visibleIds?.includes(r.id) && inRoute(r));
    const title = window.atlasPlaceCard.titleFor(p);
    const caption = route ? "第 " + (route.stops.indexOf(p.id) + 1) + " 站 · " + route.name : p.area || "";
    record.context.textContent = caption;
    record.context.hidden = !caption;
    record.node.toggleAttribute("data-named", Boolean(title));
    record.node.style.setProperty("--aw-route-color", route?.color || "#52685c");
    record.title.textContent = title || "地点资料";
    record.title.title = title;
    if (record.node.getAttribute("aria-label") !== p.name) {
      record.node.setAttribute("aria-label", p.name);
      record.bar.setAttribute("aria-label", p.name + "，可拖动窗口或使用方向键移动");
      record.closeButton.setAttribute("aria-label", "关闭" + p.name);
      record.closeButton.title = "关闭" + p.name;
    }
    window.atlasPlaceCard.fill(placeInfo, p, {
      actions: window.atlasPanels.cardActions(p, state, dispatch, () => showWeb(record))
    });
    const pins = state.pinnedIds || [];
    const pinned = pins.includes(p.id);
    const pinLabel = pinned ? "取消固定比较" : "固定到比较卡片";
    record.pin.title = pinLabel;
    record.pin.setAttribute("aria-label", pinLabel);
    record.pin.setAttribute("aria-pressed", String(pinned));
  }

  function showDetails(record) {
    if (!record.web) return;
    record.web.remove();
    record.web = null;
    record.info.hidden = false;
    record.node.classList.remove("aw-reading");
    placeAt(record, record.x, record.y);
  }

  function showWeb(record) {
    if (record.web) return;
    const panel = element("div", "aw-web");
    const tools = element("div", "aw-web-tools");
    const back = button("返回地点", "back", "aw-small-btn", () => {
      showDetails(record);
      record.bar.focus({preventScroll:true});
    });
    const link = element("a", "aw-small-btn");
    link.href = record.p.url; link.target = "_blank"; link.rel = "noopener noreferrer";
    link.append(icon("external"), element("span", "", "新标签页打开"));
    tools.append(back, link);
    const frame = element("iframe", "aw-frame");
    frame.setAttribute("sandbox", "allow-scripts allow-forms allow-same-origin allow-popups");
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    frame.title = record.p.name + "官网";
    frame.src = record.p.url;
    panel.append(tools, frame);
    record.web = panel;
    record.node.classList.add("aw-reading");
    record.info.hidden = true;
    record.body.append(panel);
    placeAt(record, record.x, record.y);
    back.focus({preventScroll:true});
  }

  function create(p) {
    const node = element("section","aw-window");
    node.dataset.placeId = p.id;
    node.setAttribute("role", "dialog");
    node.setAttribute("aria-label",p.name);
    const bar = element("header","aw-titlebar");
    bar.tabIndex = 0;
    bar.setAttribute("aria-label",p.name + "，可拖动窗口或使用方向键移动");
    bar.setAttribute("aria-keyshortcuts", "ArrowUp ArrowDown ArrowLeft ArrowRight");
    const grip = element("span", "aw-grip");
    grip.setAttribute("aria-hidden", "true");
    const context = element("span", "aw-context");
    const identity = element("div", "aw-identity");
    const title = element("h2", "aw-title");
    const controls = element("div","aw-controls");
    const body = element("div","aw-body");
    const info = element("div","aw-info");
    const placeInfo = element("div","aw-place-info");
    placeInfo.dataset.placeInfo = p.id;
    const record = {p,node,bar,title,context,body,info,placeInfo,x:8,y:92,collapsed:false};
    record.min = button("折叠窗口","shrink","aw-icon-btn",()=>collapse(record,!record.collapsed),true);
    record.min.setAttribute("aria-expanded","true");
    record.pin = button("固定到比较卡片","pin","aw-icon-btn aw-pin",()=>dispatch("pin",p.id),true);
    record.closeButton = button("关闭" + p.name,"close","aw-icon-btn",()=>close(record),true);
    identity.append(context,title);
    controls.append(record.pin,record.min,record.closeButton);
    bar.append(identity,grip,controls);
    info.append(placeInfo); body.append(info); node.append(bar,body);
    node.addEventListener("pointerdown",()=>raise(record),true);
    node.addEventListener("focusin",()=>raise(record));
    moveWithHeader(record);
    panels.set(p.id,record);layer.append(node);
    sync(record);layoutNew(record);raise(record,true);
    sizeObserver.observe(node);
  }

  function reflow() {
    if (desktop.matches) for (const p of panels.values()) placeAt(p,p.x,p.y);
  }
  window.atlasWindows = {
    mount({container,byId,actions}) {
      events?.abort();
      closeAll();
      layer = container; layer.classList.add("aw-layer");
      placeById = byId;
      dispatch = actions; state = {}; front = 0;
      events = new AbortController();
      sizeObserver = new ResizeObserver(entries => {
        for (const entry of entries) {
          const record = panels.get(entry.target.dataset.placeId);
          if (record) placeAt(record, record.x, record.y);
        }
      });
      window.addEventListener("resize",reflow,{signal:events.signal});
    },
    open(id) {
      if (!desktop.matches || !placeById?.has(id)) return false;
      const record = panels.get(id);
      if (record) {
        showDetails(record);
        if (record.collapsed) collapse(record,false);
        raise(record,true);
      }
      else create(placeById.get(id));
      return true;
    },
    closeAll,
    refresh(next) { state=next; for (const p of panels.values()) sync(p); },
    isDesktop() { return desktop.matches; }
  };
})();
