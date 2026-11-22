(() => {
  "use strict";
  const {t} = window.atlasLocale;

  const searches = new WeakMap();

  async function run(host, onSelect) {
    const query = host.dataset.googleQuery;
    if (!query || searches.has(host)) return;
    const button = host.querySelector('[data-action="searchGoogle"]');
    const status = host.querySelector("[data-search-status]");
    const results = host.querySelector("[data-search-results]");
    const session = {};
    searches.set(host, session);
    const active = () => host.isConnected && searches.get(host) === session;
    let timer = 0;
    function failed(message) {
      clearTimeout(timer);
      if (!active()) return;
      searches.delete(host);
      results.replaceChildren();
      status.textContent = message;
      button.hidden = false;
      button.querySelector("span").textContent = t("重试 Google 搜索", "Retry Google search");
    }
    button.hidden = true;
    status.textContent = t("正在搜索 Google 地点…", "Searching Google Maps…");
    status.focus({preventScroll: true});
    try {
      await window.atlasGoogle.load("places");
      if (!active()) return;
      const widget = document.createElement("gmp-place-search");
      widget.setAttribute("selectable", "");
      const request = document.createElement("gmp-place-text-search-request");
      request.setAttribute("max-result-count", "5");
      const bias = window.atlasMap?.getSearchBias?.();
      if (bias) request.locationBias = bias;
      request.setAttribute("text-query", query);
      widget.append(request, document.createElement("gmp-place-standard-content"));
      widget.addEventListener("gmp-error", event => {
        if (!active()) return;
        window.atlasGoogle.reportGoogleError(event);
        failed(t("Google 地点搜索无法使用，请检查网络或地图连接设置。", "Google place search is unavailable. Check your connection or map settings."));
      });
      widget.addEventListener("gmp-load", () => {
        clearTimeout(timer);
        if (!active()) return;
        const count = widget.places.length;
        status.textContent = count
          ? t("找到 " + count + " 个 Google 地点", count + (count === 1 ? " place found" : " places found"))
          : t("Google 未找到地点，试试其他名称或加上城市名。", "No places found. Try another name or include the city.");
      });
      widget.addEventListener("gmp-select", event => {
        if (!active()) return;
        const result = window.atlasSavedPlaces.widgetPlace(event.place);
        if (result) onSelect(result);
        else status.textContent = t("无法打开这个地点，请选择其他结果。", "Couldn’t open this place. Choose another result.");
      });
      timer = setTimeout(() => failed(t("Google 地点搜索暂未响应。", "Google place search took too long to respond.")), 20000);
      results.replaceChildren(widget);
    } catch {
      failed(t("Google 地点搜索无法使用，请检查网络或地图连接设置。", "Google place search is unavailable. Check your connection or map settings."));
    }
  }

  window.atlasPlaceSearch = {run};
})();
