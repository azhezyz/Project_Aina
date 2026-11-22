(() => {
  "use strict";
  const {t, lang} = window.atlasLocale;
  async function imageCanvas(url) {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    canvas.getContext("2d").drawImage(image, 0, 0);
    return canvas;
  }
  const captureErrors = {
    outside_kyoto: t("请将取景中心移到京都市内，并放大地图后截图。", "Center the view in Kyoto and zoom in to take a screenshot."),
    busy: t("上一张 Google 地图正在截图，请稍后再试。", "A Google map is being captured. Try again in a moment."),
    capture_unavailable: t("本机截图需要 Chrome 或 Edge 和 Node.js。", "Local capture requires Chrome or Edge and Node.js."),
    google_disabled: t("此安装尚未启用京都 Google 道路图截图。", "Kyoto Google road map capture is disabled on this installation."),
    invalid_size: t("窗口太小，无法截取完整地图。请放大窗口后再试。", "Enlarge the window to capture the map.")
  };
  async function capture({bounds, width, height}, labels, signal) {
    const response = await fetch("/api/art-map/google-reference", {method:"POST", signal,
      headers:{"Content-Type":"application/json"}, body:JSON.stringify({bounds, width, height, labels, lang})});
    if (!response.ok) {
      const info = await response.json().catch(() => null);
      if (response.status === 404 || response.status === 501) throw new Error(t("当前服务未提供 Google 截图，请从新版 Aina 本地服务打开。",
        "This server does not provide Google screenshots. Open the current local Aina server."));
      throw new Error(captureErrors[info?.error?.code] || t("Google 道路图截图失败，请检查地图连接后重试。",
        "Google road map capture failed. Check the map connection and try again."));
    }
    return response.json();
  }
  async function reference(source, {signal} = {}) {
    const labels = window.atlasLayerPrefs.read().labels;
    const {image, creditText} = await capture(source, labels, signal);
    const canvas = await imageCanvas(image);
    if (canvas.width !== source.width || canvas.height !== source.height || !creditText)
      throw new Error(t("底图尺寸或署名不完整。", "Map size or attribution is incomplete."));
    const creditCanvas = document.createElement("canvas");
    creditCanvas.width = canvas.width; creditCanvas.height = 38;
    creditCanvas.getContext("2d").drawImage(canvas, 0, 38 - canvas.height);
    return {...source, canvas, creditCanvas, google:true,
      attribution:["Google Maps · " + creditText, source.routeAttribution || source.attribution].filter(Boolean).join(" | ")};
  }
  async function downloadViewport(labels) {
    const bounds = window.atlasMap.getSearchBias()?.toJSON();
    const surface = document.querySelector(".atlas-google-basemap");
    if (!bounds || !surface?.clientWidth || !surface.clientHeight) throw new Error(t("请等 Google 地图载入后再截图。", "Wait for Google Maps to load before capturing."));
    const scale = Math.min(1, 2560 / Math.max(surface.clientWidth, surface.clientHeight),
      Math.sqrt(4000000 / (surface.clientWidth * surface.clientHeight)));
    const width = Math.floor(surface.clientWidth * scale), height = Math.floor(surface.clientHeight * scale);
    const {image} = await capture({bounds, width, height}, labels);
    const link = document.createElement("a");
    link.download = "Aina-Kyoto-Google-Map.png";
    link.href = image;
    document.body.append(link); link.click(); link.remove();
  }
  window.atlasGoogleArt = {reference, downloadViewport};
})();
