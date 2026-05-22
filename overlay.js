(function () {
  'use strict';

  if (window.__keyOverlayActive) return;
  window.__keyOverlayActive = true;

  var STORAGE_KEY = 'keyOverlay_v1_' + location.hostname;
  var BTN_SIZE = 60;
  var REPEAT_MS = 50;
  var Z = 2147483647;

  var editMode = false;
  var buttons = [];
  var dragState = null;
  var holdTimers = {};
  var _nextId = Date.now();

  // ── key helpers ────────────────────────────────────────────────────────────

  var KEY_ALIAS = {
    space: ' ', Space: ' ',
    up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
    esc: 'Escape', escape: 'Escape',
    enter: 'Enter', shift: 'Shift', ctrl: 'Control', control: 'Control',
    alt: 'Alt', tab: 'Tab', backspace: 'Backspace',
    del: 'Delete', delete: 'Delete',
  };

  var CODE_MAP = {
    ' ': 'Space', Enter: 'Enter', Shift: 'ShiftLeft', Control: 'ControlLeft',
    Alt: 'AltLeft', Escape: 'Escape', Tab: 'Tab', Backspace: 'Backspace',
    Delete: 'Delete', ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown',
    ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight',
  };

  var KEYCODE_MAP = {
    ' ': 32, Enter: 13, Shift: 16, Control: 17, Alt: 18,
    Escape: 27, Tab: 9, Backspace: 8, Delete: 46,
    ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40,
  };

  var LABEL_MAP = {
    ' ': 'Spc', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    Enter: '↵', Shift: '⇧', Control: 'Ctrl', Alt: 'Alt',
    Escape: 'Esc', Tab: '⇥', Backspace: '⌫', Delete: 'Del',
  };

  function resolveKey(raw) {
    var t = raw.trim();
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

  function legacyKeyCode(key) {
    if (KEYCODE_MAP[key] !== undefined) return KEYCODE_MAP[key];
    if (key.length === 1) return key.toUpperCase().charCodeAt(0);
    return 0;
  }

  function autoLabel(key) {
    return LABEL_MAP[key] || key;
  }

  // ── key event dispatch ─────────────────────────────────────────────────────

  function fireKey(type, key, code) {
    var lc = legacyKeyCode(key);
    var init = {
      key: key, code: code,
      keyCode: lc, which: lc,
      bubbles: true, cancelable: true,
    };

    var seen = [];
    var targets = [];

    function add(t) {
      if (t && seen.indexOf(t) === -1) {
        seen.push(t);
        targets.push(t);
      }
    }

    // Topmost canvas on the page
    var canvases = document.querySelectorAll('canvas');
    if (canvases.length) add(canvases[canvases.length - 1]);

    // Active element inside any same-origin iframes
    var iframes = document.querySelectorAll('iframe');
    for (var i = 0; i < iframes.length; i++) {
      try {
        var fd = iframes[i].contentDocument;
        if (fd) add(fd.activeElement || fd.body);
      } catch (e) {}
    }

    // Currently focused element (if not body)
    if (document.activeElement && document.activeElement !== document.body) {
      add(document.activeElement);
    }

    // document always receives it last as a fallback
    add(document);

    for (var j = 0; j < targets.length; j++) {
      try { targets[j].dispatchEvent(new KeyboardEvent(type, init)); } catch (e) {}
    }
  }

  function pressStart(btn) {
    fireKey('keydown', btn.key, btn.code);
    holdTimers[btn.id] = setInterval(function () {
      fireKey('keydown', btn.key, btn.code);
    }, REPEAT_MS);
  }

  function pressEnd(btn) {
    if (holdTimers[btn.id]) {
      clearInterval(holdTimers[btn.id]);
      delete holdTimers[btn.id];
    }
    fireKey('keyup', btn.key, btn.code);
  }

  // ── localStorage ───────────────────────────────────────────────────────────

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(
        buttons.map(function (b) {
          return { id: b.id, key: b.key, code: b.code, label: b.label, x: b.x, y: b.y };
        })
      ));
    } catch (e) {}
  }

  function loadSaved() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
    catch (e) { return []; }
  }

  // ── CSS ────────────────────────────────────────────────────────────────────

  var styleEl = document.createElement('style');
  styleEl.textContent =
    '@keyframes _koPulse{' +
      '0%,100%{box-shadow:0 2px 14px rgba(0,0,0,.45),0 0 0 0 rgba(255,220,50,.75)}' +
      '50%{box-shadow:0 2px 14px rgba(0,0,0,.45),0 0 0 9px rgba(255,220,50,0)}' +
    '}';
  document.head.appendChild(styleEl);

  // ── root container ─────────────────────────────────────────────────────────

  var root = document.createElement('div');
  root.id = '__keyOverlayRoot';
  root.setAttribute('style',
    'position:fixed;top:0;left:0;width:100%;height:100%;' +
    'pointer-events:none;z-index:' + Z
  );
  (document.body || document.documentElement).appendChild(root);

  // ── control bar ────────────────────────────────────────────────────────────

  var bar = document.createElement('div');
  bar.setAttribute('style',
    'position:fixed;top:0;left:0;right:0;height:44px;' +
    'background:rgba(0,0,0,.58);' +
    'backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);' +
    'display:flex;align-items:center;justify-content:flex-end;' +
    'padding:0 12px;gap:8px;pointer-events:all;z-index:' + Z + ';box-sizing:border-box;' +
    'border-bottom:1px solid rgba(255,255,255,.1)'
  );
  root.appendChild(bar);

  // Prevent bar touches from scrolling the page
  bar.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive: false });

  function barButton(text, handler, extraStyle) {
    var b = document.createElement('button');
    b.textContent = text;
    b.setAttribute('style',
      'background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.3);' +
      'color:#fff;border-radius:8px;padding:5px 13px;' +
      'font-size:14px;font-weight:600;font-family:-apple-system,sans-serif;' +
      'cursor:pointer;-webkit-tap-highlight-color:transparent;' +
      'touch-action:manipulation;min-height:32px;' + (extraStyle || '')
    );
    b.addEventListener('touchend', function (e) { e.preventDefault(); handler(); }, { passive: false });
    b.addEventListener('click', handler);
    return b;
  }

  // Close button on the left
  var closeBtn = barButton('✕', function () {
    root.remove();
    styleEl.remove();
    window.__keyOverlayActive = false;
  }, 'background:rgba(255,55,55,.3);border-color:rgba(255,100,100,.35);margin-right:auto;');
  bar.appendChild(closeBtn);

  var editBtn = barButton('Edit', toggleEdit);
  bar.appendChild(editBtn);

  var addBtn = barButton('+', openAddModal, 'padding:5px 15px;font-size:18px;');
  bar.appendChild(addBtn);

  // ── button lifecycle ───────────────────────────────────────────────────────

  function btnFontSize(label) {
    return label.length > 3 ? '11px' : label.length > 2 ? '13px' : '17px';
  }

  function makeButton(data) {
    var btn = {
      id: data.id !== undefined ? data.id : (_nextId++),
      key: data.key,
      code: data.code,
      label: data.label,
      x: data.x !== undefined
        ? Math.max(0, Math.min(window.innerWidth - BTN_SIZE, data.x))
        : Math.round((window.innerWidth - BTN_SIZE) / 2),
      y: data.y !== undefined
        ? Math.max(48, Math.min(window.innerHeight - BTN_SIZE, data.y))
        : Math.round((window.innerHeight - BTN_SIZE) / 2),
      el: null,
      deleteEl: null,
    };

    var el = document.createElement('div');
    btn.el = el;
    refreshBtnStyle(btn);
    el.textContent = btn.label;

    el.addEventListener('touchstart', function (e) {
      e.preventDefault();
      if (editMode) {
        var t = e.touches[0];
        dragState = { btn: btn, tx: t.clientX, ty: t.clientY, bx: btn.x, by: btn.y };
      } else {
        pressStart(btn);
        el.style.transform = 'scale(0.86)';
        el.style.opacity = '0.85';
      }
    }, { passive: false });

    el.addEventListener('touchmove', function (e) {
      e.preventDefault();
      if (editMode && dragState && dragState.btn === btn) {
        var t = e.touches[0];
        var nx = Math.max(0, Math.min(window.innerWidth - BTN_SIZE, dragState.bx + t.clientX - dragState.tx));
        var ny = Math.max(48, Math.min(window.innerHeight - BTN_SIZE, dragState.by + t.clientY - dragState.ty));
        btn.x = Math.round(nx);
        btn.y = Math.round(ny);
        el.style.left = btn.x + 'px';
        el.style.top = btn.y + 'px';
      }
    }, { passive: false });

    el.addEventListener('touchend', function (e) {
      e.preventDefault();
      if (editMode) {
        if (dragState && dragState.btn === btn) { persist(); dragState = null; }
      } else {
        pressEnd(btn);
        el.style.transform = 'scale(1)';
        el.style.opacity = '1';
      }
    }, { passive: false });

    el.addEventListener('touchcancel', function () {
      if (!editMode) {
        pressEnd(btn);
        el.style.transform = 'scale(1)';
        el.style.opacity = '1';
      }
      if (dragState && dragState.btn === btn) dragState = null;
    });

    root.appendChild(el);
    buttons.push(btn);

    if (editMode) attachDeleteBtn(btn);
    return btn;
  }

  function refreshBtnStyle(btn) {
    btn.el.setAttribute('style',
      'position:fixed;' +
      'left:' + btn.x + 'px;top:' + btn.y + 'px;' +
      'width:' + BTN_SIZE + 'px;height:' + BTN_SIZE + 'px;' +
      'border-radius:50%;' +
      'background:radial-gradient(circle at 38% 35%,' +
        'rgba(255,255,255,.55) 0%,' +
        'rgba(180,180,215,.4) 58%,' +
        'rgba(95,95,145,.55) 100%);' +
      'backdrop-filter:blur(7px);-webkit-backdrop-filter:blur(7px);' +
      'border:1.5px solid rgba(255,255,255,.55);' +
      'box-shadow:0 2px 14px rgba(0,0,0,.45);' +
      'display:flex;align-items:center;justify-content:center;' +
      'font-size:' + btnFontSize(btn.label) + ';' +
      'font-family:-apple-system,sans-serif;font-weight:700;' +
      'color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.7);' +
      'pointer-events:all;user-select:none;-webkit-user-select:none;' +
      'touch-action:none;cursor:pointer;' +
      'z-index:' + (Z - 1) + ';' +
      'box-sizing:border-box;overflow:visible;' +
      'transition:transform .08s ease,opacity .08s ease'
    );
  }

  function attachDeleteBtn(btn) {
    if (btn.deleteEl) return;
    var d = document.createElement('div');
    d.textContent = '✕';
    d.setAttribute('style',
      'position:absolute;top:-8px;right:-8px;' +
      'width:24px;height:24px;border-radius:50%;' +
      'background:rgba(215,40,40,.92);' +
      'color:#fff;font-size:13px;font-weight:700;' +
      'display:flex;align-items:center;justify-content:center;' +
      'cursor:pointer;z-index:' + Z + ';line-height:1;' +
      'box-shadow:0 1px 5px rgba(0,0,0,.55);' +
      'pointer-events:all'
    );
    d.addEventListener('touchend', function (e) {
      e.preventDefault();
      e.stopPropagation();
      destroyButton(btn);
    }, { passive: false });
    d.addEventListener('click', function (e) {
      e.stopPropagation();
      destroyButton(btn);
    });
    btn.el.appendChild(d);
    btn.deleteEl = d;
  }

  function detachDeleteBtn(btn) {
    if (btn.deleteEl) { btn.deleteEl.remove(); btn.deleteEl = null; }
  }

  function destroyButton(btn) {
    pressEnd(btn);
    btn.el.remove();
    buttons = buttons.filter(function (b) { return b.id !== btn.id; });
    persist();
  }

  // ── edit mode ──────────────────────────────────────────────────────────────

  function toggleEdit() {
    editMode = !editMode;
    if (editMode) {
      editBtn.textContent = 'Done';
      editBtn.style.background = 'rgba(255,200,0,.38)';
      editBtn.style.borderColor = 'rgba(255,220,60,.5)';
      buttons.forEach(function (btn) {
        btn.el.style.animation = '_koPulse 1.6s ease-in-out infinite';
        btn.el.style.outline = '2px dashed rgba(255,225,55,.75)';
        btn.el.style.outlineOffset = '4px';
        attachDeleteBtn(btn);
      });
    } else {
      editBtn.textContent = 'Edit';
      editBtn.style.background = 'rgba(255,255,255,.18)';
      editBtn.style.borderColor = 'rgba(255,255,255,.3)';
      dragState = null;
      buttons.forEach(function (btn) {
        btn.el.style.animation = '';
        btn.el.style.outline = '';
        btn.el.style.outlineOffset = '';
        detachDeleteBtn(btn);
      });
    }
  }

  // ── add-button modal ───────────────────────────────────────────────────────

  function openAddModal() {
    var overlay = document.createElement('div');
    overlay.setAttribute('style',
      'position:fixed;top:0;left:0;right:0;bottom:0;' +
      'background:rgba(0,0,0,.65);' +
      'backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px);' +
      'display:flex;align-items:center;justify-content:center;' +
      'z-index:' + (Z + 1) + ';pointer-events:all'
    );
    overlay.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive: false });

    var modal = document.createElement('div');
    modal.setAttribute('style',
      'background:rgba(25,25,35,.97);' +
      'border:1px solid rgba(255,255,255,.18);border-radius:20px;' +
      'padding:26px 22px 22px;width:300px;max-width:calc(100vw - 28px);' +
      'display:flex;flex-direction:column;gap:16px;' +
      'font-family:-apple-system,sans-serif;color:#fff;' +
      'box-shadow:0 12px 50px rgba(0,0,0,.75)'
    );

    var titleEl = document.createElement('div');
    titleEl.textContent = 'Add Button';
    titleEl.setAttribute('style', 'font-size:20px;font-weight:700;letter-spacing:.01em');
    modal.appendChild(titleEl);

    function field(labelText, placeholder) {
      var wrap = document.createElement('div');
      wrap.setAttribute('style', 'display:flex;flex-direction:column;gap:7px');
      var lbl = document.createElement('label');
      lbl.textContent = labelText;
      lbl.setAttribute('style',
        'font-size:11px;font-weight:600;color:rgba(255,255,255,.55);' +
        'text-transform:uppercase;letter-spacing:.07em'
      );
      var inp = document.createElement('input');
      inp.placeholder = placeholder;
      inp.setAttribute('style',
        'background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.2);' +
        'border-radius:10px;padding:10px 12px;color:#fff;font-size:16px;outline:none;' +
        '-webkit-appearance:none;-webkit-text-fill-color:#fff'
      );
      wrap.appendChild(lbl);
      wrap.appendChild(inp);
      modal.appendChild(wrap);
      return inp;
    }

    var keyInp = field('Key name', 'e.g. ArrowUp, w, Space, Enter, Shift');
    var lblInp = field('Label on button', 'e.g. ↑, W, Spc');

    // Hint row
    var hint = document.createElement('div');
    hint.textContent = 'Single chars (w, a, s, d) or: ArrowUp / Down / Left / Right, Space, Enter, Shift, Escape, Control, Alt, Backspace';
    hint.setAttribute('style', 'font-size:11px;color:rgba(255,255,255,.38);line-height:1.5;margin-top:-6px');
    modal.appendChild(hint);

    var autoFilled = false;
    keyInp.addEventListener('input', function () {
      if (!lblInp.value || autoFilled) {
        lblInp.value = autoLabel(resolveKey(keyInp.value));
        autoFilled = true;
      }
    });
    lblInp.addEventListener('input', function () { autoFilled = false; });

    var btnRow = document.createElement('div');
    btnRow.setAttribute('style', 'display:flex;gap:10px;margin-top:4px');

    function mBtn(text, bg, fn) {
      var b = document.createElement('button');
      b.textContent = text;
      b.setAttribute('style',
        'flex:1;padding:12px 0;border-radius:12px;background:' + bg + ';border:none;' +
        'color:#fff;font-size:16px;font-weight:600;cursor:pointer;' +
        '-webkit-tap-highlight-color:transparent;font-family:-apple-system,sans-serif'
      );
      b.addEventListener('touchend', function (e) { e.preventDefault(); fn(); }, { passive: false });
      b.addEventListener('click', fn);
      btnRow.appendChild(b);
    }

    mBtn('Cancel', 'rgba(255,255,255,.14)', function () { overlay.remove(); });
    mBtn('Add', 'rgba(0,120,255,.92)', function () {
      var raw = keyInp.value.trim();
      if (!raw) {
        keyInp.style.borderColor = 'rgba(255,70,70,.8)';
        return;
      }
      var key = resolveKey(raw);
      var code = codeFor(key);
      var lbl = lblInp.value.trim() || autoLabel(key);
      overlay.remove();
      makeButton({ key: key, code: code, label: lbl });
      persist();
      if (!editMode) toggleEdit();
    });

    modal.appendChild(btnRow);
    overlay.appendChild(modal);
    root.appendChild(overlay);

    // Dismiss on backdrop tap
    overlay.addEventListener('touchend', function (e) {
      if (e.target === overlay) { e.preventDefault(); overlay.remove(); }
    }, { passive: false });

    setTimeout(function () { keyInp.focus(); }, 130);
  }

  // ── initialise from saved layout ───────────────────────────────────────────

  var saved = loadSaved();
  for (var i = 0; i < saved.length; i++) {
    makeButton(saved[i]);
  }

}());
