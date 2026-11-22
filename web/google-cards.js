// Google Maps Places UI Kit renders and attributes its own place information.
// The Kyoto atlas keeps only the chosen Place IDs in memory for this page.
(() => {
  "use strict";

  const storageKey = "kyoto.google.browser-key";
  const projectKey = typeof window.AINA_CONFIG?.googleMapsBrowserKey === "string"
    ? window.AINA_CONFIG.googleMapsBrowserKey.trim() : "";
  let apiKey = projectKey;
  if (!apiKey) {
    try { apiKey = (sessionStorage.getItem(storageKey) || "").trim(); }
    catch { /* The map and local cards also work without session storage. */ }
  }
  let sdkPromise, attempt = 0, authError, billingConfirmed = false;
  let placeDenied = false, hadSuccessfulPlaceRequest = false;
  const libraries = new Map();
  const placeIds = new Map();
  const installations = new WeakMap();
  const actionIcons = {
    route: '<circle cx="6" cy="6" r="2.4"/><circle cx="18" cy="18" r="2.4"/><path d="M8.4 6H15a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h6.5"/>',
    website: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c4 4 4 13 0 17-4-4-4-13 0-17Z"/>'
  };
  const previousAuthFailure = window.gm_authFailure;
  function explicitBillingError(value) {
    const fields = [value, value?.error, value?.detail, value?.detail?.error];
    return fields.some(field => {
      const messages = typeof field === "string" ? [field] : [field?.code, field?.reason, field?.message];
      return messages.some(text => typeof text === "string" &&
        /\b(?:(?:Client)?BillingNotEnabledMapError|BILLING_DISABLED|BILLING_NOT_ENABLED|you have not enabled billing on your project|you must enable billing on the google cloud project)\b/i.test(text));
    });
  }
  function rememberAuthFailure(billing) {
    const changed = !authError || (billing && !billingConfirmed);
    billingConfirmed ||= billing;
    authError ||= new Error("Google Maps authorization denied");
    if (changed) {
      window.dispatchEvent(new CustomEvent("aina-google-auth-error", {
        detail: {reason: billingConfirmed ? "billing-disabled" : "authorization-denied"}
      }));
    }
  }
  function reportGoogleError(error) {
    if (!explicitBillingError(error)) return false;
    rememberAuthFailure(true);
    return true;
  }
  window.gm_authFailure = (...args) => {
    rememberAuthFailure(args.some(explicitBillingError));
    if (typeof previousAuthFailure === "function") previousAuthFailure(...args);
  };

  // This optional local diagnostic belongs to the configured key. It is a prior
  // observation and never prevents an SDK request on a fresh page.
  function billingStatus() {
    if (billingConfirmed) return "confirmed";
    if (projectKey && !hadSuccessfulPlaceRequest &&
        window.AINA_CONFIG.googleMapsLastDiagnostic === "billing-disabled") return "previous";
    return "";
  }
  function appendBillingHelp(target) {
    const status = billingStatus();
    if (!status) return false;
    const billing = document.createElement("a");
    billing.href = "https://console.cloud.google.com/billing";
    billing.target = "_blank";
    billing.rel = "noopener noreferrer";
    billing.textContent = "Google Cloud 结算";
    const text = status === "confirmed" ? "Google 已确认当前项目未启用结算。" : "上次检查时，Google 确认此密钥所属项目未启用结算。";
    target.append(text + "请在 ", billing, " 中为该项目关联有效的结算账号，然后刷新页面重试。");
    return true;
  }

  function loadSdk() {
    if (window.google?.maps?.importLibrary) return Promise.resolve(window.google.maps);
    if (sdkPromise) return sdkPromise;
    sdkPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      const url = new URL("https://maps.googleapis.com/maps/api/js");
      const callback = "__ainaGoogleMapsReady" + (++attempt);
      const denied = () => finish(authError);
      let completed = false;
      function finish(error) {
        if (completed) return;
        completed = true;
        clearTimeout(timeout);
        window.removeEventListener("aina-google-auth-error", denied);
        delete window[callback];
        if (error) {
          script.remove();
          reject(error);
        } else {
          resolve(window.google.maps);
        }
      }
      const timeout = setTimeout(() => finish(new Error("Maps SDK timeout")), 14000);
      window.addEventListener("aina-google-auth-error", denied);
      window[callback] = () => {
        finish(window.google?.maps?.importLibrary ? null : new Error("Maps SDK unavailable"));
      };
      url.search = new URLSearchParams({ key: apiKey, callback, loading: "async", v: "weekly", language: "zh-CN", region: "JP" });
      script.async = true;
      script.onerror = () => finish(new Error("Maps SDK unavailable"));
      script.src = url.href;
      document.head.append(script);
    }).catch(error => {
      sdkPromise = undefined;
      throw error;
    });
    return sdkPromise;
  }

  function load(name) {
    if (!["maps", "places", "routes"].includes(name)) return Promise.reject(new Error("Unknown Maps library"));
    if (!apiKey || authError) return Promise.reject(authError || new Error("Google Maps key missing"));
    if (libraries.has(name)) return libraries.get(name);
    let timer, denied;
    const library = new Promise((resolve, reject) => {
      denied = () => reject(authError);
      timer = setTimeout(() => reject(new Error("Maps library timeout")), 20000);
      window.addEventListener("aina-google-auth-error", denied);
      loadSdk().then(maps => {
        if (authError) throw authError;
        return maps.importLibrary(name);
      }).then(resolve, reject);
    }).finally(() => {
      clearTimeout(timer);
      window.removeEventListener("aina-google-auth-error", denied);
    }).catch(error => {
      libraries.delete(name);
      reportGoogleError(error);
      throw error;
    });
    libraries.set(name, library);
    return library;
  }

  function placementQuery(place) {
    const name = place.local || place.en || place.name;
    return "日本 京都府 京都市 東山区 " + name;
  }

  function updateActions(host, actions, externalTitle) {
    const record = installations.get(host);
    if (!record) return false;
    record.actions = actions;
    if (record.externalTitle !== externalTitle) {
      record.externalTitle = externalTitle;
      record.refreshName?.();
    }
    record.refreshActions?.();
    return true;
  }

  function mount(host, place, {compact = false, onStatus, actions, externalTitle = false} = {}) {
    if (!apiKey || !host || !place?.id) return false;
    const previous = installations.get(host);
    if (previous && previous.id === place.id && previous.compact === compact) {
      updateActions(host, actions, externalTitle);
      return true;
    }
    previous?.cancel();
    const lifetime = new AbortController();
    let timer = 0, currentWidget;
    const record = {
      id: place.id,
      compact, actions, externalTitle,
      cancel() { clearTimeout(timer); lifetime.abort(); },
      denied() { fail("Google Maps 已拒绝连接。", true, true); }
    };
    installations.set(host, record);
    const active = () => host.isConnected && installations.get(host) === record && !lifetime.signal.aborted;
    function status(value) {
      host.dataset.googleState = value;
      onStatus?.(value);
    }
    function message(text) {
      const line = document.createElement("p");
      line.className = "google-card-message";
      line.setAttribute("role","status");
      line.textContent = text;
      return line;
    }
    function fail(note, showSettings = false, globalDenial = false) {
      if (!host.isConnected || installations.get(host) !== record || (!globalDenial && !active())) return;
      record.cancel();
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "google-card-retry";
      retry.textContent = showSettings ? "查看连接设置" : "重试";
      retry.onclick = () => {
        if (showSettings) { window.atlasPlaceCard?.settings(); return; }
        installations.delete(host);
        mount(host, place, {compact, onStatus, actions:record.actions, externalTitle:record.externalTitle});
      };
      const line = message(note);
      if (showSettings && !appendBillingHelp(line)) {
        line.append("请检查项目结算、API 启用状态和网站来源限制。");
      }
      host.replaceChildren(line, retry);
      status("error");
    }
    function timeout() {
      clearTimeout(timer);
      timer = setTimeout(() => fail("Google Maps 暂未响应。"), 16000);
    }
    function watch(widget, loaded) {
      currentWidget = widget;
      timeout();
      widget.addEventListener("gmp-error", event => {
        if (!active() || currentWidget !== widget) return;
        placeDenied = true;
        if (!reportGoogleError(event)) {
          fail("Google 拒绝了这次地点请求。", true);
          window.dispatchEvent(new Event("aina-google-place-status"));
        }
      }, {signal:lifetime.signal});
      widget.addEventListener("gmp-load", () => {
        if (!active() || currentWidget !== widget) return;
        clearTimeout(timer);
        hadSuccessfulPlaceRequest = true;
        if (placeDenied) {
          placeDenied = false;
          window.dispatchEvent(new Event("aina-google-place-status"));
        }
        loaded();
      }, {signal:lifetime.signal});
    }
    function content(parent, fields) {
      for (const type of fields) {
        const field = document.createElement("gmp-place-" + type);
        if (type === "media") {
          field.setAttribute("lightbox-preferred", "");
          field.setAttribute("preferred-size", "large");
        }
        parent.append(field);
      }
    }
    function addActions(widget) {
      let route, website;
      function button(kind, handle) {
        const control = document.createElement("gmp-place-button");
        control.slot = "action-main";
        control.dataset.placeAction = kind;
        const icon = document.createElement("span");
        icon.slot = "icon-start";
        icon.setAttribute("aria-hidden", "true");
        icon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" style="display:block">' + actionIcons[kind] + '</svg>';
        control.append(icon);
        control.addEventListener("gmp-click", () => {
          if (active() && currentWidget === widget) handle(record.actions);
        }, {signal:lifetime.signal});
        widget.append(control);
        return control;
      }
      function label(control, text) {
        if (control.getAttribute("label") !== text) {
          control.setAttribute("label", text);
          control.setAttribute("action-aria-label", text);
        }
      }
      record.refreshActions = () => {
        const next = record.actions;
        if (typeof next?.onRoute === "function") {
          route ??= button("route", current => {
            if (!current?.routeDisabled) current?.onRoute?.();
          });
          label(route, next.routeLabel || "加入路线");
          route.setAttribute("aria-disabled", String(Boolean(next.routeDisabled)));
        } else if (route) {
          route.remove();
          route = undefined;
        }
        if (typeof next?.onWebsite === "function") {
          if (!website) {
            website = button("website", current => current?.onWebsite?.());
            label(website, "官网");
          }
        } else if (website) {
          website.remove();
          website = undefined;
        }
      };
      record.refreshActions();
    }
    function showDetails(id) {
      if (!id || !active()) return;
      const widget = document.createElement(compact ? "gmp-advanced-place-details-compact" : "gmp-advanced-place-details");
      if (compact) widget.setAttribute("orientation","vertical");
      const request = document.createElement("gmp-place-details-place-request");
      request.setAttribute("place", id);
      widget.append(request);
      content(widget, compact
        ? ["media","type","address","rating","open-now-status","attribution"]
        : ["media","type","address","rating","opening-hours","attribution"]);
      record.refreshName = () => {
        const name = widget.querySelector("gmp-place-name");
        if (record.externalTitle) name?.remove();
        else if (!name) content(widget, ["name"]);
      };
      record.refreshName();
      if (!compact && place.dynamic && !place.url) content(widget, ["website"]);
      addActions(widget);
      watch(widget, () => {
        placeIds.set(place.id, id);
        status("ready");
        if (place.dynamic) {
          const data = window.atlasSavedPlaces.widgetPlace(widget.place);
          if (data?.placeId === id) {
            if (typeof widget.place.websiteURI === "string") {
              try {
                const url = new URL(widget.place.websiteURI);
                if (url.protocol === "https:" && !url.username && !url.password) data.website = url.href;
              } catch { /* The provider's website field is optional. */ }
            }
            window.dispatchEvent(new CustomEvent("aina-google-detail-loaded", {detail: data}));
          }
        }
      });
      host.replaceChildren(widget);
    }
    function search() {
      const widget = document.createElement("gmp-advanced-place-search");
      widget.setAttribute("selectable","");
      const request = document.createElement("gmp-place-text-search-request");
      request.setAttribute("max-result-count","3");
      // These curated stops are all in Higashiyama. Limit results to the immediate
      // neighborhood so similarly named places and other café branches stay out.
      const {lat, lng} = place;
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        request.setAttribute("location-restriction", (lat-0.0045) + "," + (lng-0.0055) + "|" + (lat+0.0045) + "," + (lng+0.0055));
      }
      request.setAttribute("text-query", placementQuery(place));
      widget.append(request);
      const item = document.createElement("template");
      item.slot = "details-item";
      content(item.content, ["name","address","attribution"]);
      widget.append(item);
      const choices = document.createElement("div");
      // UI Kit starts its search when the widget intersects the viewport.
      choices.style.cssText = "height:1px; overflow:hidden; opacity:0";
      choices.inert = true;
      choices.append(widget);
      const hint = message("正在匹配这个地点…");
      watch(widget, () => {
        const results = widget.places || [];
        if (!results.length) { fail("Google Maps 未找到附近的匹配地点。"); return; }
        if (results.length === 1) { showDetails(results[0].id); return; }
        hint.textContent = "请选择对应的 Google 地点";
        choices.style.cssText = "";
        choices.inert = false;
      });
      widget.addEventListener("gmp-select", event => {
        if (currentWidget === widget) showDetails(event.place?.id);
      }, {signal:lifetime.signal});
      host.replaceChildren(hint, choices);
    }

    host.replaceChildren(message("正在连接 Google Maps…"));
    status("loading");
    timeout();
    load("places").then(() => {
      if (!active()) return;
      const id = place.googlePlaceId || placeIds.get(place.id);
      if (id) showDetails(id);
      else search();
    }).catch(() => {
      if (authError) record.denied();
      else fail("无法连接 Google Maps，请检查网络后重试。");
    });
    return true;
  }

  window.addEventListener("aina-google-auth-error", () => {
    for (const host of document.querySelectorAll("[data-google-state]")) {
      installations.get(host)?.denied();
    }
  });
  window.atlasGoogle = {
    configure(key) {
      const next = projectKey || (typeof key === "string" ? key.trim() : "");
      const newlyConfigured = !apiKey && Boolean(next);
      apiKey = next;
      if (newlyConfigured) window.dispatchEvent(new Event("aina-google-configured"));
    },
    load, mount, updateActions, reportGoogleError, billingStatus, appendBillingHelp,
    isConfigured() { return Boolean(apiKey); },
    hasAuthError() { return Boolean(authError); },
    hasPlaceDenial() { return placeDenied; },
    keySource() { return projectKey ? "project" : apiKey ? "session" : "none"; }
  };
})();
