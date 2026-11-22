(() => {
  "use strict";
  const key = "aina.language";
  const url = new URL(window.location.href);
  const supported = value => value === "en" || value === "zh-CN";
  const requested = url.searchParams.get("lang");
  let saved;
  try { saved = localStorage.getItem(key); } catch { /* URLs work without storage. */ }
  const lang = supported(requested) ? requested : supported(saved) ? saved : "zh-CN";
  if (supported(requested) && saved !== lang) {
    try { localStorage.setItem(key, lang); } catch { /* A shared link is sufficient. */ }
  }

  const en = lang === "en";
  window.atlasLocale = Object.freeze({lang, en, t: (chinese, english) => en ? english : chinese});
  document.documentElement.lang = lang;
  if (en) {
    for (const node of document.querySelectorAll("[data-en]")) node.textContent = node.dataset.en;
    for (const attr of ["aria-label", "placeholder", "title"]) {
      for (const node of document.querySelectorAll(`[data-en-${attr}]`)) {
        node.setAttribute(attr, node.getAttribute(`data-en-${attr}`));
      }
    }
  }

  const link = document.getElementById("language-switch");
  if (!link) return;
  const next = en ? "zh-CN" : "en";
  url.searchParams.set("lang", next);
  link.href = url.href;
  link.lang = link.hreflang = next;
  link.textContent = en ? "中文" : "EN";
  link.title = en ? "Switch to Chinese" : "切换为英文";
  link.setAttribute("aria-label", en ? "Switch to Chinese · 中文" : "切换为英文 · English");
  link.addEventListener("click", event => {
    if (event.button === 0 && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
      window.dispatchEvent(new CustomEvent("aina-language-changing", {detail: {lang: next}}));
    }
  });
})();
