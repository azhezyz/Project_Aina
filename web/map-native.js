/* Google Maps owns the camera, route geometry and the pane that carries these labels. */
(() => {
  "use strict";
  const {t} = window.atlasLocale;
  const toLatLng = ([x,y]) => ({lat:35.01-y/111000, lng:135.77+x/91300});
  const routeColor = r => r.color || "#087e83";
  const fractions = [.42,.65,.25,.78,.52];

  function connect(map, {Polyline, OverlayView}, callbacks) {
    const lines = new Map();
    class Labels extends OverlayView {
      constructor() {
        super();
        this.rows = new Map();
        this.host = document.createElement("div");
        this.host.className = "aina-map-labels";
      }
      onAdd() {
        this.getPanes().overlayMouseTarget.append(this.host);
        window.dispatchEvent(new Event("aina-map-labels-changed"));
      }
      onRemove() { this.host.remove(); }
      draw() {
        const projection = this.getProjection();
        if (!projection || !this.host.isConnected) return;
        const viewportWidth=map.getDiv?.().clientWidth || 0;
        for (const {anchor, button, position, side, labelWidth} of this.rows.values()) {
          const point = projection.fromLatLngToDivPixel(position);
          anchor.hidden = !point;
          if (point) anchor.style.transform = `translate3d(${point.x}px,${point.y}px,0)`;
          if (side) {
            const horizontal=side==="west" || side==="east";
            const screen=horizontal && viewportWidth && projection.fromLatLngToContainerPixel?.(position);
            const clipped=screen && (side==="west" && screen.x<labelWidth+15 ||
              side==="east" && screen.x>viewportWidth-labelWidth-15);
            const direction=clipped?"south":side;
            if(button.dataset.side!==direction)button.dataset.side=direction;
          }
        }
      }
      update(items) {
        const keep = new Set();
        for (const item of items) {
          const key = item.kind + "/" + item.id;
          keep.add(key);
          let row = this.rows.get(key);
          if (!row) {
            const anchor = document.createElement("div"), button = document.createElement("button");
            anchor.className = "aina-map-anchor";
            button.type = "button";
            button.addEventListener("click", e => {
              e.stopPropagation();
              if (item.kind === "route") callbacks.onRoute?.(item.id);
              else callbacks.onPlace?.(item.id);
            });
            OverlayView.preventMapHitsFrom(button);
            anchor.append(button);
            this.host.append(anchor);
            row = {anchor,button};
            this.rows.set(key,row);
          }
          row.position = item.position;
          const signature = JSON.stringify(item);
          if (row.signature === signature) continue;
          row.signature = signature;
          const {anchor,button} = row;
          anchor.style.zIndex = String(item.priority);
          button.className = "aina-map-" + item.kind;
          button.setAttribute("aria-label",item.description);
          button.title = item.description;
          button.style.setProperty("--pin-color",item.color);
          if (item.kind === "route") {
            button.dataset.routeId = item.id;
            button.textContent = item.text;
            button.style.setProperty("--badge-rise",item.rise + "px");
          } else {
            button.dataset.placeId = item.id;
            button.classList.toggle("has-label",item.label);
            button.classList.toggle("is-small",!item.mark && !item.selected);
            button.classList.toggle("is-current",item.selected);
            row.side=item.side;
            row.labelWidth=Math.min(165,Math.max(36,item.text.length*8));
            const mark = document.createElement("span"), title = document.createElement("span");
            mark.className = "aina-map-number";
            mark.textContent = item.mark;
            title.className = "aina-map-place-title";
            title.textContent = item.text;
            button.replaceChildren(mark,title);
            if (item.letter && item.letter !== item.mark) {
              const sup = document.createElement("sup");
              sup.textContent = item.letter;
              mark.append(sup);
            }
          }
        }
        for (const [key,row] of this.rows) {
          if (!keep.has(key)) { row.anchor.remove(); this.rows.delete(key); }
        }
        this.draw();
        window.dispatchEvent(new Event("aina-map-labels-changed"));
      }
    }
    const labels = new Labels();
    labels.setMap(map);

    function update({places, routes, placeById, pinned, selectedId, activeId}) {
      const items=[], stops=new Map(), keep=new Set(), badgeAnchors=new Map();
      const pins = new Map([...pinned].map((id,i)=>[id,String.fromCharCode(65+i)]));
      // A wider, lower stroke leaves individually clickable edges when walks share a street.
      const edgeUsers=new Map();
      for (const {route, parts} of routes) {
        for (const part of parts) for (let i=1;i<part.length;i++) {
          const p=part[i-1].join(","), q=part[i].join(",");
          const key=p<q?p+"|"+q:q+"|"+p;
          if (!edgeUsers.has(key)) edgeUsers.set(key,new Set());
          edgeUsers.get(key).add(route.id);
        }
      }
      const rank=new Map(routes.map(({route},i)=>[route.id,i]));
      for (const {route,parts} of routes) {
        route.stops.forEach((id,i)=>{
          if (!stops.has(id) || route.id===activeId) stops.set(id,{route,number:i+1});
        });
        parts.forEach((part,index)=>{
          if (part.length<2) return;
          const id=route.id+"/"+index;
          keep.add(id);
          const z=rank.get(route.id), above=new Set();
          for (let i=1;i<part.length;i++) {
            const p=part[i-1].join(","),q=part[i].join(",");
            for (const other of edgeUsers.get(p<q?p+"|"+q:q+"|"+p)) {
              if (rank.get(other)>z) above.add(other);
            }
          }
          const options={strokeColor:routeColor(route),strokeOpacity:.94,
            strokeWeight:(route.id===activeId?5:4)+Math.min(above.size,5)*5,zIndex:z+1};
          let row=lines.get(id);
          const geometry=JSON.stringify(part),style=JSON.stringify(options);
          if (!row) {
            const line=new Polyline({...options,map,geodesic:false,clickable:true,path:part.map(toLatLng)});
            const listener=line.addListener("click",e=>{e.stop?.();callbacks.onRoute?.(route.id);});
            row={line,listener};lines.set(id,row);
          } else {
            if(row.geometry!==geometry)row.line.setPath(part.map(toLatLng));
            if(row.style!==style)row.line.setOptions(options);
          }
          row.geometry=geometry;row.style=style;
        });
        const longest=parts.reduce((best,p)=>p.length>best.length?p:best,[]);
        const first=route.stops.map(id=>placeById.get(id)).find(p=>p && Number.isFinite(p.lat) && Number.isFinite(p.lng));
        if (!first) continue;
        const index=rank.get(route.id);
        const position=longest.length>1
          ? toLatLng(longest[Math.round((longest.length-1)*fractions[index%fractions.length])])
          : {lat:first.lat,lng:first.lng};
        const anchor=position.lat.toFixed(5)+","+position.lng.toFixed(5);
        const lane=badgeAnchors.get(anchor)||0;
        badgeAnchors.set(anchor,lane+1);
        items.push({kind:"route",id:route.id,position,color:routeColor(route),text:route.name,
          description:t("打开路线 ","Open route ")+route.name,rise:(longest.length>1?28:21)+lane*27,priority:25+index});
      }
      for(const [id,row] of lines) {
        if(!keep.has(id)) {row.listener.remove();row.line.setMap(null);lines.delete(id);}
      }
      for(const p of places) {
        if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
        const stop=stops.get(p.id),letter=pins.get(p.id)||"",selected=p.id===selectedId;
        if (p.dynamic && !stop && !letter && !selected) continue;
        const text=p.short||p.name||t("地点","Place"),mark=stop?String(stop.number):letter;
        let side="east";
        if(stop) {
          // Point endpoint titles away from the walk so a short street segment stays visible.
          const ids=stop.route.stops,i=stop.number-1;
          const near=[ids[i-1],ids[i+1]].map(id=>placeById.get(id)).filter(q=>Number.isFinite(q?.lat)&&Number.isFinite(q?.lng));
          let east=0,north=0;
          for(const q of near) {
            const dx=(((q.lng-p.lng+540)%360)-180)*Math.cos(p.lat*Math.PI/180),dy=q.lat-p.lat;
            const length=Math.hypot(dx,dy)||1;
            east+=dx/length;north+=dy/length;
          }
          if(near.length)side=Math.abs(east)>Math.abs(north) ? (east>0?"west":"east") : (north>0?"south":"north");
        }
        items.push({kind:"place",id:p.id,position:{lat:p.lat,lng:p.lng},mark,letter,selected,
          side,text,label:Boolean(stop||letter||selected),description:(stop?t("第 "+stop.number+" 站 · ","Stop "+stop.number+" · "):"")+text,
          color:stop?routeColor(stop.route):letter?"#6658ac":"#8a755f",
          priority:selected?24:stop?20:letter?18:8});
      }
      labels.update(items);
    }
    function dispose() {
      for(const row of lines.values()) {row.listener.remove();row.line.setMap(null);}
      lines.clear();labels.setMap(null);labels.rows.clear();
    }
    return {update,dispose};
  }
  window.atlasNativeMap={connect};
})();
