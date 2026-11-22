(() => {
  "use strict";
  window.renderKyotoRoadmap = async (bounds, labels) => {
    const {Map} = await window.atlasGoogle.load("maps");
    const {east, west, north, south} = bounds;
    const radians = Math.PI / 180;
    const mercator = lat => Math.asinh(Math.tan(lat * radians));
    const center = {lat: Math.atan(Math.sinh((mercator(north) + mercator(south)) / 2)) / radians,
      lng: (east + west) / 2};
    const zoom = Math.log2(innerWidth * 360 / ((east - west) * 256));
    const map = new Map(document.getElementById("roadmap"), {center, zoom,
      ...window.atlasGoogleAppearance.options({type:"roadmap", labels}),
      renderingType:"RASTER", isFractionalZoomEnabled:true, tilt:0, heading:0,
      disableDefaultUI:true, clickableIcons:false, gestureHandling:"none", keyboardShortcuts:false});
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Map tiles timed out")), 18000);
      map.addListener("tilesloaded", () => { clearTimeout(timer); resolve(); });
    });
    // The same spherical Mercator frame is used for the transparent route guide.
    const actual = map.getBounds()?.toJSON();
    if (!actual || Math.abs(actual.east-east) / (east-west) * innerWidth > 1.5 ||
        Math.abs(actual.west-west) / (east-west) * innerWidth > 1.5 ||
        Math.abs(mercator(actual.north)-mercator(north)) / (mercator(north)-mercator(south))*innerHeight > 1.5 ||
        Math.abs(mercator(actual.south)-mercator(south)) / (mercator(north)-mercator(south))*innerHeight > 1.5)
      throw new Error("Google camera does not align with route");
    let creditText = "";
    for (let i = 0; i < 40; i++) {
      const labels = Array.from(document.querySelectorAll("#roadmap .gm-style-cc"), e => e.innerText.trim());
      creditText = labels.filter(text => /©|ⓒ|copyright/i.test(text)).join(" · ");
      if (creditText) break;
      await new Promise(resolve => setTimeout(resolve, 120));
    }
    if (!creditText) throw new Error("Missing Google map data attribution");
    // The native credit can have text and a layout box while its web font is still invisible.
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return creditText;
  };
})();
