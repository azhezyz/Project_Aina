(() => {
  "use strict";

  const labelFeatures = {
    business: ["poi.business"],
    attractions: ["poi.attraction", "poi.park", "poi.place_of_worship"],
    transit: ["transit"],
    roads: ["road"]
  };

  function options({type, labels}) {
    const hidden = labels.master
      ? Object.keys(labelFeatures).filter(key => !labels[key]).flatMap(key => labelFeatures[key])
      : ["all"];
    return {
      mapTypeId: type === "satellite" && labels.master ? "hybrid" : type,
      styles: hidden.map(featureType => ({featureType, elementType:"labels", stylers:[{visibility:"off"}]})),
      clickableIcons: labels.master
    };
  }

  function update(map, previous, next) {
    const before = options(previous), after = options(next), changes = {};
    if (before.mapTypeId !== after.mapTypeId) changes.mapTypeId = after.mapTypeId;
    if (before.clickableIcons !== after.clickableIcons) changes.clickableIcons = after.clickableIcons;
    if (before.styles.length !== after.styles.length ||
        after.styles.some((style, i) => style.featureType !== before.styles[i].featureType)) {
      changes.styles = after.styles;
    }
    if (Object.keys(changes).length) map.setOptions(changes);
  }

  function streetView(map) {
    let state = "closed", current = null, viewer, service, visibilityListener;
    function announce(next) {
      if (state === next) return;
      state = next;
      window.dispatchEvent(new CustomEvent("atlas:streetview-state", {detail:{state}}));
    }
    function finish(job, result) {
      if (current !== job) return;
      current = null;
      clearTimeout(job.timer);
      announce(result === "open" ? "open" : "closed");
      job.resolve(result);
    }
    function close() {
      if (current) finish(current, "cancelled");
      if (viewer?.getVisible()) viewer.setVisible(false);
      announce("closed");
    }
    function escape(event) {
      if (event.key !== "Escape" || state === "closed") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
    }
    async function find(job, location) {
      try {
        const {StreetViewService} = await window.atlasGoogle.load("streetView");
        if (current !== job) return;
        service ??= new StreetViewService();
        const {data} = await service.getPanorama({location, radius:100, preference:"nearest", sources:["google", "outdoor"]});
        if (current !== job) return;
        const pano = data?.location?.pano;
        if (!pano) { finish(job, "unavailable"); return; }
        if (!viewer) {
          viewer = map.getStreetView();
          viewer.setOptions({enableCloseButton:true, fullscreenControl:false});
          visibilityListener = viewer.addListener("visible_changed", () => {
            if (!viewer.getVisible() && state === "open") announce("closed");
          });
        }
        viewer.setPano(pano);
        const direction = data.links?.find(link => Number.isFinite(link?.heading));
        if (direction) viewer.setPov({heading:direction.heading, pitch:0});
        viewer.setVisible(true);
        finish(job, "open");
      } catch (error) {
        if (current !== job) return;
        const noImagery = error?.code === "ZERO_RESULTS" || /\bZERO_RESULTS\b/.test(String(error));
        finish(job, noImagery ? "unavailable" : "error");
      }
    }
    function open() {
      if (state === "open") return Promise.resolve("open");
      if (current) return current.promise;
      const location = map.getCenter();
      if (!location) return Promise.resolve("unavailable");
      let resolve;
      const promise = new Promise(done => { resolve = done; });
      const job = {promise, resolve, timer:0};
      current = job;
      job.timer = setTimeout(() => finish(job, "error"), 20000);
      announce("loading");
      void find(job, location);
      return promise;
    }
    document.addEventListener("keydown", escape, true);
    return {open, close, state:() => state, dispose() {
      close();
      document.removeEventListener("keydown", escape, true);
      visibilityListener?.remove();
    }};
  }

  window.atlasGoogleAppearance = {options, update, streetView};
})();
