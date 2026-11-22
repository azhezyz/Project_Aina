(() => {
  "use strict";
  const key = "aina.map-layers.v1";
  const types = Object.freeze(["roadmap", "satellite", "terrain"]);
  const defaults = Object.freeze({
    type: "roadmap",
    labels: Object.freeze({
      master: true, business: true, attractions: true, transit: true, roads: true,
      routeNames: true, stopNames: true
    })
  });

  function read() {
    let saved;
    try { saved = JSON.parse(localStorage.getItem(key)); } catch { /* Use defaults. */ }
    const labels = {...defaults.labels};
    for (const name of Object.keys(labels)) {
      if (typeof saved?.labels?.[name] === "boolean") labels[name] = saved.labels[name];
    }
    return {type: types.includes(saved?.type) ? saved.type : defaults.type, labels};
  }

  function save(prefs) {
    try { localStorage.setItem(key, JSON.stringify(prefs)); return true; }
    catch { return false; }
  }

  window.atlasLayerPrefs = {types, defaults, read, save};
})();
