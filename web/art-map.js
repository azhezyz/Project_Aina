(() => {
  "use strict";
  const {t} = window.atlasLocale;
  const styles = {
    watercolor: t("日式水彩", "Japanese watercolor"),
    ink: t("钢笔速写", "Pen-and-ink sketch"),
    woodcut: t("复古版画", "Vintage woodblock")
  };
  const sans = '"Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif';
  const serif = 'Georgia, "Yu Mincho", "Songti SC", SimSun, serif';
  const paper = "#fbf8ed";
  const ink = "#243d34";
  const sessions = new Map();
  let dialog, ui, current, pending, connection, statusRequest, googleKyoto, capture;

  function createDialog() {
    dialog = document.createElement("dialog");
    dialog.className = "art-dialog";
    dialog.setAttribute("aria-labelledby", "art-heading");
    dialog.innerHTML = `
      <header class="art-bar">
        <h2 id="art-heading">${t("艺术地图", "Art map studio")}</h2>
        <button type="button" data-close autofocus aria-label="${t("关闭艺术地图", "Close art map studio")}">×</button>
      </header>
      <div class="art-layout">
        <aside class="art-controls" aria-label="${t("海报设置", "Poster settings")}">
          <button type="button" data-download class="art-primary" disabled>${t("下载 PNG", "Download PNG")}</button>
          <p class="art-status" data-status role="status" aria-live="polite" aria-atomic="true"></p>
          <button type="button" class="art-recheck" data-recheck hidden></button>
          <label>${t("绘画风格", "Art style")}
            <select data-style>${Object.entries(styles).map(([id, name]) => `<option value="${id}">${name}</option>`).join("")}</select>
          </label>
          <label>${t("海报标题", "Poster title")}
            <input type="text" data-title maxlength="60" autocomplete="off">
          </label>
          <label class="art-color">${t("路线颜色", "Route color")}<input type="color" data-color></label>
          <div class="art-actions">
            <button type="button" data-generate></button>
          </div>
        </aside>
        <section class="art-preview" aria-label="${t("地图预览", "Map preview")}">
          <div class="art-switch" role="group" aria-label="${t("预览版本", "Preview version")}">
            <button type="button" data-original hidden>${t("Google 地图截图", "Google Maps screenshot")}</button>
            <button type="button" data-poster>${t("路线海报", "Route poster")}</button>
            <button type="button" data-art>${t("艺术版", "Art print")}</button>
          </div>
          <div class="art-frame"><canvas data-preview width="1024" height="1280" role="img"></canvas>
            <p data-empty hidden></p>
          </div>
          <div class="art-credit" data-credit hidden><span data-provider></span> <a data-attribution href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a></div>
        </section>
      </div>`;
    document.body.append(dialog);
    ui = Object.fromEntries(["close", "style", "title", "color", "generate", "download", "status", "recheck",
      "original", "poster", "art", "preview", "empty", "credit", "provider", "attribution"].map(key => [key, dialog.querySelector(`[data-${key}]`)]));
    ui.close.onclick = () => dialog.close();
    dialog.addEventListener("close", () => { if (!dialog.open) cancelCapture(); });
    ui.style.onchange = () => {
      current.style = ui.style.value;
      if (current.images.has(current.style)) current.version = "art";
      else if (current.version === "art") current.version = "poster";
      current.notice = "";
      update();
    };
    ui.title.oninput = () => { current.title = ui.title.value; draw(); };
    ui.color.oninput = () => { current.color = ui.color.value; draw(); };
    ui.original.onclick = () => { current.version = "original"; update(); };
    ui.poster.onclick = () => { current.version = "poster"; update(); };
    ui.art.onclick = () => { current.version = "art"; update(); };
    ui.recheck.onclick = () => {
      current.notice = current.sourceError = "";
      checkConnection();
    };
    ui.generate.onclick = generate;
    ui.download.onclick = download;
  }

  function open(route) {
    if (!dialog) createDialog();
    const {master,business,attractions,transit,roads} = window.atlasLayerPrefs.read().labels;
    const key = JSON.stringify([route.id, route.stops, master, business, attractions, transit, roads]);
    let session = sessions.get(key);
    if (!session) {
      session = {style: "watercolor", version: "original", images: new Map(), notice: ""};
    }
    if (session.mode === true) session.version = "original";
    if (session.title === undefined || session.title === session.routeName) session.title = route.name;
    if (!session.color || session.color === session.routeColor) session.color = /^#[0-9a-f]{6}$/i.test(route.color) ? route.color : "#087e83";
    session.routeName = route.name;
    session.routeColor = route.color;
    session.route = route;
    session.sourceError = "";
    cancelCapture();
    current = session;
    // Keep recent artwork when the dialog closes. Drop older routes' decoded images.
    sessions.delete(key);
    sessions.set(key, session);
    for (const [oldKey, old] of sessions) {
      if (sessions.size <= 2) break;
      if (old !== current && old !== pending?.session) sessions.delete(oldKey);
    }
    ui.style.value = session.style;
    ui.title.value = session.title;
    ui.title.placeholder = route.name;
    ui.color.value = session.color;
    if (!dialog.open) dialog.showModal();
    checkConnection();
  }

  function cancelCapture() {
    if (capture) { capture.controller.abort(); capture = null; }
  }

  function errorText(error, fallback) {
    return error instanceof Error && !(error instanceof TypeError) && error.message ? error.message : fallback;
  }

  async function prepareSource() {
    const session = current;
    if (!dialog.open || !["missing", "ready"].includes(connection)) { update(); return; }
    if (session.mode !== googleKyoto) {
      session.mode = googleKyoto;
      session.source = null;
      session.images.clear();
      session.version = googleKyoto ? "original" : "poster";
      session.notice = session.sourceError = session.routeError = "";
    }
    if ((session.source && !session.routeError) || session.sourceError || capture?.session === session) { update(); return; }
    const controller = new AbortController();
    capture = {session, controller};
    update();
    try {
      if (googleKyoto) {
        const options = {signal: controller.signal};
        let frame, routeError = "";
        try {
          frame = await window.atlasArtSource.googleFrame(session.route, options);
        } catch (error) {
          if (controller.signal.aborted) return;
          routeError = errorText(error, t("无法读取步行路线。", "The walking route is unavailable."));
          if (session.source) { session.routeError = routeError; return; }
          frame = await window.atlasArtSource.googleFrame(session.route, {...options, stopsOnly: true});
        }
        if (controller.signal.aborted) return;
        const source = await window.atlasGoogleArt.reference(frame, options);
        if (!controller.signal.aborted) {
          session.source = source;
          session.routeError = routeError;
        }
      } else {
        session.source = window.atlasArtSource.render(session.route);
      }
    } catch (error) {
      if (!controller.signal.aborted) session.sourceError = errorText(error, googleKyoto
        ? t("无法获取 Google 地图截图。请检查连接后重试。", "Could not capture Google Maps. Check your connection and retry.")
        : t("离线地图尚未加载，请重试。", "The offline map has not loaded. Please retry."));
    } finally {
      if (capture?.controller === controller) capture = null;
      update();
    }
  }

  async function checkConnection() {
    if (statusRequest) { update(); return; }
    connection = "checking";
    update();
    statusRequest = true;
    try {
      const response = await fetch("/api/art-map/status", {cache: "no-store"});
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (typeof data.configured !== "boolean" || typeof data.googleKyoto !== "boolean") throw new Error();
      googleKyoto = data.googleKyoto === true;
      connection = data.configured ? "ready" : "missing";
    } catch { connection = "offline"; }
    finally { statusRequest = false; prepareSource(); }
  }

  function stateMessage() {
    if (current.sourceError) return current.sourceError;
    if (connection === "offline") return t("无法连接艺术地图服务。请使用项目的 Python 服务器打开此页。", "The art service is unavailable. Open this page through the project's Python server.");
    if (connection === "checking") return t("正在检查地图来源…", "Checking the map source…");
    if (!current.source && googleKyoto) return t("正在截取京都 Google 地图…", "Capturing the Kyoto map from Google Maps…");
    if (capture?.session === current) return t("正在准备路线…", "Preparing the route…");
    if (current.routeError) return t("Google 地图截图可以下载。路线海报暂不可用。", "The Google Maps screenshot is ready. The route poster is unavailable.") + " " + current.routeError;
    if (pending) return pending.session === current
      ? t("正在生成艺术地图，完成后可在这里查看。", "Generating your art print. It will appear here when ready.")
      : t("另一条路线的艺术地图正在生成。", "An art print is being generated for another route.");
    if (current.notice) return current.notice;
    if (connection === "missing") return t("下载 PNG 无需 OpenAI 密钥。生成艺术版需在本地服务器配置密钥。", "You can download the PNG now. To generate an art print, set an OpenAI API key on the local server.");
    if (current.source?.google && current.version === "original") return t("下载截图会保留 Google 地图署名。点击「生成艺术地图」会调用 OpenAI，可能产生费用。", "The screenshot keeps the Google Maps attribution. Generating an art print uses OpenAI and may incur charges.");
    if (current.images.has(current.style)) return t("标题和颜色可直接修改。再画一版会重新请求 OpenAI，可能产生 API 费用。", "Title and color edits are local. Generating another version uses the OpenAI API again and may incur charges.");
    return t("生成时会将当前底图和路线标记发送给 OpenAI，可能产生 API 费用。", "Generating sends this basemap and route guide to OpenAI and may incur API charges.");
  }

  function update() {
    if (!current || !dialog.open) return;
    const modeKnown = ["ready", "missing"].includes(connection);
    const hasMap = modeKnown && Boolean(current.source);
    const hasRoute = hasMap && !current.routeError;
    const hasArt = hasRoute && current.images.has(current.style);
    const screenshot = current.version === "original" && googleKyoto;
    ui.style.disabled = !hasRoute || pending?.session === current;
    ui.title.disabled = ui.color.disabled = !hasRoute || screenshot;
    ui.generate.disabled = !hasRoute || Boolean(pending) || connection !== "ready";
    ui.generate.textContent = pending?.session === current ? t("正在生成…", "Generating…") :
      hasArt ? t("再画一版", "Generate another version") : t("生成艺术地图", "Generate art print");
    ui.download.disabled = !hasMap;
    ui.download.textContent = !modeKnown ? t("下载 PNG", "Download PNG") : screenshot
      ? t("下载 Google 地图截图", "Download Google Maps screenshot")
      : current.version === "art" ? t("下载艺术海报", "Download art print") : t("下载路线海报", "Download route poster");
    ui.original.hidden = !modeKnown || !googleKyoto;
    ui.original.disabled = !hasMap;
    ui.poster.disabled = !hasRoute;
    ui.art.disabled = !hasArt;
    ui.original.setAttribute("aria-pressed", String(hasMap && current.version === "original"));
    ui.poster.setAttribute("aria-pressed", String(hasRoute && current.version === "poster"));
    ui.art.setAttribute("aria-pressed", String(hasArt && current.version === "art"));
    ui.preview.hidden = !hasMap;
    ui.empty.hidden = hasMap;
    ui.empty.textContent = current.sourceError || connection === "offline" ?
      t("暂无可用地图", "Map unavailable") : t("正在准备地图…", "Preparing map…");
    ui.recheck.hidden = connection === "checking" || capture?.session === current ||
      (!current.sourceError && !current.routeError && !["missing", "offline"].includes(connection) && googleKyoto);
    ui.recheck.textContent = current.sourceError || current.routeError ? t("重试", "Retry") : t("重新检查连接", "Check connection again");
    ui.credit.hidden = !modeKnown;
    ui.provider.textContent = googleKyoto ? t("底图来源 · Google Maps", "Basemap · Google Maps") :
      t("离线地图 · 本机未启用 Google 地图截图", "Offline map · Google Maps capture is disabled on this computer");
    ui.attribution.hidden = !hasMap || (googleKyoto && (screenshot || !current.source.attributionUrl));
    const message = stateMessage();
    if (ui.status.textContent !== message) ui.status.textContent = message;
    if (hasMap) draw();
  }

  function draw() {
    const source = current.source;
    if (!source) return;
    const canvas = ui.preview;
    const ctx = canvas.getContext("2d");
    const {width, height, paths, stops} = source;
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    if (source.google && current.version === "original") {
      ctx.drawImage(source.canvas, 0, 0);
      canvas.setAttribute("aria-label", t("Google 地图截图", "Google Maps screenshot") + " · " + current.routeName);
      return;
    }
    const creditHeight = source.creditCanvas?.height || 0;
    const rows = Math.ceil(stops.length / 2);
    const compact = creditHeight && rows > 4;
    const rowHeight = compact ? 24 : 29;
    const footer = height - creditHeight - (rows * rowHeight + (compact ? 45 : 55));
    const background = current.version === "art" && current.images.get(current.style) || source.canvas;
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(background, 0, 0, width, height);
    ctx.lineCap = ctx.lineJoin = "round";
    ctx.beginPath();
    for (const points of paths) {
      points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    }
    for (const [color, lineWidth] of [[ink, 12], [paper, 10], [current.color, 6]]) {
      ctx.strokeStyle = color; ctx.lineWidth = lineWidth; ctx.stroke();
    }
    stops.forEach(({x, y}, i) => {
      ctx.beginPath(); ctx.arc(x, y, 20, 0, 2 * Math.PI);
      ctx.fillStyle = paper; ctx.fill();
      ctx.strokeStyle = ink; ctx.lineWidth = 5; ctx.stroke();
      ctx.strokeStyle = current.color; ctx.lineWidth = 3; ctx.stroke();
      ctx.fillStyle = ink; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = `bold 24px ${sans}`; ctx.fillText(i + 1, x, y + 1);
    });
    labelStops(ctx, source, footer);

    const title = current.title.trim() || current.routeName;
    ctx.fillStyle = paper; ctx.fillRect(0, 0, width, 120);
    ctx.fillStyle = current.color; ctx.fillRect(40, 33, 36, 4);
    ctx.fillStyle = ink; ctx.textBaseline = "middle"; ctx.textAlign = "left";
    ctx.font = `600 19px ${sans}`;
    ctx.fillText(source.google ? t("京都", "KYOTO") : t("京都 · 东山", "KYOTO · HIGASHIYAMA"), 90, 35);
    ctx.textAlign = "right"; ctx.fillText("Project Aina", width - 40, 35);
    ctx.font = `bold 43px ${serif}`;
    const fit = Math.min(43, Math.floor(43 * (width - 80) / Math.max(1, ctx.measureText(title).width)));
    ctx.font = `bold ${Math.max(21, fit)}px ${serif}`;
    ctx.textAlign = "left"; ctx.fillText(title, 40, 83, width - 80);

    ctx.fillStyle = paper; ctx.fillRect(0, footer, width, height - footer);
    ctx.fillStyle = ink; ctx.font = `600 18px ${sans}`;
    ctx.fillText(t("路线站点", "ROUTE STOPS"), 40, footer + 24);
    ctx.font = `16px ${sans}`; ctx.textAlign = "right";
    const credit = source.attributionUrl?.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
    const attribution = source.google ? source.routeAttribution : source.attribution;
    ctx.fillText([attribution, credit].filter(Boolean).join(" · "), width - 40, footer + 24, width - 240);
    ctx.textAlign = "left";
    stops.forEach(({name}, i) => {
      const x = 40 + (i % 2) * (width - 80) / 2, y = footer + 56 + Math.floor(i / 2) * rowHeight;
      ctx.fillStyle = ink; ctx.font = `bold 18px ${sans}`; ctx.fillText(String(i + 1).padStart(2, "0"), x, y);
      ctx.font = `${compact ? 22 : 26}px ${sans}`; ctx.fillText(name, x + 35, y, (width - 80) / 2 - 52);
    });
    if (source.creditCanvas) ctx.drawImage(source.creditCanvas, 0, height - creditHeight);
    canvas.setAttribute("aria-label", `${title} · ${stops.map((s, i) => `${i + 1}. ${s.name}`).join(", ")}`);
  }

  function labelStops(ctx, {width, stops, paths}, footer) {
    const occupied = stops.map(({x, y}) => [x - 23, y - 23, x + 23, y + 23]);
    const routePoints = paths.flat();
    ctx.font = `600 26px ${sans}`;
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    for (const {name, x, y} of stops) {
      const w = Math.ceil(ctx.measureText(name).width) + 20, h = 38;
      const candidates = [[x + 28, y - h / 2], [x - 28 - w, y - h / 2],
        [x - w / 2, y - 28 - h], [x - w / 2, y + 28]];
      let position, bestScore = Infinity;
      for (const [l, top] of candidates) {
        const r = l + w, b = top + h;
        if (l < 8 || r > width - 8 || top < 125 || b > footer - 5) continue;
        if (occupied.some(([left, upper, right, lower]) => l < right && r > left && top < lower && b > upper)) continue;
        const score = routePoints.reduce((n, [px, py]) => n + (px >= l && px <= r && py >= top && py <= b), 0);
        if (score < bestScore) { bestScore = score; position = [l, top, r, b]; }
        if (!score) break;
      }
      // The numbered key still identifies this stop if its label would obscure the route.
      if (!position || bestScore > 0) continue;
      const [left, top] = position;
      occupied.push(position);
      ctx.fillStyle = "rgba(251,248,237,.94)"; ctx.fillRect(left, top, w, h);
      ctx.fillStyle = ink; ctx.fillText(name, left + 9, top + h / 2 + 1);
    }
  }

  const errors = {
    not_configured: t("本地服务器尚未配置 OpenAI API 密钥。", "An OpenAI API key is required on the local server."),
    billing: t("OpenAI 项目的计费额度不足，请检查项目账单。", "Check billing and available credits for the OpenAI project."),
    rate_limit: t("服务请求过于频繁，请稍后再试。", "The image service is rate-limited. Try again later."),
    busy: t("服务正在处理另一张地图，请稍后再试。", "The server is already generating a map. Try again later."),
    timeout: t("等待图像服务超时，未收到成品。", "The image service timed out before returning a print."),
    invalid_image: t("服务无法读取地图参考图。", "The service could not read the reference maps."),
    invalid_key: t("本地服务器的 OpenAI API 密钥无效。", "The OpenAI API key on the local server is invalid."),
    model_access: t("该 OpenAI 项目无权使用所选图像模型。", "This OpenAI project cannot access the selected image model."),
    content_policy: t("图像服务拒绝生成这张地图。", "The image service declined to generate this map."),
    unsupported_style: t("服务尚不支持此风格。", "This style is unavailable on the server."),
    upstream: t("图像服务未能返回成品。", "The image service could not return a print.")
  };

  async function generate() {
    const session = current, style = session.style;
    const source = session.source;
    if (!source || session.routeError || pending || connection !== "ready") return;
    pending = {session, style};
    session.notice = "";
    update();
    try {
      const {canvas, markedCanvas, width, height} = source;
      const response = await fetch("/api/art-map", {
        method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({style, reference: canvas.toDataURL("image/png"), markup: markedCanvas.toDataURL("image/png")})
      });
      const data = await response.json();
      if (!response.ok) {
        if (data.error?.code === "not_configured") connection = "missing";
        throw new Error(errors[data.error?.code] || errors.upstream);
      }
      if (typeof data.image !== "string" || !data.image.startsWith("data:image/png;base64,")) throw new Error(errors.upstream);
      const bitmap = new Image();
      bitmap.src = data.image;
      await bitmap.decode();
      if (bitmap.naturalWidth !== width || bitmap.naturalHeight !== height) throw new Error(errors.invalid_image);
      if (session.source !== source) return;
      session.images.set(style, bitmap);
      session.version = "art";
    } catch (error) {
      session.notice = Object.values(errors).includes(error.message) ? error.message :
        t("未收到艺术地图。请检查本地服务的连接。", "No art print was received. Check the connection to the local server.");
    } finally { pending = null; update(); }
  }

  function download() {
    const session = current;
    if (!session.source) return;
    const name = Array.from((session.title.trim() || session.routeName).normalize("NFKC")
      .replace(/[<>:"/\\|?*\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]+/g, "-")).slice(0, 64).join("").replace(/[. ]+$/g, "");
    const screenshot = session.source.google && session.version === "original";
    const suffix = screenshot ? "google-maps" : session.version === "art" ? session.style : "route-poster";
    const filename = `Aina-${name || "map"}-${suffix}.png`;
    const canvas = screenshot ? session.source.canvas : ui.preview;
    canvas.toBlob(blob => {
      if (!blob) {
        session.notice = t("无法导出 PNG。", "The PNG could not be exported."); update(); return;
      }
      const url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url; link.download = filename;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    }, "image/png");
  }

  window.atlasArtMap = Object.freeze({open});
})();
