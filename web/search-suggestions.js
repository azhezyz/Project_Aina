(() => {
  "use strict";
  const {t} = window.atlasLocale;

  function mount({onSelect, onSettings}) {
    const form = document.getElementById("search");
    const input = document.getElementById("query");
    const popover = document.getElementById("search-popover");
    const list = document.getElementById("search-results");
    const template = document.getElementById("search-place-option");
    const note = document.getElementById("search-note");
    const settings = document.getElementById("search-settings");
    const feedback = document.getElementById("search-feedback");
    const messages = {
      loading: t("正在搜索 Google 地图…", "Searching Google Maps…"),
      connecting: t("正在连接 Google 地图…", "Connecting to Google Maps…"),
      opening: t("正在打开地点…", "Opening place…"),
      empty: t("没找到匹配的地点。试试其他名称，或加上城市名。", "No matching places. Try another name or add a city."),
      offline: t("连接 Google 地图后即可搜索地点。", "Connect Google Maps to search for places."),
      error: t("搜索暂时不可用。按回车重试。", "Search is unavailable. Press Enter to retry.")
    };
    let items = [], active = -1;

    function fitViewport() {
      if (popover.hidden) return;
      const viewport = window.visualViewport;
      const bottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
      const height = Math.max(0, bottom - form.getBoundingClientRect().bottom - 20);
      popover.style.setProperty("--available-height", height + "px");
    }

    function open() {
      popover.hidden = false;
      form.classList.add("show-suggestions");
      input.setAttribute("aria-expanded", "true");
      fitViewport();
    }

    function resetOptions() {
      items = [];
      active = -1;
      input.removeAttribute("aria-activedescendant");
      list.replaceChildren();
      popover.scrollTop = 0;
    }

    function hide() {
      popover.hidden = true;
      form.classList.remove("show-suggestions");
      input.setAttribute("aria-expanded", "false");
      feedback.textContent = "";
      resetOptions();
    }

    function status(kind, message) {
      resetOptions();
      note.hidden = false;
      note.textContent = message || messages[kind];
      settings.hidden = kind !== "offline" || !onSettings;
      feedback.textContent = note.textContent;
      open();
    }

    function show(results) {
      if (!results.length) { status("empty"); return; }
      resetOptions();
      note.hidden = settings.hidden = true;
      items = results.slice(0, 5);
      items.forEach((item, index) => {
        const row = template.content.firstElementChild.cloneNode(true);
        row.id = "search-place-" + index;
        row.dataset.index = index;
        row.querySelector("strong").textContent = item.title;
        const subtitle = row.querySelector("small");
        subtitle.textContent = item.subtitle || "";
        subtitle.hidden = !subtitle.textContent;
        list.append(row);
      });
      const count = items.length;
      feedback.textContent = t(count + " 个匹配地点", count + (count === 1 ? " place found" : " places found"));
      open();
    }

    function move(step) {
      if (!items.length) return false;
      if (active >= 0) list.children[active].setAttribute("aria-selected", "false");
      if (active < 0) active = step > 0 ? 0 : items.length - 1;
      else active = (active + step + items.length) % items.length;
      const row = list.children[active];
      row.setAttribute("aria-selected", "true");
      input.setAttribute("aria-activedescendant", row.id);
      row.scrollIntoView({block:"nearest"});
      return true;
    }

    function choose(index = active < 0 ? 0 : active) {
      if (!items[index]) return false;
      onSelect(items[index]);
      return true;
    }

    list.addEventListener("pointerdown", event => {
      if (event.button === 0) event.preventDefault();
    });
    list.addEventListener("click", event => {
      const row = event.target.closest('[role="option"]');
      if (row) choose(Number(row.dataset.index));
    });
    settings.addEventListener("click", () => onSettings?.());
    window.visualViewport?.addEventListener("resize", fitViewport);
    window.addEventListener("resize", fitViewport);
    return {show, status, hide, move, choose, isOpen: () => !popover.hidden};
  }

  window.atlasSuggestions = {mount};
})();
