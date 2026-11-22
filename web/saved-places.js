(() => {
  "use strict";
  const {t} = window.atlasLocale;
  const all = window.atlasData.places;
  const pendingName = t("待命名地点", "Unnamed place");
  const byId = new Map(all.map(p => [p.id, p]));
  const byGoogleId = new Map(all.filter(p => p.googlePlaceId).map(p => [p.googlePlaceId, p]));
  const nameRequests = new Map();
  const coordinateLifetime = 30 * 24 * 60 * 60 * 1000;
  let nextNumber = 1;
  const validLocation = (lat, lng) => Number.isFinite(lat) && Math.abs(lat) <= 90 &&
    Number.isFinite(lng) && Math.abs(lng) <= 180;
  const validId = id => typeof id === "string" && id.trim() === id && id.length > 0;
  const text = value => typeof value === "string" ? value.trim().slice(0, 120) : "";
  const fresh = time => Number.isFinite(time) && time <= Date.now() && time > Date.now() - coordinateLifetime;
  function applyName(place) {
    const googleMapVisible = window.atlasMap?.getBasemapState() === "google";
    place.providerName = (googleMapVisible && place.apiName) || place.widgetName || "";
    place.name = place.label || place.providerName || pendingName;
    if (place.apiPosition) {
      if (googleMapVisible && fresh(place.locatedAt)) Object.assign(place, place.apiPosition);
      else { delete place.lat; delete place.lng; }
    }
  }
  function refreshNames() {
    for (const place of all) if (place.dynamic) applyName(place);
  }
  function needsLookup(place, retry = false) {
    if (!place?.dynamic || window.AINA_CONFIG?.googlePlaceNamesEnabled !== true ||
        window.atlasMap?.getBasemapState() !== "google") return false;
    const status = nameRequests.get(place.id);
    return status !== "pending" && (status !== "failed" || retry) &&
      ((!place.label && !place.widgetName && !place.apiName) || !validLocation(place.lat, place.lng));
  }
  async function resolveName(place, retry = false) {
    if (!needsLookup(place, retry)) return;
    const needsName = () => !place.label && !place.widgetName && !place.apiName;
    const needsPosition = () => !validLocation(place.lat, place.lng);
    nameRequests.set(place.id, "pending");
    let locationChanged = false;
    try {
      const {Place} = await window.atlasGoogle.load("places");
      const fields = [];
      if (needsName()) fields.push("displayName");
      if (needsPosition()) fields.push("location");
      if (window.atlasMap?.getBasemapState() !== "google" || !fields.length) {
        nameRequests.delete(place.id);
        return;
      }
      const result = new Place({id: place.googlePlaceId, requestedLanguage: window.atlasLocale.lang});
      await result.fetchFields({fields});
      if (fields.includes("displayName") && text(result.displayName)) place.apiName = text(result.displayName);
      if (fields.includes("location") && result.location && !fresh(place.locatedAt)) {
        const point = result.location.toJSON();
        if (validLocation(point.lat, point.lng)) {
          place.locatedAt = Date.now();
          place.apiPosition = {lat: point.lat, lng: point.lng};
          locationChanged = true;
        }
      }
      if (needsName() || (needsPosition() && !place.apiPosition)) throw new Error("Requested field unavailable");
      nameRequests.delete(place.id);
    } catch {
      nameRequests.set(place.id, "failed");
    }
    applyName(place);
    window.dispatchEvent(new CustomEvent("aina-place-name-updated", {detail: {id: place.id, locationChanged}}));
  }

  function widgetPlace(place) {
    const position = place?.location;
    const lat = typeof position?.lat === "function" ? position.lat() : position?.lat;
    const lng = typeof position?.lng === "function" ? position.lng() : position?.lng;
    if (!validId(place?.id)) return null;
    const result = {placeId: place.id};
    if (validLocation(lat, lng)) Object.assign(result, {lat, lng});
    if (text(place.displayName)) result.name = text(place.displayName);
    return result;
  }
  function register(data, {fromWidget = false, fromPlaces = false, number} = {}) {
    if (!validId(data?.placeId)) return null;
    let place = byGoogleId.get(data.placeId);
    if (place && !place.dynamic) return place;
    if (!place) {
      const serial = Number.isSafeInteger(number) && number > 0 && number < Number.MAX_SAFE_INTEGER ? number : nextNumber;
      nextNumber = Math.max(nextNumber, serial + 1);
      place = {id: "google:" + data.placeId, googlePlaceId: data.placeId, dynamic: true,
        number: serial, kind: t("Google 地点", "Google place"), name: pendingName};
      byGoogleId.set(data.placeId, place);
      byId.set(place.id, place);
      all.push(place);
    }
    const name = text(data.name);
    if (name && fromPlaces) place.apiName = name;
    else if (name) place.widgetName = name;
    if (validLocation(data.lat, data.lng)) {
      // A map click can be offset from the actual POI. Prefer its UI Kit location.
      if (fromPlaces) {
        if (place.apiPosition || !fresh(place.locatedAt)) {
          place.apiPosition = {lat:data.lat, lng:data.lng};
          place.locatedAt = Date.now();
        }
      } else if (fromWidget || !fresh(place.locatedAt)) {
        place.lat = data.lat;
        place.lng = data.lng;
        delete place.apiPosition;
        if (fromWidget) place.locatedAt = Date.now();
        else delete place.locatedAt;
      }
    }
    applyName(place);
    return place;
  }
  function label(place, value) {
    place.label = text(value);
    applyName(place);
  }
  function restore(records) {
    if (!Array.isArray(records)) return false;
    let cleanup = false;
    for (const record of records) {
      const place = register({placeId: record?.placeId}, {number: record?.number});
      if (!place?.dynamic) { cleanup = true; continue; }
      label(place, record.label);
      if (validLocation(record.lat, record.lng) && fresh(record.locatedAt)) {
        place.locatedAt = record.locatedAt;
        const position = {lat: record.lat, lng: record.lng};
        if (record.locationSource === "places") {
          place.apiPosition = position;
          applyName(place);
        } else Object.assign(place, position);
      } else if ("lat" in record || "lng" in record || "locatedAt" in record) cleanup = true;
    }
    return cleanup;
  }
  function recoverReferences(routes, pins) {
    let recovered = false;
    function repair(ids) {
      if (!Array.isArray(ids)) return;
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        if (typeof id !== "string" || !id.startsWith("google:") || byId.has(id)) continue;
        const place = register({placeId: id.slice(7)});
        if (place) {
          // A previously saved Google place may now have a curated atlas ID.
          ids[i] = place.id;
          recovered = true;
        }
      }
    }
    if (Array.isArray(routes)) routes.forEach(r => repair(r?.stops));
    repair(pins);
    return recovered;
  }
  function expire() {
    const expired = [];
    for (const place of all) {
      if (place.dynamic && place.locatedAt && !fresh(place.locatedAt)) {
        delete place.lat; delete place.lng; delete place.locatedAt; delete place.apiPosition;
        nameRequests.delete(place.id);
        expired.push(place.id);
      }
    }
    return expired;
  }
  function snapshot(routes, pins) {
    const used = new Set([...pins, ...routes.flatMap(r => r.stops)]);
    return all.filter(p => p.dynamic && used.has(p.id)).map(p => {
      const record = {placeId: p.googlePlaceId, number: p.number};
      if (p.label) record.label = p.label;
      if (fresh(p.locatedAt)) {
        const point = p.apiPosition || p;
        Object.assign(record, {lat: point.lat, lng: point.lng, locatedAt: p.locatedAt});
        if (p.apiPosition) record.locationSource = "places";
      }
      return record;
    });
  }
  window.atlasSavedPlaces = {byId, widgetPlace, register, label, restore, recoverReferences, expire, snapshot, coordinateLifetime,
    refreshNames, needsLookup, resolveName, isLookupPending: place => nameRequests.get(place.id) === "pending"};
})();
