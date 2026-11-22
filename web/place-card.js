(() => {
  "use strict";
  const storageKey = "kyoto.google.browser-key";
  const byId = window.atlasSavedPlaces.byId;
  const rendered = new WeakMap();
  const $ = id => document.getElementById(id);
  const google = window.atlasGoogle;

  function el(tag, cls, value) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (value) node.textContent = value;
    return node;
  }
  function link(text, url, cls) {
    const a = el("a", cls, text);
    a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer";
    return a;
  }
  function attribution(a) {
    const line = el("span", "pc-attribution");
    line.append(a.credit + " · ", link(a.title, a.source), " · ", link(a.license, a.licenseUrl.replace(/^http:/,"https:")), " · " + a.changes);
    return line;
  }
  function openPhoto(p, a) {
    const d = $("place-photo-view"), img = d.querySelector("img");
    d.querySelector("h2").textContent = p.name;
    img.src = a.src; img.alt = p.name + "实景";
    d.querySelector(".pc-photo-caption").replaceChildren(attribution(a));
    d.showModal();
  }
  function photoFigure(p, a) {
    const figure = el("figure", "pc-figure");
    const open = el("button", "pc-open-photo");
    open.type = "button"; open.setAttribute("aria-label", "放大" + p.name + "的实景照片");
    const img = el("img");
    img.alt = p.name + "实景"; img.decoding = "async"; img.src = a.src;
    img.addEventListener("error", () => figure.remove(), {once:true});
    open.append(img); open.addEventListener("click", () => openPhoto(p, a));
    const caption = el("figcaption");
    const details = el("details");
    details.append(el("summary", "", "照片来源与许可"), attribution(a)); caption.append(details);
    figure.append(open,caption);
    return figure;
  }
  function fact(title, value) {
    const row = el("div","pc-fact");
    row.append(el("dt","",title),el("dd","",value)); return row;
  }
  function titleFor(place) {
    return place.dynamic ? place.label || place.providerName || "" : place.name;
  }
  function updateLocalAction(record) {
    const button = record.routeButton;
    if (!button) return;
    const actions = record.actions;
    button.hidden = typeof actions?.onRoute !== "function";
    button.disabled = Boolean(actions?.routeDisabled);
    button.textContent = actions?.routeLabel || "从这里规划";
  }
  function localInfo(p,record) {
    const block = el("div","pc-local"), a = window.atlasPhotos[p.id];
    if (a) block.append(photoFigure(p,a));
    block.append(el("h2","pc-title",p.name));
    const category = [p.kind,p.area].filter(Boolean).join(" · ");
    if (category) block.append(el("p","pc-category",category));
    const facts = el("dl","pc-facts");
    if (p.hours) facts.append(fact(p.kind === "咖啡馆" ? "营业时间" : "开放时间",p.hours));
    if (p.address) facts.append(fact("地址",p.address));
    const controls = el("div","pc-actions");
    const route = el("button","pc-route");
    route.type = "button";
    route.addEventListener("click",()=>{
      if (!record.actions?.routeDisabled) record.actions?.onRoute?.();
    });
    record.routeButton = route;
    updateLocalAction(record);
    controls.append(route);
    if (/^https?:\/\//i.test(p.url || "")) {
      const website = link("官网",p.url,"pc-website");
      website.addEventListener("click",event=>{
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || !record.actions?.onWebsite) return;
        event.preventDefault();
        record.actions.onWebsite();
      });
      controls.append(website);
    }
    block.append(controls);
    if (facts.childElementCount) block.append(facts);
    if (p.note) block.append(el("p","pc-note",p.note));
    if (p.source && p.source !== p.url) {
      const links = el("div","pc-links");
      links.append(link("资料来源",p.source));
      block.append(links);
    }
    return block;
  }
  function fill(host,p,{compact=false,actions}={}) {
    if (!host || !p) return;
    const configured = google.isConfigured();
    const windowTitle = host.classList.contains("aw-place-info");
    const title = compact ? "" : titleFor(p);
    const previous = rendered.get(host);
    if (previous?.id === p.id && previous.configured === configured && previous.compact === compact) {
      previous.actions = actions;
      const localTitle = host.querySelector(".pc-title");
      if (localTitle && localTitle.textContent !== p.name) localTitle.textContent = p.name;
      if (previous.heading) {
        previous.heading.textContent = title;
        previous.heading.hidden = !title || previous.live.dataset.googleStatus === "error";
      }
      updateLocalAction(previous);
      if (previous.live) google.updateActions(previous.live,actions,Boolean(title));
      return;
    }
    const record = {id:p.id,configured,compact,actions};
    rendered.set(host,record);
    host.classList.add("pc-host");
    host.classList.toggle("pc-compact",compact);
    if (!configured) {
      host.replaceChildren(localInfo(p,record));
      return;
    }
    const live = el("div","pc-live");
    record.live = live;
    host.replaceChildren(live);
    if (!compact && !windowTitle) {
      record.heading = el("h2","pc-sheet-title",title);
      record.heading.hidden = !title;
      host.prepend(record.heading);
    }
    function onStatus(status) {
      if (rendered.get(host) !== record) return;
      live.dataset.googleStatus = status;
      if (record.heading) record.heading.hidden = status === "error" || !titleFor(p);
      if (status === "error" && !record.fallback) {
        record.fallback = localInfo(p,record);
        host.append(record.fallback);
      }
      if (record.fallback) record.fallback.hidden = status !== "error";
    }
    if (google.mount(live,p,{compact,onStatus,actions,externalTitle:Boolean(title)}) === false) onStatus("error");
  }
  function refreshCards() {
    for (const host of document.querySelectorAll("[data-place-info]")) {
      fill(host,byId.get(host.dataset.placeInfo),{compact:host.hasAttribute("data-compact"),actions:rendered.get(host)?.actions});
    }
  }
  const setup = $("google-settings"), input = $("google-browser-key"), status = $("google-key-status");
  function updateSettings() {
    const source = google.keySource();
    const project = source === "project";
    input.disabled = project;
    const form = $("google-key-form");
    for (const item of [form.querySelector("label[for='google-browser-key']"), input, form.querySelector("button[type='submit']")]) {
      item.style.display = project ? "none" : "";
    }
    const help = form.querySelector(".pc-help");
    if (project) {
      help.replaceChildren("地图和地点卡片共用本机保存的浏览器密钥。要更换密钥，请在项目目录运行 ",
        el("code", "", "py -3 server.py --set-key"), "，然后刷新页面。");
    } else {
      help.textContent = "密钥只保存在当前标签页。请在 Google Cloud 启用 Maps JavaScript API 和 Places UI Kit，并限制允许使用密钥的网站。";
    }
    $("google-disconnect").hidden = source !== "session";
    const mapUnavailable = window.atlasMap?.getBasemapState() === "error";
    if (google.hasAuthError() || google.hasPlaceDenial() || mapUnavailable) {
      status.textContent = google.hasAuthError() ? "Google Maps 已拒绝连接。" : google.hasPlaceDenial() ? "Google 拒绝了地点请求。" : "Google 底图暂时无法加载。";
      if (!google.appendBillingHelp(status)) status.append("请检查浏览器密钥、网站来源限制、API 启用状态和项目结算。");
    } else if (project) status.textContent = "当前使用本地项目配置。";
    else if (source === "session") status.textContent = "当前标签页已设置密钥。更换或断开会刷新本页。";
    else status.textContent = "当前使用随地图提供的地点资料。";
    $("current-referrer").textContent = /^https?:$/.test(location.protocol) ? location.origin+"/*" : "请在在线版配置网站来源";
  }
  function settings() {
    input.value = "";
    updateSettings();
    setup.showModal();
  }
  function applyKey(value) {
    if (google.keySource() === "project") return;
    const previouslyConfigured = google.isConfigured();
    try {
      if (value === sessionStorage.getItem(storageKey) && !google.hasAuthError()) { setup.close(); return; }
      if (value) sessionStorage.setItem(storageKey,value);
      else sessionStorage.removeItem(storageKey);
    } catch {
      status.textContent = "此浏览器未允许标签页存储。请在在线版或允许会话存储后重试。";
      return;
    }
    setup.close();
    if (previouslyConfigured) { location.reload(); return; }
    google.configure(value);
    refreshCards();
  }
  $("google-key-form").addEventListener("submit",event=>{
    event.preventDefault(); const value = input.value.trim();
    if (!value || /\s/.test(value)) { status.textContent="请输入完整的 Google Maps 浏览器密钥。"; input.focus(); return; }
    applyKey(value);
  });
  $("google-disconnect").addEventListener("click",()=>applyKey(""));
  for (const name of ["aina-google-auth-error","aina-google-place-status"]) {
    window.addEventListener(name,()=>{if(setup.open) updateSettings();});
  }
  setup.addEventListener("close",()=>{input.value="";});
  for (const close of document.querySelectorAll("dialog [data-dismiss]")) {
    close.addEventListener("click",()=>close.closest("dialog").close());
  }
  window.atlasPlaceCard = {fill,settings,titleFor};
})();
