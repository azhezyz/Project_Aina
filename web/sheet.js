(() => {
  'use strict';

  const levels = ['closed', 'half', 'full'];
  let controller;

  function mount({ sheet, handle, body, onHeight, onLevelChange, onCloseWindows }) {
    controller?.destroy();
    const events = new AbortController();
    const { signal } = events;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let level = 'closed';
    let height = 0;
    let frame = 0;
    let gesture = null;
    let suppressClickUntil = 0;
    let stops = [];
    let pendingTap = null;
    let tapTimer = 0;
    let pointerClickHandled = false;
    let doubleHandled = false;

    function cancelTap() {
      clearTimeout(tapTimer);
      pendingTap = null;
    }

    function cycleLevel() {
      settle(levels[(levels.indexOf(level) + 1) % levels.length]);
    }

    function recognizeTap(x, y) {
      if (pendingTap && Math.hypot(x - pendingTap.x, y - pendingTap.y) <= 20) {
        cancelTap();
        doubleHandled = true;
        onCloseWindows?.();
        return;
      }
      if (pendingTap) cycleLevel();
      doubleHandled = false;
      pendingTap = { x, y };
      tapTimer = setTimeout(cycleLevel, 380);
    }

    function measure() {
      const viewport = window.visualViewport?.height || window.innerHeight;
      const safe = parseFloat(getComputedStyle(sheet).paddingBottom) || 0;
      stops = [44 + safe, Math.round(viewport * (window.innerWidth <= 600 ? 0.45 : 0.38)), Math.round(viewport * 0.8)];
    }

    function paint(value) {
      height = Math.min(stops[2], Math.max(stops[0], value));
      sheet.style.height = height + 'px';
      sheet.toggleAttribute('data-sheet-open', level !== 'closed' || height > stops[0] + 1);
      onHeight?.(height);
    }

    function settle(next, animate = true) {
      if (!levels.includes(next)) return;
      cancelTap();
      cancelAnimationFrame(frame);
      gesture = null;
      sheet.removeAttribute('data-sheet-dragging');
      const changed = next !== level;
      level = next;
      sheet.dataset.sheetLevel = next;
      if (next === 'closed' && body.contains(document.activeElement)) handle.focus({ preventScroll: true });
      body.inert = next === 'closed';
      handle.setAttribute('aria-expanded', String(next !== 'closed'));
      const start = height;
      const target = stops[levels.indexOf(next)];
      if (!animate || reduceMotion.matches || Math.abs(start - target) < 1) {
        paint(target);
      } else {
        const begin = performance.now();
        function step(time) {
          const t = Math.min(1, (time - begin) / 245);
          paint(start + (target - start) * (1 - (1 - t) ** 3));
          if (t < 1) frame = requestAnimationFrame(step);
        }
        frame = requestAnimationFrame(step);
      }
      if (changed) onLevelChange?.(next);
    }

    function nextLevel(direction) {
      return levels[Math.max(0, Math.min(2, levels.indexOf(level) + direction))];
    }

    function startGesture(source, id, x, y) {
      gesture = { source, id, x, y, previousY: y, previousTime: performance.now(), velocity: 0, moved: false, startHeight: height };
      suppressClickUntil = 0;
    }

    function moveGesture(x, y) {
      if (!gesture) return false;
      const g = gesture;
      const dx = x - g.x;
      const dy = y - g.y;
      if (!g.moved) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 7) return false;
        cancelTap();
        const horizontal = Math.abs(dx) > Math.abs(dy);
        if (horizontal || (g.source === 'edge' && dy >= 0)) {
          if (g.source === 'handle') suppressClickUntil = performance.now() + 380;
          gesture = null;
          return false;
        }
        cancelAnimationFrame(frame);
        g.startHeight = height;
        g.moved = true;
        sheet.setAttribute('data-sheet-dragging', '');
      }
      const now = performance.now();
      g.velocity = (g.previousY - y) / Math.max(8, now - g.previousTime);
      g.previousY = y;
      g.previousTime = now;
      paint(g.startHeight - dy);
      return true;
    }

    function finishGesture(cancelled = false) {
      if (!gesture) return;
      const g = gesture;
      gesture = null;
      if (!g.moved) return;
      suppressClickUntil = performance.now() + 380;
      const delta = height - g.startHeight;
      const recentFlick = performance.now() - g.previousTime < 110 && Math.abs(g.velocity) > 0.45;
      const closest = stops.reduce((best, stop, index) => Math.abs(stop - height) < Math.abs(stops[best] - height) ? index : best, 0);
      let next = levels[closest];
      if (next === level && (Math.abs(delta) > 34 || (recentFlick && Math.abs(delta) > 10))) next = nextLevel(Math.sign(delta));
      settle(cancelled ? level : next);
    }

    handle.addEventListener('pointerdown', event => {
      if (!event.isPrimary || event.button !== 0) return;
      // Wait for the second release if the next press started inside the tap interval.
      if (pendingTap) clearTimeout(tapTimer);
      pointerClickHandled = true;
      doubleHandled = false;
      handle.setPointerCapture(event.pointerId);
      startGesture('handle', event.pointerId, event.clientX, event.clientY);
    }, { signal });
    handle.addEventListener('pointermove', event => {
      if (gesture?.source === 'handle' && gesture.id === event.pointerId) moveGesture(event.clientX, event.clientY);
    }, { signal });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      handle.addEventListener(type, event => {
        if (gesture?.source !== 'handle' || gesture.id !== event.pointerId) return;
        const tap = type === 'pointerup' && !gesture.moved;
        finishGesture(type !== 'pointerup');
        if (tap) recognizeTap(event.clientX, event.clientY);
        else cancelTap();
      }, { signal });
    }

    document.addEventListener('touchstart', event => {
      if (level !== 'closed') return;
      if (event.touches.length !== 1) {
        if (gesture?.source !== 'handle') finishGesture(true);
        return;
      }
      const target = event.target;
      if (!(target instanceof Element) || sheet.contains(target)) return;
      const t = event.touches[0];
      if (t.clientY >= window.innerHeight - stops[0] && !target.closest('a, button, [role="button"], input, textarea, select, [contenteditable="true"], iframe')) {
        startGesture('edge', t.identifier, t.clientX, t.clientY);
      }
    }, { passive: true, capture: true, signal });

    document.addEventListener('touchmove', event => {
      if (!gesture || gesture.source === 'handle' || event.touches.length !== 1) return;
      const t = event.touches[0];
      if (t.identifier === gesture.id && moveGesture(t.clientX, t.clientY) && event.cancelable) {
        event.preventDefault();
        event.stopPropagation();
      }
    }, { passive: false, capture: true, signal });
    for (const type of ['touchend', 'touchcancel']) {
      document.addEventListener(type, event => {
        if (gesture && gesture.source !== 'handle' && Array.from(event.changedTouches).some(t => t.identifier === gesture.id)) finishGesture(type === 'touchcancel');
      }, { capture: true, signal });
    }

    sheet.addEventListener('click', event => {
      if (event.detail && performance.now() < suppressClickUntil) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, { capture: true, signal });
    handle.addEventListener('click', event => {
      if (!event.detail) cycleLevel(); // Keyboard and assistive activation.
      else if (pointerClickHandled) pointerClickHandled = false;
      else recognizeTap(event.clientX, event.clientY);
    }, { signal });
    handle.addEventListener('dblclick', event => {
      event.preventDefault();
      cancelTap();
      if (!doubleHandled && performance.now() >= suppressClickUntil) onCloseWindows?.();
      doubleHandled = false;
    }, { signal });
    handle.addEventListener('keydown', event => {
      const actions = { ArrowUp: nextLevel(1), ArrowDown: nextLevel(-1), Home: 'closed', End: 'full', Escape: 'closed' };
      if (Object.hasOwn(actions, event.key)) {
        event.preventDefault();
        settle(actions[event.key]);
      }
    }, { signal });
    function resize() {
      measure();
      settle(level, false);
    }
    window.addEventListener('resize', resize, { signal });
    window.visualViewport?.addEventListener('resize', resize, { signal });
    if (body.id) handle.setAttribute('aria-controls', body.id);
    resize();
    controller = {
      getLevel: () => level,
      setLevel: settle,
      destroy() {
        cancelTap();
        events.abort();
        cancelAnimationFrame(frame);
      }
    };
    return controller;
  }

  window.atlasSheet = {
    mount,
    setLevel: level => controller?.setLevel(level),
    getLevel: () => controller?.getLevel() || 'closed'
  };
})();
