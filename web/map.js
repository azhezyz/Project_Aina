/* Kyoto walking map. Offline geometry © OpenStreetMap contributors (ODbL). */
(() => {
  "use strict";
  const {t, en} = window.atlasLocale;
  const FONT = '"Segoe UI","Microsoft YaHei UI","PingFang SC","Hiragino Sans",sans-serif';
  const BOUNDS = [-1450, -1200, 2260, 2840];
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const meterPoint = (lat, lng) => [(lng - 135.77) * 91300, (35.01 - lat) * 111000];
  const fonts = (size, weight=500) => weight + ' ' + size + 'px ' + FONT;
  // Tabler Icons, "walk". https://tabler.io/icons/icon/walk
  // MIT License: Copyright (c) 2020-2026 Paweł Kuna.
  // Permission is hereby granted, free of charge, to any person obtaining a copy
  // of this software and associated documentation files (the "Software"), to deal
  // in the Software without restriction, including without limitation the rights
  // to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
  // copies of the Software, and to permit persons to whom the Software is
  // furnished to do so, subject to the following conditions:
  // The above copyright notice and this permission notice shall be included in all
  // copies or substantial portions of the Software.
  // THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  // IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  // FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  // AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  // LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
  // OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
  // SOFTWARE.
  const walkingIcon = new Path2D('M12 4a1 1 0 1 0 2 0a1 1 0 1 0 -2 0 M7 21l3 -4 M16 21l-2 -4l-3 -3l1 -6 M6 12l2 -3l4 -1l3 3l3 1');
  let canvas, ctx, callbacks, places = [], placeById = new Map();
  let width = 0, height = 0, scale = 0.6, center = [900, 1180], bottom = 0, frame = 0;
  let routeList = [], activeId, selectedId, visible = new Set(), pinned = new Set();
  let layers, geometry, pathCache = new Map(), placeHits = [], lineHits = [], badgeHits = [], scheduled = false;
  let cameraRoutes = '', routeExtent = [300, 700, 1380, 1700];
  let resizeObserver, isDefault = true;
  let basemapState = 'offline', wantsGoogle = false, pendingGoogle = null;
  let googleHost = null, googleMap = null, nativeErrorObserver = null, pendingFocus = null;
  let nativeLayer = null, nativeSignature = '', focusedRouteId = null, focusedExtent = null;
  const googleListeners = [];
  let sheetHeight = 0, attributionGap = 0;
  const pointers = new Map();
  let gesture = null;

  // The offline geometry is encoded in local metres. Match its east-west
  // scale exactly and use Web Mercator for the north-south axis on Google.
  const radians = Math.PI / 180;
  const localRadius = 91300 / radians;
  const worldWidth = 91300 * 360;
  const scaleAtZoom = zoom => 256 * 2 ** zoom / worldWidth;
  const hasLocation = p => Number.isFinite(p?.lat) && Math.abs(p.lat) <= 90 &&
    Number.isFinite(p?.lng) && Math.abs(p.lng) <= 180;
  function projectY(y) {
    return basemapState === 'google'
      ? -localRadius * Math.asinh(Math.tan(clamp(35.01 - y/111000,-85.051129,85.051129) * radians))
      : y;
  }
  function unprojectY(y) {
    return basemapState === 'google'
      ? (35.01 - Math.atan(Math.sinh(-y/localRadius)) / radians) * 111000
      : y;
  }
  function cameraOptions() {
    return {
      center: {lat: 35.01 - center[1]/111000, lng: 135.77 + center[0]/91300},
      zoom: Math.log2(scale * worldWidth / 256)
    };
  }
  function moveGoogleCamera() {
    if (basemapState !== 'google' || !googleMap) return;
    try { googleMap.moveCamera(cameraOptions()); }
    catch { googleUnavailable(); }
  }
  function readGoogleCamera() {
    if (basemapState !== 'google' || !googleMap) return;
    const position = googleMap.getCenter(), zoom = googleMap.getZoom();
    if (!position || !Number.isFinite(zoom)) return;
    center = meterPoint(position.lat(),position.lng());
    scale = scaleAtZoom(zoom);
    changed();
  }
  function googleClick(event) {
    if (basemapState !== 'google') return;
    const point = event.latLng;
    if (event.placeId) {
      event.stop();
      callbacks?.onGooglePlace?.({placeId:event.placeId, lat:point?.lat(), lng:point?.lng()});
      return;
    }
  }
  function updateAttributionGap() {
    const sheet = document.getElementById('sheet');
    attributionGap = basemapState === 'google' && sheet ? parseFloat(getComputedStyle(sheet).bottom) || 0 : 0;
    bottom = sheetHeight + attributionGap;
  }
  function setBasemapState(state) {
    const previous = basemapState;
    basemapState = state;
    if (canvas) {
      canvas.parentElement.dataset.basemap = state;
      canvas.tabIndex = state === 'google' ? -1 : 0;
      if (state === 'google') canvas.setAttribute('aria-hidden', 'true');
      else canvas.removeAttribute('aria-hidden');
    }
    if (previous === state) return;
    updateAttributionGap();
    if (canvas && (state === 'google' || previous === 'google')) {
      updateRouteExtent();
      if (state === 'google') refreshNative();
      if (focusedRouteId && focusRoute(focusedRouteId)) {
        pendingFocus = null;
      } else if (state === 'google' && pendingFocus) {
        focusPlace(pendingFocus);
        pendingFocus = null;
      } else if (isDefault || (state !== 'google' && !insideOffline(center))) {
        isDefault = true;
        fitView();
      } else if (state === 'google') moveGoogleCamera();
      else {
        scale = clamp(scale,minScale(),4.5);
        boundCenter();
      }
    }
    if (state === 'offline' || state === 'error') pendingFocus = null;
    drawSoon();
    if (basemapState === state) window.dispatchEvent(new CustomEvent('atlas:basemap-state', {detail: {state}}));
  }
  function settleGoogle(state, discard = false) {
    const job = pendingGoogle;
    pendingGoogle = null;
    if (job) {
      clearTimeout(job.timer);
      job.listener?.remove();
    }
    if (discard || state === 'error' || (state === 'offline' && job)) {
      nativeErrorObserver?.disconnect();
      nativeErrorObserver = null;
      googleListeners.splice(0).forEach(listener => listener.remove());
      nativeLayer?.dispose();
      nativeLayer = null;
      nativeSignature = '';
      googleHost?.remove();
      googleMap = null;
      googleHost = null;
    } else if (googleHost) {
      googleHost.hidden = state !== 'google';
    }
    setBasemapState(state);
    job?.resolve(basemapState);
    return basemapState;
  }
  // The Map class may load watermarked tiles and then insert a native error
  // dialog without calling gm_authFailure. Check just this SDK-owned surface.
  const nativeErrorSelector = '.gm-err-container, .gm-err-content';
  const nativeErrorText = /^(?:此页面无法正确加载\s*Google\s*地图|此頁面無法正確載入\s*Google\s*地圖|This page (?:can(?:not|['’]t)) load Google Maps correctly|For development purposes only|仅供开发(?:用途|使用)|僅供開發(?:用途|使用))[。.!！]?$/iu;
  function isMapErrorText(node) {
    return node.parentElement?.matches('span, p, div, label, strong') &&
      nativeErrorText.test(node.nodeValue.trim());
  }
  function containsMapError(node) {
    if (node.nodeType === Node.TEXT_NODE) return isMapErrorText(node);
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    if (node.matches(nativeErrorSelector) || node.querySelector(nativeErrorSelector)) return true;
    const texts = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    while (texts.nextNode()) if (isMapErrorText(texts.currentNode)) return true;
    return false;
  }
  function watchNativeErrors(surface) {
    nativeErrorObserver = new MutationObserver(changes => {
      if (surface.parentNode !== googleHost) return;
      const failed = changes.some(change => {
        if (change.type === 'attributes') return change.target.matches(nativeErrorSelector);
        if (change.type === 'characterData') return containsMapError(change.target);
        return Array.from(change.addedNodes).some(containsMapError);
      });
      if (failed) googleUnavailable();
    });
    nativeErrorObserver.observe(surface, {
      childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class']
    });
  }
  async function buildGoogleMap(job) {
    try {
      const sdk = await window.atlasGoogle.load('maps');
      if (pendingGoogle !== job) return;
      googleHost = document.createElement('div');
      googleHost.className = 'atlas-google-basemap';
      const nativeSurface = document.createElement('div');
      googleHost.append(nativeSurface);
      canvas.before(googleHost);
      watchNativeErrors(nativeSurface);
      const camera = cameraOptions();
      googleMap = new sdk.Map(nativeSurface, {
        ...camera, mapTypeId: 'roadmap', renderingType: 'VECTOR', isFractionalZoomEnabled: true,
        disableDefaultUI: true, clickableIcons: true, gestureHandling: 'greedy',
        keyboardShortcuts: true, tilt: 0, heading: 0,
        tiltInteractionEnabled: false, headingInteractionEnabled: false
      });
      nativeLayer = window.atlasNativeMap.connect(googleMap,sdk,callbacks);
      // Remember the resting camera for the toolbar and offline fallback only.
      googleListeners.push(googleMap.addListener('idle', readGoogleCamera));
      googleListeners.push(googleMap.addListener('click', googleClick));
      const userMoved = () => { if (basemapState === 'google') manualView(); };
      googleListeners.push(googleMap.addListener('dragstart', userMoved));
      googleListeners.push(googleMap.addListener('dblclick', userMoved));
      nativeSurface.addEventListener('wheel', userMoved, {capture:true, passive:true});
      nativeSurface.addEventListener('touchstart', e => { if (e.touches.length > 1) userMoved(); }, {capture:true, passive:true});
      nativeSurface.addEventListener('keydown', e => {
        if (['+','=','-','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) userMoved();
      }, true);
      job.listener = googleMap.addListener('tilesloaded', () => {
        if (pendingGoogle === job) settleGoogle(containsMapError(nativeSurface) ? 'error' : 'google');
      });
    } catch {
      if (pendingGoogle === job) settleGoogle('error');
    }
  }
  function setGoogleBasemap(enabled = true) {
    wantsGoogle = Boolean(enabled);
    const configured = Boolean(window.atlasGoogle?.isConfigured?.());
    if (!wantsGoogle || !configured) {
      return Promise.resolve(settleGoogle('offline', !configured));
    }
    if (pendingGoogle) return pendingGoogle.promise;
    if (googleMap) {
      googleHost.hidden = false;
      setBasemapState('google');
      drawSoon();
      return Promise.resolve(basemapState);
    }
    if (!canvas || navigator.onLine === false) return Promise.resolve(settleGoogle('error'));
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    const job = {promise, resolve, timer: 0, listener: null};
    pendingGoogle = job;
    job.timer = setTimeout(() => {
      if (pendingGoogle === job) settleGoogle('error');
    }, 20000);
    setBasemapState('loading');
    buildGoogleMap(job);
    return promise;
  }
  function googleUnavailable() {
    if (googleMap || pendingGoogle) settleGoogle(wantsGoogle ? 'error' : 'offline', true);
  }
  window.addEventListener('aina-google-auth-error', googleUnavailable);
  window.addEventListener('aina-google-billing-error', googleUnavailable);
  window.addEventListener('offline', googleUnavailable);
  window.addEventListener('online', () => {
    if (wantsGoogle && basemapState === 'error') setGoogleBasemap();
  });

  function decode(encoded) {
    const points = [];
    let x=0, y=0, i=0;
    function number() {
      let v=0, bit=0, b;
      do { b=encoded.charCodeAt(i++)-63; v|=(b&31)<<bit; bit+=5; } while (b>=32);
      return (v&1) ? ~(v>>1) : (v>>1);
    }
    while (i<encoded.length) {
      x+=number(); y+=number(); points.push([x,y]);
    }
    return points;
  }

  function prepareLayers() {
    geometry = window.kyotoGeo;
    layers = {};
    for (const [kind, encoded] of Object.entries(geometry.layers)) {
      const groups = new Map();
      for (const feature of encoded) {
        const points = decode(feature);
        if (!points.length) continue;
        let x0=Infinity, y0=Infinity, x1=-Infinity, y1=-Infinity;
        for (const [x,y] of points) {
          x0=Math.min(x0,x); y0=Math.min(y0,y); x1=Math.max(x1,x); y1=Math.max(y1,y);
        }
        const key = Math.floor((x0+x1)/700) + ',' + Math.floor((y0+y1)/700);
        if (!groups.has(key)) groups.set(key,{path:new Path2D(),bounds:[Infinity,Infinity,-Infinity,-Infinity]});
        const {path,bounds}=groups.get(key);
        bounds[0]=Math.min(bounds[0],x0);bounds[1]=Math.min(bounds[1],y0);
        bounds[2]=Math.max(bounds[2],x1);bounds[3]=Math.max(bounds[3],y1);
        path.moveTo(...points[0]);
        for (let n=1; n<points.length; n++) path.lineTo(...points[n]);
        if (['water','park','forest','building','shrine'].includes(kind)) path.closePath();
      }
      layers[kind]=Array.from(groups.values());
    }
    for (const [key,value] of Object.entries(geometry.paths)) pathCache.set(key,decode(value));
  }

  const districts = [
    [35.00195,135.77275,'祇 園','G I O N'],
    [34.99775,135.77445,'東 山 区','H I G A S H I Y A M A'],
    [34.99432,135.76680,'下 京 区','S H I M O G Y O'],
    [35.00834,135.77570,'白 川','S H I R A K A W A'],
    [35.00695,135.78470,'粟 田 口','A W A T A G U C H I'],
    [34.99220,135.77790,'馬 町','U M A M A C H I'],
    [35.00650,135.76355,'河 原 町','K A W A R A M A C H I'],
    [34.99076,135.78318,'阿 弥 陀 ヶ 峰','A M I D A G A M I N E']
  ];
  // Fixed label anchors let street and district names stay aligned with the basemap.
  const roadLabels = [
    [35.00380,135.77185,t('四条通','Shijo-dori'),1],[35.00368,135.77640,t('四条通','Shijo-dori'),0],
    [35.00049,135.77588,t('東大路通','Higashioji-dori'),-82],[35.00504,135.77778,t('東大路通','Higashioji-dori'),-80],
    [35.00054,135.77469,t('花見小路通','Hanamikoji-dori'),-86],[34.99920,135.77195,t('大和大路通','Yamato-oji-dori'),-86],
    [34.99669,135.77576,t('松原通','Matsubara-dori'),1],[34.99753,135.77989,t('八坂通','Yasaka-dori'),-2],
    [34.99058,135.77625,t('五条通','Gojo-dori'),-6],[35.00664,135.77321,t('新橋通','Shinbashi-dori'),5],
    [34.99627,135.78223,t('清水坂','Kiyomizu-zaka'),-7],[34.99473,135.77860,t('五条坂','Gojo-zaka'),-12],
    [35.00580,135.76966,t('川端通','Kawabata-dori'),-86],[34.99700,135.76892,t('川端通','Kawabata-dori'),-77],
    [34.99530,135.76472,t('河原町通','Kawaramachi-dori'),-82],[35.00061,135.76674,t('木屋町通','Kiyamachi-dori'),-82],
    [35.00849,135.77043,t('三条通','Sanjo-dori'),2],[35.00830,135.78001,t('三条通','Sanjo-dori'),1],
    [34.98583,135.77634,t('七条通','Shichijo-dori'),-6],[34.99653,135.76201,t('松原通','Matsubara-dori'),0]
  ];
  const contextLabels = [
    [35.00605,135.78207,t('知恩院','Chion-in'),'temple'],[35.00535,135.77189,t('祇園白川','Gion Shirakawa'),'street'],
    [34.99711,135.77626,t('六波羅蜜寺','Rokuharamitsu-ji'),'temple'],[35.00101,135.77134,t('宮川町','Miyagawacho'),'street'],
    [34.99190,135.77247,t('清水五条','Kiyomizu-Gojo'),'train'],[35.00366,135.77113,t('祇園四条','Gion-Shijo'),'train'],
    [35.01000,135.78335,t('青蓮院','Shoren-in'),'temple'],[34.99640,135.78447,t('地主神社','Jishu Shrine'),'shrine'],
    [34.98877,135.78286,t('京都女子大学',"Kyoto Women's University"),'school'],[35.01150,135.78081,t('東山','Higashiyama Station'),'train'],
    [35.01170,135.78581,t('岡崎公園','Okazaki Park'),'park'],[34.99083,135.77287,t('豊国神社','Toyokuni Shrine'),'shrine']
  ];
  const riverLabels = [
    [35.0011,135.77055],[34.9933,135.76788],[35.0090,135.77220]
  ];

  function pt(x,y) {
    return [width/2+(x-center[0])*scale,height/2+(y-center[1])*scale];
  }
  const loc = (lat,lng) => pt(...meterPoint(lat,lng));
  const onscreen = (x,y,pad=12) => x>=-pad && x<=width+pad && y>=-pad && y<=height+pad;

  const insideOffline = ([x,y]) => x>=BOUNDS[0] && x<=BOUNDS[2] && y>=BOUNDS[1] && y<=BOUNDS[3];
  function minScale() {
    return basemapState === 'google' ? scaleAtZoom(0) :
      Math.max(0.18,width/(BOUNDS[2]-BOUNDS[0]),height/(BOUNDS[3]-BOUNDS[1]));
  }
  function boundCenter() {
    if (basemapState === 'google') return;
    const hw=width/(2*scale), hh=height/(2*scale);
    center[0]=clamp(center[0],BOUNDS[0]+hw,BOUNDS[2]-hw);
    // A bottom sheet masks the south part of the map. Clamp its visible edge
    // so route endpoints still have label clearance above the sheet.
    center[1]=unprojectY(clamp(projectY(center[1]),projectY(BOUNDS[1])+hh,projectY(BOUNDS[3])-hh+bottom/scale));
  }

  function fitView(extent=routeExtent) {
    if (!width || !height) return;
    const compact=width<650;
    const top=compact?104:108;
    const foot=height-bottom-(compact?31:44);
    const padding=compact?26:Math.min(width*.10,132);
    const [west,north,east,south]=extent;
    const closeFit=extent===focusedExtent && (Math.abs(east-west)>1 || Math.abs(south-north)>1);
    const ideal=Math.min(Math.max(110,foot-top)/Math.max(closeFit?75:250,projectY(south)-projectY(north)),
      (width-padding*2)/Math.max(closeFit?75:300,east-west),closeFit?scaleAtZoom(19):1.05);
    scale=Math.max(minScale(),ideal);
    center[0]=(west+east)/2;
    center[1]=unprojectY((projectY(north)+projectY(south))/2+(height-top-foot)/(2*scale));
    boundCenter();
    moveGoogleCamera();
    drawSoon();
  }
  function resize() {
    const rect=canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    updateAttributionGap();
    const ratio=Math.min(window.devicePixelRatio || 1,2);
    const changed=width!==rect.width || height!==rect.height;
    width=rect.width; height=rect.height;
    if(canvas.width!==Math.round(width*ratio)) canvas.width=Math.round(width*ratio);
    if(canvas.height!==Math.round(height*ratio)) canvas.height=Math.round(height*ratio);
    if(changed && focusedExtent) fitView(focusedExtent);
    else if(changed && isDefault) fitView();
    else if (basemapState === 'google') readGoogleCamera();
    else {scale=Math.max(minScale(),scale);boundCenter();drawSoon();}
  }
  function drawSoon() {
    if(scheduled || !canvas || basemapState==='google') return;
    scheduled=true;
    frame=requestAnimationFrame(()=>{scheduled=false;draw();});
  }

  function basemap() {
    ctx.save();
    ctx.translate(width/2-center[0]*scale,height/2-center[1]*scale);ctx.scale(scale,scale);
    ctx.lineJoin='round';ctx.lineCap='round';
    const b=[center[0]-width/2/scale,center[1]-height/2/scale,center[0]+width/2/scale,center[1]+height/2/scale];
    function layer(name, color, weight=0) {
      if(weight){ctx.strokeStyle=color;ctx.lineWidth=weight;}
      else ctx.fillStyle=color;
      for(const item of layers[name] || []) {
        const [x,y,X,Y]=item.bounds;
        if(X<b[0]-25 || x>b[2]+25 || Y<b[1]-25 || y>b[3]+25) continue;
        if(weight) ctx.stroke(item.path); else ctx.fill(item.path);
      }
    }
    layer('shrine','#e5eade');layer('park','#dbe6d4');layer('forest','#cbdcc5');
    layer('stream','#b4cfce',3);layer('water','#aed3d3');
    layer('building','#e2e1d9');
    const hair=1/scale;
    layer('foot','#faf9f3',Math.max(hair,2.6));layer('lane','#fcfbf7',Math.max(hair*1.7,4.1));
    layer('street','#deded6',7.1+hair*.7);layer('street','#fdfcf9',7.1);
    layer('main','#d9d6cd',12+hair*1.25);layer('main','#fffdf7',12);
    layer('artery','#d7cfbb',15+hair*1.6);layer('artery','#fdf6df',15);
    ctx.restore();
  }

  function lineFor(a,b) {
    if(a===b)return [];
    const key=[a,b].sort().join('|');
    const row=pathCache.get(key);
    if(row)return a<b?row:row.slice().reverse();
    return networkLeg(a,b)?.points || [];
  }
  function networkLeg(a,b) {
    const from=placeById.get(a),to=placeById.get(b);
    const local=hasLocation(from) && hasLocation(to) ? window.atlasWalking?.leg(from,to) : null;
    return local || (basemapState==='google' && from && to ? window.atlasGoogleWalking?.leg(from,to) : null);
  }
  function hasLocalLeg(from,to) {
    if(!from || !to)return false;
    if(from.id===to.id || pathCache.has([from.id,to.id].sort().join('|')))return true;
    return hasLocation(from) && hasLocation(to) && Boolean(window.atlasWalking?.leg(from,to));
  }
  function meters(route) {
    let total=0;
    const stops=route?.stops || [];
    for (let i=1; i<stops.length; i++) {
      if (stops[i-1]===stops[i]) continue;
      const key=[stops[i-1],stops[i]].sort().join('|');
      const distance=window.kyotoGeo?.distances[key] ?? networkLeg(stops[i-1],stops[i])?.meters;
      if (!Number.isFinite(distance)) return null;
      total+=distance;
    }
    return total;
  }
  function routeParts(route) {
    const parts=[];
    let current=null;
    for(let i=1;i<route.stops.length;i++) {
      const a=route.stops[i-1],b=route.stops[i];
      if(a===b)continue;
      const line=lineFor(a,b);
      if(!line.length) current=null;
      else if(current && Math.hypot(current.at(-1)[0]-line[0][0],current.at(-1)[1]-line[0][1])<2) {
        for(let j=1;j<line.length;j++)current.push(line[j]);
      }
      else {current=line.slice();parts.push(current);}
    }
    return parts;
  }
  function extentForRoutes(shown) {
    const extent=[Infinity,Infinity,-Infinity,-Infinity];
    const xs=[];
    for(const route of shown) {
      const points=routeParts(route).flat();
      for(const id of route.stops) {
        const p=placeById.get(id);
        if(hasLocation(p))points.push(meterPoint(p.lat,p.lng));
      }
      for(const [x,y] of points) {
        if(basemapState!=='google' && !insideOffline([x,y]))continue;
        if(basemapState==='google')xs.push(x);
        extent[0]=Math.min(extent[0],x);extent[1]=Math.min(extent[1],y);
        extent[2]=Math.max(extent[2],x);extent[3]=Math.max(extent[3],y);
      }
    }
    // Fit stops on opposite sides of the date line along the shorter arc.
    if(xs.length && extent[2]-extent[0]>worldWidth/2) {
      xs.sort((a,b)=>a-b);
      let gap=xs[0]+worldWidth-xs.at(-1);
      for(let i=1;i<xs.length;i++) {
        if(xs[i]-xs[i-1]<=gap)continue;
        gap=xs[i]-xs[i-1];
        extent[0]=xs[i];extent[2]=xs[i-1]+worldWidth;
      }
    }
    return Number.isFinite(extent[0])?extent:null;
  }
  function updateRouteExtent() {
    const shown=routeList.filter(route=>visible.has(route.id));
    const version=basemapState==='google'?window.atlasGoogleWalking?.version:0;
    const signature=JSON.stringify([basemapState,version,shown.map(route=>[route.id,route.stops.map(id=>{
      const p=placeById.get(id);
      return [id,p?.lat,p?.lng];
    })])]);
    if(signature===cameraRoutes)return false;
    cameraRoutes=signature;
    routeExtent=extentForRoutes(shown)||[300,700,1380,1700];
    return true;
  }
  function refreshNative() {
    if (basemapState!=='google' || !nativeLayer) return;
    const shown=routeList.filter(r=>visible.has(r.id)).sort((a,b)=>Number(a.id===activeId)-Number(b.id===activeId));
    const signature=JSON.stringify([cameraRoutes,activeId,selectedId,[...pinned],shown.map(r=>[r.id,r.name,r.color]),
      places.map(p=>[p.id,p.name,p.short,p.lat,p.lng])]);
    if(signature===nativeSignature)return;
    nativeSignature=signature;
    const displayPlaces=new Map(placeById);
    if(window.atlasGoogleWalking) {
      for(const route of shown) for(let i=1;i<route.stops.length;i++) {
        const from=placeById.get(route.stops[i-1]),to=placeById.get(route.stops[i]);
        if(!from || !to || (hasLocation(from) && hasLocation(to)))continue;
        const endpoints=window.atlasGoogleWalking.leg(from,to)?.endpoints;
        [from,to].forEach((p,j)=>{
          if(!hasLocation(displayPlaces.get(p.id)) && hasLocation(endpoints?.[j])) {
            displayPlaces.set(p.id,{...p,...endpoints[j]});
          }
        });
      }
    }
    nativeLayer.update({routes:shown.map(route=>({route,parts:routeParts(route)})),places:[...displayPlaces.values()],
      placeById:displayPlaces,pinned,activeId,selectedId});
  }

  // Parallel screen-space lanes keep shared OSM road segments individually clickable.
  function projectedRoutes(shown) {
    const edges=new Map();
    const rows=shown.flatMap(route=>routeParts(route).map(points=>{
      const segments=points.slice(1).map((q,i)=>{
        const p=points[i],forward=p[0]<q[0] || (p[0]===q[0] && p[1]<=q[1]);
        const key=forward ? [p,q].join('|') : [q,p].join('|');
        if(!edges.has(key))edges.set(key,new Set());
        edges.get(key).add(route.id);
        return {key,forward};
      });
      return {route,points,segments};
    }));
    return rows.map(({route,points,segments})=>{
      const offsets=segments.map(({key,forward},i)=>{
        const users=edges.get(key);
        if(users.size<2)return [0,0];
        const ids=[...users].sort();
        const offset=(ids.indexOf(route.id)-(ids.length-1)/2)*7*(forward?1:-1);
        const dx=points[i+1][0]-points[i][0],dy=points[i+1][1]-points[i][1];
        const length=Math.hypot(dx,dy)||1;
        return [-dy*offset/length,dx*offset/length];
      });
      const screen=points.map((p,i)=>{
        const [x,y]=pt(...p),before=offsets[i-1]||offsets[i],after=offsets[i]||before;
        return before?[x+(before[0]+after[0])/2,y+(before[1]+after[1])/2]:[x,y];
      });
      return {route,points:screen};
    });
  }

  function renderRoute({route,points}) {
    if(points.length<2)return;
    lineHits.push({id:route.id,points});
    const active=route.id===activeId;
    const color=route.color||'#087e83';
    const shape=new Path2D();
    shape.moveTo(...points[0]);
    for(const p of points.slice(1))shape.lineTo(...p);
    ctx.save();
    ctx.lineCap='round';ctx.lineJoin='round';
    ctx.strokeStyle='#fffefa';ctx.lineWidth=active?8.1:7.5;ctx.stroke(shape);
    ctx.strokeStyle=color+'40';ctx.lineWidth=active?5.6:5.0;ctx.stroke(shape);
    ctx.strokeStyle=color;ctx.lineWidth=active?4.5:4.0;
    ctx.setLineDash(active?[2.5,6.5]:[1,6.6]);
    ctx.stroke(shape);
    ctx.restore();
  }
  function symbol(kind,x,y,size,color) {
    ctx.save();ctx.translate(x,y);ctx.scale(size/20,size/20);
    ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=1.65;
    ctx.beginPath();
    if(kind==='coffee'){
      ctx.moveTo(-6,-4);ctx.lineTo(4,-4);ctx.lineTo(4,-1);
      ctx.quadraticCurveTo(4,4.7,-1,4.7);ctx.quadraticCurveTo(-6,4.7,-6,-1);ctx.closePath();
      ctx.moveTo(4,-3);ctx.bezierCurveTo(10,-4,8,2,4,1.8);ctx.moveTo(-7,7);ctx.lineTo(6,7);
    }else if(kind==='temple'||kind==='shrine'){
      ctx.moveTo(-8,-5);ctx.quadraticCurveTo(0,-3,8,-5);
      ctx.moveTo(-7,-1);ctx.lineTo(7,-1);ctx.moveTo(-4,-3);ctx.lineTo(-5,7);
      ctx.moveTo(4,-3);ctx.lineTo(5,7);ctx.moveTo(0,-3);ctx.lineTo(0,-1);
    }else if(kind==='park'){
      ctx.moveTo(0,-8);ctx.lineTo(5,-1);ctx.lineTo(2.5,-1);ctx.lineTo(6,4);ctx.lineTo(-6,4);
      ctx.lineTo(-2.5,-1);ctx.lineTo(-5,-1);ctx.closePath();ctx.moveTo(0,4);ctx.lineTo(0,7);
    }else if(kind==='train'){
      ctx.roundRect(-5,-6,10,11,2);ctx.moveTo(-4,-1);ctx.lineTo(4,-1);
      ctx.moveTo(-3,6);ctx.lineTo(-5,8);ctx.moveTo(3,6);ctx.lineTo(5,8);
    }else if(kind==='school'){
      ctx.moveTo(-7,-3);ctx.lineTo(0,-7);ctx.lineTo(7,-3);ctx.lineTo(0,0);ctx.closePath();
      ctx.moveTo(-5,-1);ctx.lineTo(-5,3);ctx.quadraticCurveTo(0,7,5,3);ctx.lineTo(5,-1);
    }else{
      ctx.moveTo(-6,6);ctx.lineTo(-1,-1);ctx.lineTo(2,1);ctx.lineTo(7,-6);
      ctx.moveTo(-7,0);ctx.lineTo(-4,-4);ctx.moveTo(4,6);ctx.lineTo(7,2);
    }
    ctx.stroke();ctx.restore();
  }
  function circle(x,y,r,fill,stroke,line=1) {
    ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);
    if(fill){ctx.fillStyle=fill;ctx.fill();}
    if(stroke){ctx.lineWidth=line;ctx.strokeStyle=stroke;ctx.stroke();}
  }
  function textLabel(txt,x,y,font,color,align='center',halo=3,haloColor='rgba(249,249,243,.90)') {
    ctx.font=font;ctx.textAlign=align;ctx.textBaseline='middle';ctx.lineJoin='round';
    if(halo){ctx.strokeStyle=haloColor;ctx.lineWidth=halo;ctx.strokeText(txt,x,y);}
    ctx.fillStyle=color;ctx.fillText(txt,x,y);
  }

  const collides=(a,b)=>a[0]<b[2] && a[2]>b[0] && a[1]<b[3] && a[3]>b[1];

  function routeBadge({route,points},reserved) {
    if(points.length<2)return;
    const compact=width<650, color=route.color||'#087e83';
    ctx.font=fonts(compact?11.7:12.7,680);
    const maxWidth=compact?106:160;
    let title=route.name;
    if(ctx.measureText(title).width>maxWidth){
      const letters=Array.from(title).slice(0,60);
      while(letters.length && ctx.measureText(letters.join('')+'…').width>maxWidth)letters.pop();
      title=letters.join('')+'…';
    }
    const w=36+ctx.measureText(title).width,h=compact?25:28;
    const cumulative=[0];
    for(let i=1;i<points.length;i++){
      cumulative.push(cumulative[i-1]+Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]));
    }
    const total=cumulative.at(-1);
    if(total<22)return;
    const surface=height-bottom;
    for(const t of [.42,.68,.22,.8,.31,.54,.11,.91]) {
      const at=t*total;
      const i=cumulative.findIndex(s=>s>=at);
      if(i<1)continue;
      const f=(at-cumulative[i-1])/(cumulative[i]-cumulative[i-1]||1);
      const anchor=points[i-1].map((val,k)=>val+(points[i][k]-val)*f);
      for(const [dx,dy] of [[10,-h-6],[-w-10,-h-6],[10,7],[-w-10,7],[-w/2,-h-13],[-w/2,13]]) {
        const x=anchor[0]+dx,y=anchor[1]+dy,b=[x-3,y-3,x+w+3,y+h+3];
        if(b[0]<5||b[2]>width-5||b[1]<6||b[3]>surface-3||reserved.some(other=>collides(b,other)))continue;
        const cx=clamp(anchor[0],x+8,x+w-8),cy=clamp(anchor[1],y+3,y+h-3);
        ctx.save();
        ctx.beginPath();ctx.moveTo(...anchor);ctx.lineTo(cx,cy);
        ctx.strokeStyle=color;ctx.lineWidth=1.25;ctx.stroke();
        ctx.beginPath();ctx.roundRect(x,y,w,h,h/2);
        ctx.fillStyle='#fffefa';ctx.shadowColor='rgba(25,50,47,.16)';ctx.shadowBlur=5;ctx.shadowOffsetY=1.5;
        ctx.fill();ctx.shadowColor='transparent';ctx.strokeStyle=color+'70';ctx.lineWidth=1;ctx.stroke();
        circle(x+14,y+h/2,9.4,color,null);
        ctx.save();ctx.translate(x+14-7.4,y+h/2-7.4);ctx.scale(14.8/24,14.8/24);
        ctx.lineWidth=2.35;ctx.strokeStyle='#fff';ctx.lineCap='round';ctx.lineJoin='round';ctx.stroke(walkingIcon);ctx.restore();
        textLabel(title,x+27,y+h/2+.3,fonts(compact?11.7:12.7,680),'#334144','left',0);
        ctx.restore();
        badgeHits.push({id:route.id,box:b});reserved.push(b);
        return;
      }
    }
  }

  function backdropLabels() {
    const dense=scale>.77;
    for(let i=0;i<roadLabels.length;i++){
      const [lat,lng,label,angle]=roadLabels[i], [x,y]=loc(lat,lng);
      if(!onscreen(x,y) || (!dense && i%3===2))continue;
      ctx.save();ctx.translate(x,y);ctx.rotate(angle*Math.PI/180);
      textLabel(label,0,0,fonts(10,500),'#92928b','center',2.8);ctx.restore();
    }
    for(const [lat,lng,name,english] of districts){
      const [x,y]=loc(lat,lng);
      if(!onscreen(x,y))continue;
      textLabel(t(name,english.replaceAll(' ','')),x,y,fonts(width<620?15:18,600),'#9d9e97','center',3,'rgba(245,245,238,.80)');
      if(!en)textLabel(english,x,y+15,fonts(8,600),'#989b93','center',2,'rgba(245,245,238,.8)');
    }
    for(const [lat,lng] of riverLabels){
      const [x,y]=loc(lat,lng);if(!onscreen(x,y))continue;
      ctx.save();ctx.translate(x,y);ctx.rotate(-1.33);
      textLabel(t('鴨 川','Kamo River'),0,0,fonts(12,600),'#6a999d','center',2,'#c4e1df');ctx.restore();
    }
  }

  function drawFeatures(drawnRoutes,projected) {
    const rows=[];
    const pinLetters=new Map([...pinned].map((id,i)=>[id,String.fromCharCode(65+i)]));
    const stops=new Map();
    for(const route of drawnRoutes){
      route.stops.forEach((id,index)=>{
        if(route.id===activeId || !stops.has(id))stops.set(id,{number:index+1,color:route.color || '#087e83',active:route.id===activeId});
      });
    }
    for(const place of places){
      if(!hasLocation(place))continue;
      const [x,y]=loc(place.lat,place.lng);
      if(!onscreen(x,y,100))continue;
      const stop=stops.get(place.id);
      const coffee=place.icon==='coffee';
      const marked=pinned.has(place.id), sel=place.id===selectedId;
      const priority=(stop?80:0)+(sel?35:0)+(coffee?32:0)+(marked?20:0);
      const size=stop?12.5:(marked?13:(coffee?11:(sel?11:8.4)));
      rows.push({id:place.id,x,y,place,stop,coffee,marked,sel,priority,size});
    }
    const reserved=rows.map(r=>[r.x-r.size-1,r.y-r.size-1,r.x+r.size+1,r.y+r.size+1,r.id]);
    for(const r of rows.slice().sort((a,b)=>a.priority-b.priority)){
      let ink=r.stop?.color || (r.marked?'#6658ac':r.coffee?'#a16b48':r.place.icon==='park'?'#6a895f':r.place.icon==='street'?'#8c8982':'#92816b');
      if(r.sel){circle(r.x,r.y,r.size+6,ink+'28',null);circle(r.x,r.y,r.size+4,null,'#fff',1);}
      if(r.stop || r.coffee || r.marked || r.sel) {
        ctx.save();ctx.shadowColor='rgba(38,44,42,.20)';ctx.shadowBlur=5;ctx.shadowOffsetY=1.5;
        circle(r.x,r.y,r.size,'#fff',null);ctx.restore();
        if(r.stop && r.stop.number>1){
          circle(r.x,r.y,r.size-1.8,'#fffefa',ink,2.5);
        }else circle(r.x,r.y,r.size-1.5,ink,null);
      } else circle(r.x,r.y,r.size,'#faf9f3',ink+'90',1);
      if(r.stop) textLabel(String(r.stop.number),r.x,r.y+.1,fonts(12.5,740),r.stop.number>1?ink:'#fff','center',0);
      else if(r.marked) textLabel(pinLetters.get(r.id),r.x,r.y+.1,fonts(14,740),'#fff','center',0);
      else symbol(r.place.icon,r.x,r.y,(r.coffee||r.sel||r.marked)?16:12,(r.coffee||r.sel||r.marked)?'#fff':ink);
      if(r.stop && r.marked){
        const sx=r.x+r.size*.73,sy=r.y-r.size*.87;
        circle(sx,sy,7.8,'#eeeafa','#fff',1.4);
        textLabel(pinLetters.get(r.id),sx,sy,fonts(9.4,750),'#51459d','center',0);
        reserved.push([sx-8,sy-8,sx+8,sy+8,'superscript-'+r.id]);
      }
      placeHits.push({id:r.id,box:[r.x-r.size-5,r.y-r.size-5,r.x+r.size+5,r.y+r.size+5]});
    }
    const sorted=rows.sort((a,b)=>b.priority-a.priority);
    for(const r of sorted){
      const name=r.place.short || r.place.name;
      const main=r.stop || r.sel,high=main||r.coffee||r.marked;
      const second=!en && main && (scale>.48 || width>650) ? r.place.en:'';
      const fs=main?15:r.coffee?13:12;
      const primary=fonts(fs,high?690:590);
      ctx.font=primary;let w=ctx.measureText(name).width;
      if(second){ctx.font=fonts(9,580);w=Math.max(w,ctx.measureText(second).width);}
      const pad=r.size+5, totalH=second?26:15;
      const west=r.place.id==='arabica'||r.place.id==='coffee'||r.place.id==='gion'||r.place.id==='kennin';
      const preferred=west?[-1,1]:[1,-1];
      let box, side, ty;
      for(const dy of [0,-16,16,-30,30]){
        for(const s of preferred){
          const x=s===1?r.x+pad:r.x-pad-w;
          const y=r.y-totalH/2+dy;
          const test=[x-2,y-2,x+w+2,y+totalH+2,r.id];
          if(test[0]<4 || test[2]>width-3 || test[1]<4 || test[3]>height-3)continue;
          if(!reserved.some(b=>b[4]!==r.id && collides(test,b))){
            box=test;side=s;ty=y;break;
          }
        }
        if(box)break;
      }
      if(!box) continue;
      reserved.push(box);
      const align=side===1?'left':'right',tx=side===1?box[0]+2:box[2]-2;
      const ink=r.stop?'#334145':r.coffee?'#79503b':r.place.icon==='park'?'#5e795b':'#6f7069';
      textLabel(name,tx,ty+7.5,primary,ink,align,4.3,'rgba(253,252,247,.98)');
      if(second)textLabel(second,tx,ty+21,fonts(9.5,560),'#726b80',align,3,'rgba(250,249,244,.97)');
      placeHits.push({id:r.id,box});
    }
    const search=document.getElementById('search')?.getBoundingClientRect();
    if(search)reserved.push([search.left-6,search.top-6,search.right+6,search.bottom+6]);
    for(const row of projected){
      if(!badgeHits.some(hit=>hit.id===row.route.id))routeBadge(row,reserved);
    }
    for(const [lat,lng,name,kind] of contextLabels){
      const [x,y]=loc(lat,lng);
      if(!onscreen(x,y) || (width<600 && scale<.4))continue;
      ctx.font=fonts(11.5,520);
      const w=ctx.measureText(name).width;
      const box=[x-8,y-9,x+w+12,y+9,''];
      if(reserved.some(b=>collides(box,b))) continue;
      reserved.push(box);
      const color=kind==='train'?'#63849a':kind==='park'?'#688563':'#8e8779';
      symbol(kind,x,y,13,color);
      textLabel(name,x+9,y,fonts(11.5,520),color,'left',3.2);
    }
  }

  function draw() {
    if(basemapState==='google' || !ctx || !width || !height || !layers)return;
    const r=canvas.width/width;
    ctx.setTransform(r,0,0,r,0,0);ctx.clearRect(0,0,width,height);
    ctx.fillStyle='#eeeee7';ctx.fillRect(0,0,width,height);
    basemap();backdropLabels();
    placeHits=[];lineHits=[];badgeHits=[];
    const shown=routeList.filter(row=>visible.has(row.id)).sort((a,b)=>Number(a.id===activeId)-Number(b.id===activeId));
    const projected=projectedRoutes(shown);
    projected.forEach(renderRoute);drawFeatures(shown,projected);
  }

  function zoomAt(factor,x=width/2,y=(height-bottom)/2) {
    if(basemapState==='google')readGoogleCamera();
    manualView();
    const wx=center[0]+(x-width/2)/scale,wy=projectY(center[1])+(y-height/2)/scale;
    scale=clamp(scale*factor,minScale(),basemapState==='google'?scaleAtZoom(24):4.5);
    center=[wx-(x-width/2)/scale,unprojectY(wy-(y-height/2)/scale)];
    boundCenter();moveGoogleCamera();drawSoon();changed();
  }
  function manualView() {
    isDefault=false;focusedRouteId=null;focusedExtent=null;pendingFocus=null;
  }
  function focusPlace(idOrPlace) {
    const p = typeof idOrPlace === 'string' ? placeById.get(idOrPlace) : idOrPlace;
    if (!hasLocation(p) || !width || !height) return false;
    manualView();
    const point = meterPoint(p.lat,p.lng);
    if (basemapState === 'loading') pendingFocus = p;
    if (basemapState !== 'google' && !insideOffline(point)) return Boolean(pendingFocus);
    scale = Math.max(scale,scaleAtZoom(16),minScale());
    // Center the pin in the visible portion between the search bar and sheet.
    center = [point[0],unprojectY(projectY(point[1]) + (bottom - 60)/(2*scale))];
    boundCenter();
    moveGoogleCamera();
    drawSoon();
    changed();
    return true;
  }
  function focusRoute(routeOrId) {
    const id=typeof routeOrId==='string'?routeOrId:routeOrId?.id;
    const route=routeList.find(r=>r.id===id);
    if(!route || !route.stops.length) {focusedRouteId=null;focusedExtent=null;return false;}
    isDefault=false;
    focusedRouteId=id;
    pendingFocus=null;
    focusedExtent=extentForRoutes([route]);
    if(!focusedExtent)return false;
    fitView(focusedExtent);
    changed();
    return true;
  }
  function changed(){
    if(callbacks?.onViewChange) callbacks.onViewChange({scale,center:[...center]});
  }
  function dragBy(dx,dy) {
    center[0]-=dx/scale;
    center[1]=unprojectY(projectY(center[1])-dy/scale);
  }
  function localXY(e) {
    const rect=canvas.getBoundingClientRect();return [e.clientX-rect.left,e.clientY-rect.top];
  }
  function segmentDistance(x,y,p,q){
    const dx=q[0]-p[0],dy=q[1]-p[1],l=dx*dx+dy*dy;
    const t=l?clamp(((x-p[0])*dx+(y-p[1])*dy)/l,0,1):0;
    return Math.hypot(x-p[0]-dx*t,y-p[1]-dy*t);
  }
  function hitAt(x,y){
    for(let i=placeHits.length-1;i>=0;i--){
      const hit=placeHits[i], b=hit.box;
      if(x>=b[0]&&x<=b[2]&&y>=b[1]&&y<=b[3])return {place:hit.id};
    }
    for(const hit of badgeHits){
      const b=hit.box;
      if(x>=b[0] && x<=b[2] && y>=b[1] && y<=b[3])return {route:hit.id};
    }
    let nearest=9,result;
    for(let i=lineHits.length-1;i>=0;i--){
      const {id,points}=lineHits[i];
      for(let j=1;j<points.length;j++){
        const distance=segmentDistance(x,y,points[j-1],points[j]);
        if(distance<nearest){nearest=distance;result={route:id};}
      }
    }
    return result;
  }
  function selectHit(hit) {
    if(hit?.place)callbacks?.onPlace?.(hit.place);
    else if(hit?.route)callbacks?.onRoute?.(hit.route);
  }
  function listen(){
    canvas.addEventListener('pointerdown',e=>{
      if(e.button!==0)return;
      const pos=localXY(e);
      pointers.set(e.pointerId,pos);canvas.setPointerCapture(e.pointerId);
      if(pointers.size===1)gesture={start:pos,last:pos,moved:false,pinched:false};
      else if(pointers.size===2 && gesture){
        const [a,b]=[...pointers.values()];
        gesture.pinchDistance=Math.hypot(a[0]-b[0],a[1]-b[1]);gesture.pinched=true;gesture.moved=true;
        gesture.mid=[(a[0]+b[0])/2,(a[1]+b[1])/2];
      }
    });
    canvas.addEventListener('pointermove',e=>{
      const pos=localXY(e);
      if(!pointers.has(e.pointerId)){
        if(e.pointerType==='mouse')canvas.style.cursor=hitAt(...pos)?'pointer':'grab';
        return;
      }
      if(!gesture)return;
      pointers.set(e.pointerId,pos);
      if(pointers.size===2){
        const [a,b]=[...pointers.values()],dist=Math.max(2,Math.hypot(a[0]-b[0],a[1]-b[1]));
        const mx=(a[0]+b[0])/2,my=(a[1]+b[1])/2;
        if(gesture.mid)dragBy(mx-gesture.mid[0],my-gesture.mid[1]);
        if(gesture.pinchDistance) zoomAt(dist/gesture.pinchDistance,mx,my);
        gesture.pinchDistance=dist;gesture.mid=[mx,my];return;
      }
      if(!gesture.moved && Math.hypot(pos[0]-gesture.start[0],pos[1]-gesture.start[1])<4)return;
      gesture.moved=true;manualView();canvas.style.cursor='grabbing';
      dragBy(pos[0]-gesture.last[0],pos[1]-gesture.last[1]);
      gesture.last=pos;boundCenter();drawSoon();changed();
    });
    const release=e=>{
      const pos=localXY(e);const wasDown=pointers.delete(e.pointerId);
      if(!wasDown || !gesture)return;
      if(pointers.size===1){gesture.last=[...pointers.values()][0];gesture.moved=true;return;}
      if(!pointers.size){
        if(e.type==='pointerup'&&!gesture.moved){
          selectHit(hitAt(...pos));
        }
        gesture=null;canvas.style.cursor='grab';
      }
    };
    canvas.addEventListener('pointerup',release);canvas.addEventListener('pointercancel',release);
    canvas.addEventListener('wheel',e=>{
      e.preventDefault(); const [x,y]=localXY(e);
      zoomAt(Math.exp(clamp(-e.deltaY*(e.deltaMode===1?.045:.0022),-.65,.65)),x,y);
    },{passive:false});
    canvas.addEventListener('dblclick',e=>{e.preventDefault();zoomAt(1.55,...localXY(e));});
    canvas.addEventListener('keydown',e=>{
      if(e.key==='+'||e.key==='='){e.preventDefault();zoomAt(1.35);}
      if(e.key==='-'){e.preventDefault();zoomAt(1/1.35);}
      if(e.key==='Home'){e.preventDefault();resetView();}
    });
  }
  function resetView() {
    manualView();isDefault=true;fitView();changed();
  }
  window.atlasMap={
    mount(options){
      canvas=options.canvas;ctx=canvas.getContext('2d',{alpha:true});callbacks=options;
      canvas.parentElement.dataset.basemap=basemapState;
      places=Array.isArray(options.places)?options.places:[];placeById=new Map(places.map(p=>[p.id,p]));
      routeList=options.routes||[];activeId=routeList[0]?.id;visible=new Set(routeList.map(route=>route.id));
      prepareLayers();updateRouteExtent();resize();listen();
      resizeObserver=new ResizeObserver(resize);resizeObserver.observe(canvas);
    },
    setState(state){
      if(Array.isArray(state.places)) {
        places=state.places;
        placeById=new Map(places.map(p=>[p.id,p]));
      }
      if('routes' in state)routeList=state.routes;
      if('activeRouteId' in state)activeId=state.activeRouteId;
      if('visibleIds' in state)visible=new Set(state.visibleIds || []);
      const geometryChanged=updateRouteExtent();
      if(focusedRouteId && !visible.has(focusedRouteId)) {focusedRouteId=null;focusedExtent=null;}
      if(geometryChanged && focusedRouteId)focusRoute(focusedRouteId);
      else if(geometryChanged && isDefault)fitView();
      if('pinnedIds' in state)pinned=new Set(state.pinnedIds||[]);
      if('selectedId' in state)selectedId=state.selectedId;
      refreshNative();
      drawSoon();
    },
    setBottom(px){
      const next=Math.max(0,Number(px)||0);
      if(Math.abs(next-sheetHeight)<1)return;
      sheetHeight=next;bottom=next+attributionGap;
      if(focusedExtent)fitView(focusedExtent);
      else if(isDefault)fitView();
      else drawSoon();
    },
    resetView,
    zoomBy(delta){zoomAt(Math.pow(1.4,delta));},
    focusPlace,
    focusRoute,
    hasLocalLeg,
    getSearchBias(){return basemapState==='google' ? googleMap?.getBounds() : undefined;},
    setGoogleBasemap,
    getBasemapState(){return basemapState;},
    getRouteMeters:meters
  };
})();
