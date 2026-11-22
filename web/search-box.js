(() => {
  "use strict";

  function mount({input, onPlace, onSettings}) {
    const session = window.atlasPlaceSearch.createSession();
    const menu = window.atlasSuggestions.mount({onSelect: select, onSettings});
    const form = input.form, popover = document.getElementById("search-popover");
    let revision = 0, timer = 0, composing = false, phase = "idle", chooseWhenReady = false;
    const inSearch = node => !!node && (form.contains(node) || popover.contains(node));

    function invalidate() {
      clearTimeout(timer);
      chooseWhenReady = false;
      return ++revision;
    }
    function dismiss() {
      invalidate();
      phase = "idle";
      menu.hide();
      session.reset();
    }
    function update() {
      const text = input.value.trim();
      if (!text || composing) { dismiss(); return; }
      const id = invalidate();
      const basemap = window.atlasMap.getBasemapState();
      if (basemap !== "google") {
        session.reset();
        phase = basemap === "loading" ? "connecting" : "offline";
        menu.status(phase);
        return;
      }
      phase = "loading";
      menu.status(phase);
      timer = setTimeout(async () => {
        try {
          const results = await session.suggest(text, window.atlasMap.getSearchBias());
          if (revision !== id) return;
          phase = results.length ? "results" : "empty";
          if (!results.length) menu.status("empty");
          else {
            menu.show(results);
            if (chooseWhenReady) menu.choose();
          }
        } catch {
          if (revision === id) { phase = "error"; menu.status(phase); }
        }
      }, 250);
    }
    async function select(item) {
      if (phase !== "results") return;
      const id = invalidate();
      phase = "opening";
      menu.status(phase);
      try {
        const place = await session.select(item);
        if (revision !== id) return;
        if (!place) throw new Error("Place unavailable");
        dismiss();
        input.value = "";
        input.blur();
        onPlace(place);
      } catch {
        if (revision === id) { phase = "error"; menu.status(phase); }
      }
    }
    input.addEventListener("focus", update);
    input.addEventListener("compositionstart", () => { composing = true; dismiss(); });
    input.addEventListener("compositionend", () => { composing = false; update(); });
    input.addEventListener("input", event => { if (!event.isComposing && !composing) update(); });
    input.addEventListener("keydown", event => {
      if (event.isComposing || composing || event.keyCode === 229) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        dismiss();
        input.blur();
      } else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && input.value.trim()) {
        event.preventDefault();
        if (phase === "results") menu.move(event.key === "ArrowDown" ? 1 : -1);
        else if (phase === "idle") update();
      }
    });
    form.addEventListener("submit", event => {
      event.preventDefault();
      if (composing || !input.value.trim() || phase === "opening") return;
      if (phase === "results") { menu.choose(); return; }
      if (phase !== "loading") update();
      chooseWhenReady = phase === "loading";
    });
    function outside(event) {
      if (phase !== "idle" && !inSearch(event.target)) dismiss();
    }
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside);
    form.addEventListener("focusout", event => {
      if (event.relatedTarget && !inSearch(event.relatedTarget)) dismiss();
    });
    window.addEventListener("blur", dismiss);
    window.addEventListener("atlas:basemap-state", () => {
      if (phase !== "idle" && document.activeElement === input) update();
    });
    window.addEventListener("atlas:streetview-state", event => {
      if (event.detail.state === "open") { dismiss(); input.blur(); }
    });
  }
  window.atlasSearchBox = {mount};
})();
