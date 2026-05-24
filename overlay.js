(function () {
  'use strict';

  if (window.__keyOverlayActive) return;
  window.__keyOverlayActive = true;

  // ── Constants ──────────────────────────────────────────────────────────────
  var STORE    = 'keyOverlay_v2_' + location.hostname;
  var DEF_BTN  = 60;
  var DEF_JOY  = 110;
  var MIN_BTN  = 36,  MAX_BTN = 300;
  var MIN_JOY  = 70,  MAX_JOY = 400;
  var SNAP_D   = 15;
  var Z        = 2147483647;
  var BAR_H    = 44;
  var JOY_DEAD = 0.18;
  var JOY_SLOW = 200;   // ms between keydown events at min stick deflection
  var JOY_FAST = 22;    // ms at max deflection

  // ── State ──────────────────────────────────────────────────────────────────
  var editMode  = false;
  var widgets   = [];     // buttons + joysticks mixed
  var dragState = null;   // { type:'move'|'resize', widget, tx, ty, bx, by, startSize }
  var holdTimers = {};
  var _uid = Date.now();

  // ── Key helpers ────────────────────────────────────────────────────────────
  var KEY_ALIAS = {
    space:' ', Space:' ',
    up:'ArrowUp', down:'ArrowDown', left:'ArrowLeft', right:'ArrowRight',
    esc:'Escape', escape:'Escape', enter:'Enter', shift:'Shift',
    ctrl:'Control', control:'Control', alt:'Alt', tab:'Tab',
    backspace:'Backspace', del:'Delete', delete:'Delete',
  };
  var CODE_MAP = {
    ' ':'Space', Enter:'Enter', Shift:'ShiftLeft', Control:'ControlLeft',
    Alt:'AltLeft', Escape:'Escape', Tab:'Tab', Backspace:'Backspace',
    Delete:'Delete', ArrowUp:'ArrowUp', ArrowDown:'ArrowDown',
    ArrowLeft:'ArrowLeft', ArrowRight:'ArrowRight',
  };
  var KEYCODE_MAP = {
    ' ':32, Enter:13, Shift:16, Control:17, Alt:18, Escape:27,
    Tab:9, Backspace:8, Delete:46,
    ArrowLeft:37, ArrowUp:38, ArrowRight:39, ArrowDown:40,
  };
  var LABEL_MAP = {
    ' ':'Spc', ArrowUp:'↑', ArrowDown:'↓', ArrowLeft:'←', ArrowRight:'→',
    Enter:'↵', Shift:'⇧', Control:'Ctrl', Alt:'Alt',
    Escape:'Esc', Tab:'⇥', Backspace:'⌫', Delete:'Del',
  };

  function resolveKey(raw) {
    var t = (raw || '').trim();
    return KEY_ALIAS[t] || KEY_ALIAS[t.toLowerCase()] || t;
  }
  function codeFor(key) {
    if (CODE_MAP[key]) return CODE_MAP[key];
    if (key.length === 1) {
      var u = key.toUpperCase();
      if (u >= 'A' && u <= 'Z') return 'Key' + u;
      if (key >= '0' && key <= '9') return 'Digit' + key;
    }
    return key;
  }
  function lkc(key) {
    if (KEYCODE_MAP[key] !== undefined) return KEYCODE_MAP[key];
    if (key.length === 1) return key.toUpperCase().charCodeAt(0);
    return 0;
  }
  function autoLabel(key) { return LABEL_MAP[key] || key; }

  // ── Key event dispatch ─────────────────────────────────────────────────────
  function fireKey(type, key, code) {
    var lc = lkc(key);
    var init = { key:key, code:code, keyCode:lc, which:lc, bubbles:true, cancelable:true };
    var seen = [], targets = [];
    function add(t) { if (t && seen.indexOf(t) < 0) { seen.push(t); targets.push(t); } }
    var cv = document.querySelectorAll('canvas');
    if (cv.length) add(cv[cv.length - 1]);
    var fr = document.querySelectorAll('iframe');
    for (var i = 0; i < fr.length; i++) {
      try { var fd = fr[i].contentDocument; if (fd) add(fd.activeElement || fd.body); } catch (e) {}
    }
    if (document.activeElement && document.activeElement !== document.body)
      add(document.activeElement);
    add(document);
    for (var j = 0; j < targets.length; j++) {
      try { targets[j].dispatchEvent(new KeyboardEvent(type, init)); } catch (e) {}
    }
  }

  function pressStart(btn) {
    fireKey('keydown', btn.key, btn.code);
    holdTimers[btn.id] = setInterval(function () {
      fireKey('keydown', btn.key, btn.code);
    }, 50);
  }
  function pressEnd(btn) {
    if (holdTimers[btn.id]) { clearInterval(holdTimers[btn.id]); delete holdTimers[btn.id]; }
    fireKey('keyup', btn.key, btn.code);
  }

  // ── Storage ────────────────────────────────────────────────────────────────
  function persist() {
    try {
      localStorage.setItem(STORE, JSON.stringify(
        widgets.map(function (w) {
          if (w.type === 'joystick') {
            return { type:'joystick', id:w.id, x:w.x, y:w.y, size:w.size };
          }
          return { type:'button', id:w.id, key:w.key, code:w.code,
                   label:w.label, x:w.x, y:w.y, size:w.size };
        })
      ));
    } catch (e) {}
  }
  function loadSaved() {
    try { return JSON.parse(localStorage.getItem(STORE) || '[]'); }
    catch (e) { return []; }
  }

  // ── Injected CSS ───────────────────────────────────────────────────────────
  var styleEl = document.createElement('style');
  styleEl.textContent = [
    '@keyframes _koPulse{',
      '0%,100%{box-shadow:0 2px 14px rgba(0,0,0,.45),0 0 0 0 rgba(255,220,50,.75)}',
      '50%{box-shadow:0 2px 14px rgba(0,0,0,.45),0 0 0 9px rgba(255,220,50,0)}}',
    '._koThumb{transition:left .13s ease,top .13s ease}',
    '._koThumbLive{transition:none!important}',
  ].join('');
  document.head.appendChild(styleEl);

  // ── Viewport helpers ───────────────────────────────────────────────────────
  function vViewW() { return window.visualViewport ? window.visualViewport.width  : window.innerWidth;  }
  function vViewH() { return window.visualViewport ? window.visualViewport.height : window.innerHeight; }

  // ── Root ───────────────────────────────────────────────────────────────────
  var root = document.createElement('div');
  root.id = '__koRoot';
  root.setAttribute('style',
    'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:' + Z +
    ';transform-origin:0 0');
  (document.body || document.documentElement).appendChild(root);

  function syncViewport() {
    var vv = window.visualViewport;
    if (!vv) return;
    root.style.transform = 'translate(' + vv.offsetLeft + 'px,' + vv.offsetTop + 'px)';
    root.style.width  = vv.width  + 'px';
    root.style.height = vv.height + 'px';
  }
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', syncViewport);
    window.visualViewport.addEventListener('scroll', syncViewport);
    syncViewport();
  }

  // ── Control bar ────────────────────────────────────────────────────────────
  var bar = document.createElement('div');
  bar.setAttribute('style',
    'position:absolute;bottom:0;left:0;right:0;height:' + BAR_H + 'px;' +
    'background:rgba(0,0,0,.62);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);' +
    'display:flex;align-items:center;padding:0 10px;gap:5px;' +
    'pointer-events:all;z-index:' + Z + ';box-sizing:border-box;' +
    'border-top:1px solid rgba(255,255,255,.1)');
  bar.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive:false });
  root.appendChild(bar);

  function barBtn(text, fn, xs) {
    var b = document.createElement('button');
    b.textContent = text;
    b.setAttribute('style',
      'background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.24);' +
      'color:#fff;border-radius:8px;padding:4px 9px;font-size:12px;font-weight:600;' +
      'font-family:-apple-system,sans-serif;cursor:pointer;' +
      '-webkit-tap-highlight-color:transparent;touch-action:manipulation;' +
      'min-height:30px;white-space:nowrap;' + (xs || ''));
    b.addEventListener('touchend', function (e) { e.preventDefault(); fn(); }, { passive:false });
    b.addEventListener('click', fn);
    return b;
  }

  var closeBtn = barBtn('✕', function () {
    root.remove(); styleEl.remove(); window.__keyOverlayActive = false;
  }, 'background:rgba(200,40,40,.35);border-color:rgba(255,80,80,.35);');
  bar.appendChild(closeBtn);

  var barSpacer = document.createElement('div');
  barSpacer.style.flex = '1';
  bar.appendChild(barSpacer);

  var editBtn = barBtn('Edit', toggleEdit);
  bar.appendChild(editBtn);
  bar.appendChild(barBtn('+', openAddModal));
  bar.appendChild(barBtn('🕹', addJoystick, 'font-size:15px;padding:4px 7px;'));
  bar.appendChild(barBtn('⋯', openPresetsMenu, 'font-size:16px;padding:4px 8px;'));

  // ── Snap helper ────────────────────────────────────────────────────────────
  function snapAxis(w, nx, ny) {
    var bx = nx, by = ny, bw = w.size;
    var bcx = bx + bw / 2, bcy = by + bw / 2;
    var bx2 = bx + bw,     by2 = by + bw;
    var rx = nx, ry = ny;
    var bestX = SNAP_D, bestY = SNAP_D;

    for (var i = 0; i < widgets.length; i++) {
      var o = widgets[i];
      if (o === w) continue;
      var ow = o.size;
      var ocx = o.x + ow / 2, ocy = o.y + ow / 2;
      var ox2 = o.x + ow,     oy2 = o.y + ow;

      var xTargets = [o.x, ocx, ox2];
      var xAnchors = [{v:bx,off:0},{v:bcx,off:bw/2},{v:bx2,off:bw}];
      for (var xi = 0; xi < xTargets.length; xi++) {
        for (var xj = 0; xj < xAnchors.length; xj++) {
          var dxv = Math.abs(xAnchors[xj].v - xTargets[xi]);
          if (dxv < bestX) { bestX = dxv; rx = xTargets[xi] - xAnchors[xj].off; }
        }
      }

      var yTargets = [o.y, ocy, oy2];
      var yAnchors = [{v:by,off:0},{v:bcy,off:bw/2},{v:by2,off:bw}];
      for (var yi = 0; yi < yTargets.length; yi++) {
        for (var yj = 0; yj < yAnchors.length; yj++) {
          var dyv = Math.abs(yAnchors[yj].v - yTargets[yi]);
          if (dyv < bestY) { bestY = dyv; ry = yTargets[yi] - yAnchors[yj].off; }
        }
      }
    }
    return { x: rx, y: ry };
  }

  // ── Shared drag (move + resize) ────────────────────────────────────────────
  function doMoveDrag(touch) {
    if (!dragState || dragState.type !== 'move') return;
    var w = dragState.widget;
    var nx = dragState.bx + touch.clientX - dragState.tx;
    var ny = dragState.by + touch.clientY - dragState.ty;
    var s = snapAxis(w, nx, ny);
    w.x = Math.round(Math.max(0, Math.min(vViewW() - w.size, s.x)));
    w.y = Math.round(Math.max(0, Math.min(vViewH() - BAR_H - w.size, s.y)));
    w.el.style.left = w.x + 'px';
    w.el.style.top  = w.y + 'px';
  }

  // ── Edit handles (shared by buttons + joysticks) ───────────────────────────
  function attachEditHandles(w) {
    w.el.style.animation    = '_koPulse 1.6s ease-in-out infinite';
    w.el.style.outline      = '2px dashed rgba(255,225,55,.75)';
    w.el.style.outlineOffset = '4px';

    if (!w.deleteEl) {
      var d = document.createElement('div');
      d.textContent = '✕';
      d.setAttribute('style',
        'position:absolute;top:-9px;right:-9px;width:24px;height:24px;border-radius:50%;' +
        'background:rgba(215,40,40,.92);color:#fff;font-size:12px;font-weight:700;' +
        'display:flex;align-items:center;justify-content:center;' +
        'cursor:pointer;z-index:' + Z + ';box-shadow:0 1px 5px rgba(0,0,0,.5);pointer-events:all');
      d.addEventListener('touchend', function (e) {
        e.preventDefault(); e.stopPropagation(); destroyWidget(w);
      }, { passive:false });
      d.addEventListener('click', function (e) { e.stopPropagation(); destroyWidget(w); });
      w.el.appendChild(d);
      w.deleteEl = d;
    }

    if (!w.resizeEl) {
      var r = document.createElement('div');
      r.textContent = '◢';
      r.setAttribute('style',
        'position:absolute;bottom:-7px;right:-7px;width:22px;height:22px;border-radius:5px;' +
        'background:rgba(255,210,0,.82);color:rgba(0,0,0,.7);font-size:13px;' +
        'display:flex;align-items:center;justify-content:center;' +
        'cursor:se-resize;z-index:' + Z + ';pointer-events:all;touch-action:none');
      r.addEventListener('touchstart', function (e) {
        e.preventDefault(); e.stopPropagation();
        var t = e.touches[0];
        dragState = { type:'resize', widget:w, tx:t.clientX, ty:t.clientY, startSize:w.size };
      }, { passive:false });
      r.addEventListener('touchmove', function (e) {
        e.preventDefault(); e.stopPropagation();
        if (!dragState || dragState.type !== 'resize' || dragState.widget !== w) return;
        var t = e.touches[0];
        var delta = (t.clientX - dragState.tx + t.clientY - dragState.ty) / 2;
        var mn = w.type === 'joystick' ? MIN_JOY : MIN_BTN;
        var mx = w.type === 'joystick' ? MAX_JOY : MAX_BTN;
        w.size = Math.round(Math.max(mn, Math.min(mx, dragState.startSize + delta)));
        if (w.type === 'button') {
          w.el.style.width  = w.size + 'px';
          w.el.style.height = w.size + 'px';
          w.labelEl.style.fontSize = btnFontSize(w.label, w.size);
        } else {
          applyJoyStyle(w);
        }
      }, { passive:false });
      r.addEventListener('touchend', function (e) {
        e.preventDefault(); e.stopPropagation();
        if (dragState && dragState.type === 'resize') { persist(); dragState = null; }
      }, { passive:false });
      w.el.appendChild(r);
      w.resizeEl = r;
    }
  }

  function detachEditHandles(w) {
    if (w.deleteEl) { w.deleteEl.remove(); w.deleteEl = null; }
    if (w.resizeEl) { w.resizeEl.remove(); w.resizeEl = null; }
    w.el.style.animation     = '';
    w.el.style.outline       = '';
    w.el.style.outlineOffset = '';
  }

  function destroyWidget(w) {
    if (w.type === 'button')   pressEnd(w);
    if (w.type === 'joystick') stopJoystick(w);
    w.el.remove();
    widgets = widgets.filter(function (x) { return x.id !== w.id; });
    persist();
  }

  // ── Button widget ──────────────────────────────────────────────────────────
  function btnFontSize(label, size) {
    if (label.length > 3) return Math.max(9,  Math.round(size * 0.17)) + 'px';
    if (label.length > 2) return Math.max(10, Math.round(size * 0.20)) + 'px';
    return Math.max(12, Math.round(size * 0.28)) + 'px';
  }

  function applyBtnStyle(btn) {
    btn.el.style.cssText = (
      'position:absolute;left:' + btn.x + 'px;top:' + btn.y + 'px;' +
      'width:' + btn.size + 'px;height:' + btn.size + 'px;border-radius:12px;' +
      'background:radial-gradient(circle at 38% 35%,' +
        'rgba(255,255,255,.55) 0%,rgba(180,180,215,.4) 58%,rgba(90,90,140,.56) 100%);' +
      'backdrop-filter:blur(7px);-webkit-backdrop-filter:blur(7px);' +
      'border:1.5px solid rgba(255,255,255,.55);' +
      'box-shadow:0 2px 14px rgba(0,0,0,.45);' +
      'display:flex;align-items:center;justify-content:center;' +
      'font-family:-apple-system,sans-serif;font-weight:700;' +
      'color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.7);' +
      'pointer-events:all;user-select:none;-webkit-user-select:none;' +
      'touch-action:none;cursor:pointer;' +
      'z-index:' + (Z - 1) + ';overflow:visible;' +
      'transition:transform .08s ease,opacity .08s ease'
    );
    btn.labelEl.style.fontSize    = btnFontSize(btn.label, btn.size);
    btn.labelEl.style.pointerEvents = 'none';
    btn.labelEl.style.userSelect  = 'none';
    btn.labelEl.style.webkitUserSelect = 'none';
  }

  function makeButton(data) {
    var sz = data.size || DEF_BTN;
    var btn = {
      type:'button', id: data.id !== undefined ? data.id : (_uid++),
      key:data.key, code:data.code, label:data.label, size:sz,
      x: data.x !== undefined
        ? Math.max(0, Math.min(vViewW() - sz, data.x))
        : Math.round((vViewW() - sz) / 2),
      y: data.y !== undefined
        ? Math.max(0, Math.min(vViewH() - BAR_H - sz, data.y))
        : Math.round((vViewH() - BAR_H - sz) / 2),
      el:null, labelEl:null, deleteEl:null, resizeEl:null,
    };

    var el = document.createElement('div');
    btn.el = el;

    var lbl = document.createElement('span');
    lbl.textContent = btn.label;
    btn.labelEl = lbl;
    el.appendChild(lbl);

    applyBtnStyle(btn);

    el.addEventListener('touchstart', function (e) {
      e.preventDefault();
      if (editMode) {
        var t = e.touches[0];
        dragState = { type:'move', widget:btn, tx:t.clientX, ty:t.clientY, bx:btn.x, by:btn.y };
      } else {
        pressStart(btn);
        el.style.transform = 'scale(0.86)';
        el.style.opacity   = '.82';
      }
    }, { passive:false });

    el.addEventListener('touchmove', function (e) {
      e.preventDefault();
      if (editMode && dragState && dragState.type === 'move' && dragState.widget === btn)
        doMoveDrag(e.touches[0]);
    }, { passive:false });

    el.addEventListener('touchend', function (e) {
      e.preventDefault();
      if (editMode) {
        if (dragState && dragState.widget === btn) { persist(); dragState = null; }
      } else {
        pressEnd(btn);
        el.style.transform = 'scale(1)';
        el.style.opacity   = '1';
      }
    }, { passive:false });

    el.addEventListener('touchcancel', function () {
      if (!editMode) { pressEnd(btn); el.style.transform='scale(1)'; el.style.opacity='1'; }
      if (dragState && dragState.widget === btn) dragState = null;
    });

    root.appendChild(el);
    widgets.push(btn);
    if (editMode) attachEditHandles(btn);
    return btn;
  }

  // ── Joystick widget ────────────────────────────────────────────────────────
  function applyJoyStyle(joy) {
    joy.el.style.cssText = (
      'position:absolute;left:' + joy.x + 'px;top:' + joy.y + 'px;' +
      'width:' + joy.size + 'px;height:' + joy.size + 'px;' +
      'border-radius:50%;overflow:visible;pointer-events:all;touch-action:none;' +
      'z-index:' + (Z - 1) + ';cursor:pointer'
    );
    joy.innerEl.style.cssText = (
      'position:absolute;left:0;top:0;width:100%;height:100%;' +
      'border-radius:50%;overflow:hidden;box-sizing:border-box;' +
      'background:radial-gradient(circle,rgba(55,55,95,.7) 0%,rgba(10,10,28,.82) 100%);' +
      'border:2.5px solid rgba(255,255,255,.35);' +
      'backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);' +
      'box-shadow:0 3px 18px rgba(0,0,0,.55)'
    );
    var ts = Math.round(joy.size * 0.38);
    var center = Math.round((joy.size - ts) / 2);
    joy.thumbEl.style.cssText = (
      'position:absolute;width:' + ts + 'px;height:' + ts + 'px;border-radius:50%;' +
      'left:' + center + 'px;top:' + center + 'px;' +
      'background:radial-gradient(circle at 38% 35%,rgba(255,255,255,.72),rgba(130,130,200,.55));' +
      'border:1.5px solid rgba(255,255,255,.55);' +
      'box-shadow:0 2px 8px rgba(0,0,0,.5)'
    );
  }

  function makeJoystick(data) {
    var sz = data.size || DEF_JOY;
    var joy = {
      type:'joystick', id: data.id !== undefined ? data.id : (_uid++),
      size:sz,
      x: data.x !== undefined
        ? Math.max(0, Math.min(vViewW() - sz, data.x))
        : Math.round((vViewW() - sz) / 2),
      y: data.y !== undefined
        ? Math.max(0, Math.min(vViewH() - BAR_H - sz, data.y))
        : Math.round((vViewH() - BAR_H - sz) / 2),
      el:null, innerEl:null, thumbEl:null, deleteEl:null, resizeEl:null,
      // runtime (not persisted)
      active:false, rafId:null,
      ndx:0, ndy:0, magnitude:0,
      lastFire:{ ArrowUp:0, ArrowDown:0, ArrowLeft:0, ArrowRight:0 },
    };

    var outer = document.createElement('div');
    joy.el = outer;

    var inner = document.createElement('div');
    joy.innerEl = inner;

    var thumb = document.createElement('div');
    thumb.className = '_koThumb';
    joy.thumbEl = thumb;

    // Faint directional labels inside the ring
    var dirMarks = [
      { t:'↑', s:'left:50%;top:5px;transform:translateX(-50%)' },
      { t:'↓', s:'left:50%;bottom:5px;transform:translateX(-50%)' },
      { t:'←', s:'top:50%;left:5px;transform:translateY(-50%)' },
      { t:'→', s:'top:50%;right:5px;transform:translateY(-50%)' },
    ];
    dirMarks.forEach(function (m) {
      var mk = document.createElement('div');
      mk.textContent = m.t;
      mk.setAttribute('style',
        'position:absolute;font-size:11px;color:rgba(255,255,255,.28);' +
        'pointer-events:none;line-height:1;font-family:-apple-system,sans-serif;' + m.s);
      inner.appendChild(mk);
    });

    inner.appendChild(thumb);
    outer.appendChild(inner);
    applyJoyStyle(joy);

    outer.addEventListener('touchstart', function (e) {
      e.preventDefault();
      if (editMode) {
        var t = e.touches[0];
        dragState = { type:'move', widget:joy, tx:t.clientX, ty:t.clientY, bx:joy.x, by:joy.y };
        return;
      }
      joy.active = true;
      thumb.classList.add('_koThumbLive');
      updateThumb(joy, e.touches[0]);
      startJoyLoop(joy);
    }, { passive:false });

    outer.addEventListener('touchmove', function (e) {
      e.preventDefault();
      if (editMode && dragState && dragState.type === 'move' && dragState.widget === joy) {
        doMoveDrag(e.touches[0]);
        return;
      }
      if (joy.active) updateThumb(joy, e.touches[0]);
    }, { passive:false });

    outer.addEventListener('touchend', function (e) {
      e.preventDefault();
      if (editMode) {
        if (dragState && dragState.widget === joy) { persist(); dragState = null; }
        return;
      }
      stopJoystick(joy);
    }, { passive:false });

    outer.addEventListener('touchcancel', function () {
      if (editMode) { if (dragState && dragState.widget === joy) dragState = null; return; }
      stopJoystick(joy);
    });

    root.appendChild(outer);
    widgets.push(joy);
    if (editMode) attachEditHandles(joy);
    return joy;
  }

  function updateThumb(joy, touch) {
    var rect = joy.el.getBoundingClientRect();
    var cx = rect.left + joy.size / 2;
    var cy = rect.top  + joy.size / 2;
    var dx = touch.clientX - cx;
    var dy = touch.clientY - cy;
    var dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
    var ts   = Math.round(joy.size * 0.38);
    var maxR = (joy.size - ts) / 2;
    var clamp = Math.min(dist, maxR);
    joy.ndx = dx / dist;
    joy.ndy = dy / dist;
    joy.magnitude = Math.min(1, dist / maxR);
    joy.thumbEl.style.left = (joy.size / 2 - ts / 2 + joy.ndx * clamp) + 'px';
    joy.thumbEl.style.top  = (joy.size / 2 - ts / 2 + joy.ndy * clamp) + 'px';
  }

  function centerThumb(joy) {
    var ts = Math.round(joy.size * 0.38);
    var c  = Math.round((joy.size - ts) / 2);
    joy.thumbEl.style.left = c + 'px';
    joy.thumbEl.style.top  = c + 'px';
    joy.ndx = 0; joy.ndy = 0; joy.magnitude = 0;
  }

  function startJoyLoop(joy) {
    if (joy.rafId) return;
    function tick(now) {
      if (!joy.active) { joy.rafId = null; return; }
      joy.rafId = requestAnimationFrame(tick);

      // Per-axis magnitude: each of the 4 directions has its own 0..1 value
      var axes = [
        { key:'ArrowUp',    code:'ArrowUp',    mag: Math.max(0, -joy.ndy) * joy.magnitude },
        { key:'ArrowDown',  code:'ArrowDown',  mag: Math.max(0,  joy.ndy) * joy.magnitude },
        { key:'ArrowLeft',  code:'ArrowLeft',  mag: Math.max(0, -joy.ndx) * joy.magnitude },
        { key:'ArrowRight', code:'ArrowRight', mag: Math.max(0,  joy.ndx) * joy.magnitude },
      ];

      for (var i = 0; i < axes.length; i++) {
        var a = axes[i];
        if (a.mag > JOY_DEAD) {
          // Normalise magnitude past the deadzone to 0..1
          var norm = (a.mag - JOY_DEAD) / (1 - JOY_DEAD);
          var interval = JOY_SLOW - norm * (JOY_SLOW - JOY_FAST);
          if (now - (joy.lastFire[a.key] || 0) >= interval) {
            fireKey('keydown', a.key, a.code);
            joy.lastFire[a.key] = now;
          }
        } else if (joy.lastFire[a.key] > 0) {
          fireKey('keyup', a.key, a.code);
          joy.lastFire[a.key] = 0;
        }
      }
    }
    joy.rafId = requestAnimationFrame(tick);
  }

  function stopJoystick(joy) {
    joy.active = false;
    if (joy.rafId) { cancelAnimationFrame(joy.rafId); joy.rafId = null; }
    var jkeys = ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'];
    for (var i = 0; i < jkeys.length; i++) {
      if (joy.lastFire[jkeys[i]] > 0) {
        fireKey('keyup', jkeys[i], jkeys[i]);
        joy.lastFire[jkeys[i]] = 0;
      }
    }
    joy.thumbEl.classList.remove('_koThumbLive');
    centerThumb(joy);
  }

  function addJoystick() {
    makeJoystick({});
    persist();
    if (!editMode) toggleEdit();
  }

  // ── Edit mode ──────────────────────────────────────────────────────────────
  function toggleEdit() {
    editMode = !editMode;
    editBtn.textContent = editMode ? 'Done' : 'Edit';
    editBtn.style.background   = editMode ? 'rgba(255,200,0,.38)'   : 'rgba(255,255,255,.14)';
    editBtn.style.borderColor  = editMode ? 'rgba(255,220,60,.5)'   : 'rgba(255,255,255,.24)';
    widgets.forEach(function (w) {
      if (editMode) {
        attachEditHandles(w);
      } else {
        detachEditHandles(w);
        if (w.type === 'joystick' && w.active) stopJoystick(w);
      }
    });
    if (!editMode) dragState = null;
  }

  // ── Key picker keyboard ────────────────────────────────────────────────────
  var KB_ROWS = [
    ['q','w','e','r','t','y','u','i','o','p'],
    ['a','s','d','f','g','h','j','k','l'],
    ['z','x','c','v','b','n','m'],
    ['1','2','3','4','5','6','7','8','9','0'],
  ];
  var KB_SPECIAL = [
    {key:'ArrowUp',   lbl:'↑'},    {key:'ArrowDown', lbl:'↓'},
    {key:'ArrowLeft', lbl:'←'},    {key:'ArrowRight',lbl:'→'},
    {key:' ',         lbl:'Space'},{key:'Enter',      lbl:'↵ Enter'},
    {key:'Escape',    lbl:'Esc'},  {key:'Shift',      lbl:'⇧ Shift'},
    {key:'Control',   lbl:'Ctrl'},{key:'Alt',         lbl:'Alt'},
    {key:'Tab',       lbl:'⇥ Tab'},{key:'Backspace',  lbl:'⌫ Back'},
    {key:'Delete',    lbl:'Del'},  {key:'F1',          lbl:'F1'},
    {key:'F2',        lbl:'F2'},   {key:'F3',          lbl:'F3'},
    {key:'F4',        lbl:'F4'},   {key:'F5',          lbl:'F5'},
  ];

  function openAddModal() {
    var overlay = document.createElement('div');
    overlay.setAttribute('style',
      'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.65);' +
      'backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px);' +
      'display:flex;align-items:flex-end;justify-content:center;' +
      'z-index:' + (Z + 1) + ';pointer-events:all');
    overlay.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive:false });
    overlay.addEventListener('touchend', function (e) {
      if (e.target === overlay) { e.preventDefault(); overlay.remove(); }
    }, { passive:false });

    var modal = document.createElement('div');
    modal.setAttribute('style',
      'background:rgba(20,20,30,.97);border:1px solid rgba(255,255,255,.14);' +
      'border-radius:22px 22px 0 0;padding:18px 14px 36px;' +
      'width:100%;max-width:500px;box-sizing:border-box;' +
      'display:flex;flex-direction:column;gap:11px;' +
      'font-family:-apple-system,sans-serif;color:#fff;' +
      'box-shadow:0 -8px 40px rgba(0,0,0,.7);max-height:92vh;overflow:hidden');
    overlay.appendChild(modal);

    // Handle bar
    var handle = document.createElement('div');
    handle.setAttribute('style',
      'width:36px;height:4px;border-radius:2px;background:rgba(255,255,255,.25);margin:0 auto 4px');
    modal.appendChild(handle);

    // Title
    var titleEl = document.createElement('div');
    titleEl.textContent = 'Add Button';
    titleEl.setAttribute('style','font-size:17px;font-weight:700;text-align:center');
    modal.appendChild(titleEl);

    // Tabs
    var tabBar = document.createElement('div');
    tabBar.setAttribute('style',
      'display:flex;gap:5px;background:rgba(255,255,255,.07);border-radius:10px;padding:3px');
    modal.appendChild(tabBar);

    var activeTab = 'letters';
    var tabEls = {};

    function makeTab(text, id) {
      var t = document.createElement('button');
      t.textContent = text;
      t.setAttribute('style',
        'flex:1;padding:7px;border-radius:8px;border:none;font-size:12px;font-weight:600;' +
        'font-family:-apple-system,sans-serif;cursor:pointer;-webkit-tap-highlight-color:transparent');
      function refresh() {
        t.style.background = activeTab === id ? 'rgba(255,255,255,.2)' : 'transparent';
        t.style.color      = activeTab === id ? '#fff' : 'rgba(255,255,255,.45)';
      }
      refresh();
      tabEls[id] = refresh;
      function activate() {
        activeTab = id;
        Object.keys(tabEls).forEach(function(k){ tabEls[k](); });
        renderKb();
      }
      t.addEventListener('touchend', function(e){ e.preventDefault(); activate(); },{passive:false});
      t.addEventListener('click', activate);
      tabBar.appendChild(t);
    }
    makeTab('Letters & Numbers','letters');
    makeTab('Special Keys','special');

    // Selected key display
    var keyDisp = document.createElement('div');
    keyDisp.setAttribute('style',
      'height:34px;border-radius:9px;border:1px solid rgba(255,255,255,.14);' +
      'background:rgba(255,255,255,.06);display:flex;align-items:center;justify-content:center;' +
      'font-size:13px;color:rgba(255,255,255,.38)');
    keyDisp.textContent = 'Tap a key below to select it';
    modal.appendChild(keyDisp);

    // Keyboard scroll area
    var kbArea = document.createElement('div');
    kbArea.setAttribute('style',
      'overflow-y:auto;-webkit-overflow-scrolling:touch;flex:1;max-height:200px;' +
      'display:flex;flex-direction:column;gap:4px');
    modal.appendChild(kbArea);

    var selectedKey = null;
    var selectedEl  = null;

    function onSelect(key, el) {
      if (selectedEl) {
        selectedEl.style.background   = 'rgba(255,255,255,.1)';
        selectedEl.style.borderColor  = 'rgba(255,255,255,.18)';
        selectedEl.style.color        = '#fff';
      }
      selectedKey = key;
      selectedEl  = el;
      el.style.background  = 'rgba(0,110,255,.75)';
      el.style.borderColor = 'rgba(80,160,255,.8)';
      el.style.color       = '#fff';
      var resolved = resolveKey(key);
      keyDisp.textContent  = 'Selected: ' + (LABEL_MAP[resolved] || resolved);
      keyDisp.style.color  = '#88c8ff';
      if (!lblInp.dataset.manual) lblInp.value = autoLabel(resolved);
    }

    function kbKey(key, display, flex) {
      var b = document.createElement('button');
      b.textContent = display || key.toUpperCase();
      b.setAttribute('style',
        'height:36px;' + (flex === false ? 'flex:none;min-width:64px;' : 'flex:1;min-width:24px;') +
        'background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.18);' +
        'border-radius:7px;color:#fff;font-size:13px;font-weight:600;' +
        'font-family:-apple-system,sans-serif;cursor:pointer;' +
        '-webkit-tap-highlight-color:transparent;touch-action:manipulation;' +
        'padding:0 3px;box-sizing:border-box');
      b.addEventListener('touchend', function(e){ e.preventDefault(); onSelect(key,b); },{passive:false});
      b.addEventListener('click',    function(){ onSelect(key,b); });
      return b;
    }

    function renderKb() {
      kbArea.innerHTML = '';
      if (activeTab === 'letters') {
        KB_ROWS.forEach(function(row) {
          var rowEl = document.createElement('div');
          rowEl.setAttribute('style','display:flex;gap:3px');
          row.forEach(function(k){ rowEl.appendChild(kbKey(k, k.toUpperCase())); });
          kbArea.appendChild(rowEl);
        });
      } else {
        var grid = document.createElement('div');
        grid.setAttribute('style','display:flex;flex-wrap:wrap;gap:6px');
        KB_SPECIAL.forEach(function(item) {
          var b = kbKey(item.key, item.lbl, false);
          b.style.height    = '40px';
          b.style.fontSize  = '12px';
          grid.appendChild(b);
        });
        kbArea.appendChild(grid);
      }
    }
    renderKb();

    // Label field
    var lblWrap = document.createElement('div');
    lblWrap.setAttribute('style','display:flex;flex-direction:column;gap:5px');
    var lblLabel = document.createElement('label');
    lblLabel.textContent = 'DISPLAY LABEL';
    lblLabel.setAttribute('style',
      'font-size:10px;font-weight:600;color:rgba(255,255,255,.4);letter-spacing:.08em');
    var lblInp = document.createElement('input');
    lblInp.placeholder = 'Auto-filled from selection';
    lblInp.setAttribute('style',
      'background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.18);' +
      'border-radius:9px;padding:9px 11px;color:#fff;font-size:15px;outline:none;' +
      '-webkit-appearance:none;-webkit-text-fill-color:#fff;box-sizing:border-box;width:100%');
    lblInp.addEventListener('input', function() {
      lblInp.dataset.manual = lblInp.value ? '1' : '';
    });
    lblWrap.appendChild(lblLabel);
    lblWrap.appendChild(lblInp);
    modal.appendChild(lblWrap);

    // Action buttons
    var btnRow = document.createElement('div');
    btnRow.setAttribute('style','display:flex;gap:10px');

    function mBtn(text, bg, fn) {
      var b = document.createElement('button');
      b.textContent = text;
      b.setAttribute('style',
        'flex:1;padding:12px 0;border-radius:12px;background:' + bg + ';border:none;' +
        'color:#fff;font-size:16px;font-weight:600;cursor:pointer;' +
        '-webkit-tap-highlight-color:transparent;font-family:-apple-system,sans-serif');
      b.addEventListener('touchend', function(e){ e.preventDefault(); fn(); },{passive:false});
      b.addEventListener('click', fn);
      btnRow.appendChild(b);
    }

    mBtn('Cancel', 'rgba(255,255,255,.12)', function() { overlay.remove(); });
    mBtn('Add', 'rgba(0,116,255,.92)', function() {
      if (!selectedKey) {
        keyDisp.style.color  = 'rgba(255,80,80,.9)';
        keyDisp.textContent  = 'Please select a key first';
        return;
      }
      var key  = resolveKey(selectedKey);
      var code = codeFor(key);
      var lbl  = lblInp.value.trim() || autoLabel(key);
      overlay.remove();
      makeButton({ key:key, code:code, label:lbl });
      persist();
      if (!editMode) toggleEdit();
    });
    modal.appendChild(btnRow);

    root.appendChild(overlay);
  }

  // ── Presets ────────────────────────────────────────────────────────────────
  function getPresets() {
    var W = vViewW(), H = vViewH() - BAR_H;
    var s = DEF_BTN, g = 10;
    var lcx = Math.round(W * 0.17), lcy = Math.round(H * 0.73);
    var rcx = Math.round(W * 0.80), rcy = lcy;
    return {
      'D-Pad': [
        {key:'ArrowUp',    label:'↑', x:lcx,     y:lcy-(s+g)},
        {key:'ArrowLeft',  label:'←', x:lcx-(s+g),y:lcy      },
        {key:'ArrowDown',  label:'↓', x:lcx,     y:lcy+(s+g)},
        {key:'ArrowRight', label:'→', x:lcx+(s+g),y:lcy      },
      ],
      'WASD': [
        {key:'w', label:'W', x:lcx,      y:lcy-(s+g)},
        {key:'a', label:'A', x:lcx-(s+g), y:lcy      },
        {key:'s', label:'S', x:lcx,      y:lcy+(s+g)},
        {key:'d', label:'D', x:lcx+(s+g), y:lcy      },
      ],
      'Face Buttons': [
        {key:'z', label:'A', x:rcx,      y:lcy         },
        {key:'x', label:'B', x:rcx+(s+g), y:lcy+(s+g)/2},
      ],
      'Arrows + Space': [
        {key:'ArrowUp',    label:'↑', x:lcx,      y:lcy-(s+g)},
        {key:'ArrowLeft',  label:'←', x:lcx-(s+g), y:lcy      },
        {key:'ArrowDown',  label:'↓', x:lcx,      y:lcy+(s+g)},
        {key:'ArrowRight', label:'→', x:lcx+(s+g), y:lcy      },
        {key:' ',          label:'Spc',x:rcx,      y:lcy       },
      ],
    };
  }

  function openPresetsMenu() {
    var veil = document.createElement('div');
    veil.setAttribute('style',
      'position:absolute;top:0;left:0;right:0;bottom:0;' +
      'z-index:' + (Z + 1) + ';pointer-events:all');
    veil.addEventListener('touchend', function(e){
      if (e.target === veil){ e.preventDefault(); veil.remove(); }
    }, { passive:false });

    var menu = document.createElement('div');
    menu.setAttribute('style',
      'position:absolute;bottom:' + (BAR_H + 6) + 'px;right:10px;' +
      'background:rgba(20,20,30,.97);border:1px solid rgba(255,255,255,.16);' +
      'border-radius:14px;padding:7px;min-width:190px;' +
      'display:flex;flex-direction:column;gap:4px;' +
      'box-shadow:0 6px 30px rgba(0,0,0,.65);' +
      'font-family:-apple-system,sans-serif');

    var presets = getPresets();
    Object.keys(presets).forEach(function (name) {
      var items = presets[name];
      var b = document.createElement('button');
      b.textContent = name;
      b.setAttribute('style',
        'background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);' +
        'border-radius:9px;padding:10px 14px;color:#fff;font-size:14px;font-weight:600;' +
        'text-align:left;cursor:pointer;-webkit-tap-highlight-color:transparent;' +
        'font-family:-apple-system,sans-serif');
      function apply() {
        veil.remove();
        items.forEach(function(d){
          makeButton({ key:d.key, code:codeFor(d.key), label:d.label, x:d.x, y:d.y });
        });
        persist();
        if (!editMode) toggleEdit();
      }
      b.addEventListener('touchend', function(e){ e.preventDefault(); apply(); },{passive:false});
      b.addEventListener('click', apply);
      menu.appendChild(b);
    });

    var sep = document.createElement('div');
    sep.setAttribute('style','height:1px;background:rgba(255,255,255,.1);margin:4px 0');
    menu.appendChild(sep);

    var clearBtn = document.createElement('button');
    clearBtn.textContent = 'Clear all';
    clearBtn.setAttribute('style',
      'background:rgba(220,50,50,.18);border:1px solid rgba(255,80,80,.28);' +
      'border-radius:9px;padding:10px 14px;color:rgba(255,110,110,.9);font-size:14px;' +
      'font-weight:600;text-align:left;cursor:pointer;-webkit-tap-highlight-color:transparent;' +
      'font-family:-apple-system,sans-serif');
    function clearAll() {
      veil.remove();
      widgets.slice().forEach(destroyWidget);
    }
    clearBtn.addEventListener('touchend', function(e){ e.preventDefault(); clearAll(); },{passive:false});
    clearBtn.addEventListener('click', clearAll);
    menu.appendChild(clearBtn);

    veil.appendChild(menu);
    root.appendChild(veil);
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  var saved = loadSaved();
  for (var i = 0; i < saved.length; i++) {
    if (saved[i].type === 'joystick') makeJoystick(saved[i]);
    else makeButton(saved[i]);
  }

}());
