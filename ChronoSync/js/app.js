(function () {
  'use strict';

  var MAX_WORK_PX = 1500;
  var LABEL_POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
  var LABEL_PADDING = 14;
  var LABEL_FONT_SIZE_RATIO = 0.035;
  var KEYPOINT_RADIUS = 4;

  var state = {
    lang: 'en',
    theme: window.SharedUiCore ? window.SharedUiCore.getPreferredTheme() : (localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')),
    photos: [],
    refIdx: 0,
    aligned: false,
    showKeypoints: true,
    collageBase: null,
    edits: { brightness: 0, contrast: 0, saturation: 0 },
    pickerPhotoId: null,
    pickerHsv: { h: 0, s: 0, v: 100 }
  };

  var i18n = window.ChronoSyncI18n || { getCopy: function (l) { return { lang: l }; } };

  // ── DOM ─────────────────────────────────────────────────────────────────────

  var dom = {};
  function cacheDOM() {
    dom.fileAdd               = document.getElementById('file-add');
    dom.selectReference       = document.getElementById('select-reference');
    dom.btnAlign              = document.getElementById('btn-align');
    dom.btnClear              = document.getElementById('btn-clear');
    dom.photoCardsGrid        = document.getElementById('photo-cards-grid');
    dom.statusUpload          = document.getElementById('status-upload');
    dom.progressBarWrap       = document.getElementById('progress-bar-wrap');
    dom.progressBar           = document.getElementById('progress-bar');
    dom.panelPreview          = document.getElementById('panel-preview');
    dom.toggleKeypoints       = document.getElementById('toggle-keypoints');
    dom.btnCompose            = document.getElementById('btn-compose');
    dom.btnDownload           = document.getElementById('btn-download');
    dom.alignedGrid           = document.getElementById('aligned-grid');
    dom.panelOutputEdits      = document.getElementById('panel-output-edits');
    dom.outputBrightness      = document.getElementById('output-brightness');
    dom.outputContrast        = document.getElementById('output-contrast');
    dom.outputSaturation      = document.getElementById('output-saturation');
    dom.valBrightness         = document.getElementById('val-output-brightness');
    dom.valContrast           = document.getElementById('val-output-contrast');
    dom.valSaturation         = document.getElementById('val-output-saturation');
    dom.btnOutputReset        = document.getElementById('btn-output-reset');
    dom.collageCanvas         = document.getElementById('collage-canvas');
    dom.collageWrap           = document.getElementById('collage-wrap');
    dom.colorPickerDialog     = document.getElementById('color-picker-dialog');
    dom.btnCloseColor         = document.getElementById('btn-close-color');
    dom.modalSv               = document.getElementById('modal-sv');
    dom.modalSvThumb          = document.getElementById('modal-sv-thumb');
    dom.modalHue              = document.getElementById('modal-hue');
    dom.modalR                = document.getElementById('modal-r');
    dom.modalG                = document.getElementById('modal-g');
    dom.modalB                = document.getElementById('modal-b');
    dom.modalHex              = document.getElementById('modal-hex');
  }

  // ── EXIF date reading ────────────────────────────────────────────────────────

  function readExifDate(file) {
    return new Promise(function (resolve) {
      var reader = new FileReader();
      reader.onload = function (e) {
        try {
          var buf = new Uint8Array(e.target.result);
          if (buf[0] !== 0xFF || buf[1] !== 0xD8) { resolve(null); return; }
          var ascii = new TextDecoder('ascii', { fatal: false }).decode(buf.slice(0, 65536));
          var m = ascii.match(/(\d{4}):(\d{2}):(\d{2}) \d{2}:\d{2}:\d{2}/);
          resolve(m ? (m[1] + '-' + m[2] + '-' + m[3]) : null);
        } catch (_) { resolve(null); }
      };
      reader.onerror = function () { resolve(null); };
      reader.readAsArrayBuffer(file.slice(0, 65536));
    });
  }

  // ── Image resize helpers ─────────────────────────────────────────────────────

  function loadImageFromFile(file) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload  = function () { resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(); };
      img.src = url;
      img._objectUrl = url;
    });
  }

  function resizeToBase64(img, maxPx) {
    var scale = Math.min(1, maxPx / Math.max(img.width, img.height));
    var w = Math.round(img.width * scale);
    var h = Math.round(img.height * scale);
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/jpeg', 0.88);
  }

  // ── Color picker ─────────────────────────────────────────────────────────────

  function rgbToHex(r, g, b) {
    var c = function (v) { return Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'); };
    return ('#' + c(r) + c(g) + c(b)).toUpperCase();
  }

  function hexToRgb(hex) {
    var h = (hex || '#808080').replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  function rgbToHsv(r, g, b) {
    var rn = r / 255, gn = g / 255, bn = b / 255;
    var max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
    var delta = max - min, h = 0;
    if (delta) {
      if (max === rn)      h = ((gn - bn) / delta) % 6;
      else if (max === gn) h = (bn - rn) / delta + 2;
      else                 h = (rn - gn) / delta + 4;
      h = Math.round(h * 60);
      if (h < 0) h += 360;
    }
    return { h: h, s: max ? (delta / max) * 100 : 0, v: max * 100 };
  }

  function hsvToRgb(h, s, v) {
    var hh = ((h % 360) + 360) % 360;
    var ss = Math.max(0, Math.min(100, s)) / 100;
    var vv = Math.max(0, Math.min(100, v)) / 100;
    var c = vv * ss, x = c * (1 - Math.abs(((hh / 60) % 2) - 1)), m = vv - c;
    var r1 = 0, g1 = 0, b1 = 0;
    if (hh < 60)       { r1 = c; g1 = x; }
    else if (hh < 120) { r1 = x; g1 = c; }
    else if (hh < 180) { g1 = c; b1 = x; }
    else if (hh < 240) { g1 = x; b1 = c; }
    else if (hh < 300) { r1 = x; b1 = c; }
    else               { r1 = c; b1 = x; }
    return [Math.round((r1 + m) * 255), Math.round((g1 + m) * 255), Math.round((b1 + m) * 255)];
  }

  function syncPickerUI() {
    if (!dom.modalSv) return;
    var h = state.pickerHsv.h, s = state.pickerHsv.s, v = state.pickerHsv.v;
    dom.modalSv.style.setProperty('--picker-hue', h + 'deg');
    dom.modalSvThumb.style.left = s + '%';
    dom.modalSvThumb.style.top  = (100 - v) + '%';
    if (document.activeElement !== dom.modalHue) dom.modalHue.value = String(Math.round(h));
    var rgb = hsvToRgb(h, s, v);
    if (document.activeElement !== dom.modalR) dom.modalR.value = String(rgb[0]);
    if (document.activeElement !== dom.modalG) dom.modalG.value = String(rgb[1]);
    if (document.activeElement !== dom.modalB) dom.modalB.value = String(rgb[2]);
    var hex = rgbToHex(rgb[0], rgb[1], rgb[2]);
    if (document.activeElement !== dom.modalHex) dom.modalHex.value = hex;
  }

  function applyPickerColor() {
    var id = state.pickerPhotoId;
    if (!id) return;
    var photo = findPhoto(id);
    if (!photo) return;
    var rgb = hsvToRgb(state.pickerHsv.h, state.pickerHsv.s, state.pickerHsv.v);
    photo.labelColor = rgbToHex(rgb[0], rgb[1], rgb[2]);
    updateSwatchInCard(id, photo.labelColor);
    syncPickerUI();
  }

  function openColorPicker(photoId) {
    var photo = findPhoto(photoId);
    if (!photo || !dom.colorPickerDialog) return;
    state.pickerPhotoId = photoId;
    var rgb = hexToRgb(photo.labelColor);
    state.pickerHsv = rgbToHsv(rgb[0], rgb[1], rgb[2]);
    syncPickerUI();
    dom.colorPickerDialog.showModal();
  }

  function bindColorPicker() {
    if (!dom.colorPickerDialog) return;

    dom.btnCloseColor.addEventListener('click', function () { dom.colorPickerDialog.close(); });

    dom.modalSv.addEventListener('pointerdown', function (e) {
      function move(ev) {
        var rect = dom.modalSv.getBoundingClientRect();
        state.pickerHsv.s = Math.max(0, Math.min(100, ((ev.clientX - rect.left) / rect.width) * 100));
        state.pickerHsv.v = Math.max(0, Math.min(100, (1 - (ev.clientY - rect.top) / rect.height) * 100));
        applyPickerColor();
      }
      move(e);
      var up = function () { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });

    dom.modalHue.addEventListener('input', function () {
      state.pickerHsv.h = Number(this.value);
      applyPickerColor();
    });

    [dom.modalR, dom.modalG, dom.modalB].forEach(function (el) {
      el.addEventListener('input', function () {
        var r = Number(dom.modalR.value), g = Number(dom.modalG.value), b = Number(dom.modalB.value);
        state.pickerHsv = rgbToHsv(r, g, b);
        applyPickerColor();
      });
    });

    dom.modalHex.addEventListener('input', function () {
      var val = this.value.trim();
      if (!/^#[0-9A-Fa-f]{6}$/.test(val)) return;
      var rgb = hexToRgb(val);
      state.pickerHsv = rgbToHsv(rgb[0], rgb[1], rgb[2]);
      applyPickerColor();
    });

    document.querySelectorAll('.palette-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        var rgb = hexToRgb(this.dataset.paletteColor);
        state.pickerHsv = rgbToHsv(rgb[0], rgb[1], rgb[2]);
        applyPickerColor();
      });
    });
  }

  function updateSwatchInCard(photoId, color) {
    var swatch = document.querySelector('[data-photo-id="' + photoId + '"] .label-color-swatch');
    if (swatch) swatch.style.setProperty('--swatch', color);
  }

  // ── Photo state helpers ──────────────────────────────────────────────────────

  var _photoCounter = 0;
  function makePhotoId() { return 'p' + (++_photoCounter); }

  function findPhoto(id) {
    return state.photos.find(function (p) { return p.id === id; }) || null;
  }

  function removePhoto(id) {
    var idx = state.photos.findIndex(function (p) { return p.id === id; });
    if (idx === -1) return;
    var photo = state.photos[idx];
    if (photo.objectUrl) URL.revokeObjectURL(photo.objectUrl);
    state.photos.splice(idx, 1);
    if (state.refIdx >= state.photos.length) state.refIdx = Math.max(0, state.photos.length - 1);
    renderPhotoGrid();
    syncReferenceSelect();
    updateAlignButtonState();
    invalidateAlignment();
  }

  function invalidateAlignment() {
    state.aligned = false;
    state.collageBase = null;
    if (dom.panelPreview) dom.panelPreview.classList.add('hidden');
    if (dom.panelOutputEdits) dom.panelOutputEdits.classList.add('hidden');
    if (dom.btnDownload) dom.btnDownload.disabled = true;
    setEditControlsEnabled(false);
  }

  // ── Photo cards UI ───────────────────────────────────────────────────────────

  function createPhotoCard(photo) {
    var card = document.createElement('article');
    card.className = 'photo-card';
    card.dataset.photoId = photo.id;

    card.innerHTML = [
      '<div class="photo-card-header">',
      '  <span class="photo-card-name">' + escapeHtml(photo.name) + '</span>',
      '  <button class="btn-card-remove shared-icon-btn shared-icon-btn-sm" type="button" aria-label="Remove photo" title="Remove">',
      '    <svg viewBox="0 0 24 24" role="presentation" focusable="false" width="16" height="16">',
      '      <path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
      '    </svg>',
      '  </button>',
      '</div>',
      '<canvas class="photo-thumb" width="240" height="160"></canvas>',
      '<div class="photo-label-config">',
      '  <label class="label-toggle">',
      '    <input type="checkbox" class="label-enabled-check" ' + (photo.labelEnabled ? 'checked' : '') + '>',
      '    <span class="label-toggle-text">Date label</span>',
      '  </label>',
      '  <div class="label-controls ' + (photo.labelEnabled ? '' : 'hidden') + '">',
      '    <input type="text" class="label-text-input" value="' + escapeHtml(photo.labelText) + '" placeholder="Date" aria-label="Date label text">',
      '    <button class="label-color-swatch btn-ghost btn-sm" type="button" aria-label="Pick label color" style="--swatch:' + photo.labelColor + '"></button>',
      '    <select class="label-pos-select" aria-label="Label position">',
      LABEL_POSITIONS.map(function (pos) {
        return '<option value="' + pos + '"' + (photo.labelPosition === pos ? ' selected' : '') + '>' + pos.replace('-', ' ') + '</option>';
      }).join(''),
      '    </select>',
      '  </div>',
      '</div>'
    ].join('\n');

    card.querySelector('.btn-card-remove').addEventListener('click', function () { removePhoto(photo.id); });

    var check = card.querySelector('.label-enabled-check');
    check.addEventListener('change', function () {
      photo.labelEnabled = this.checked;
      card.querySelector('.label-controls').classList.toggle('hidden', !this.checked);
    });

    card.querySelector('.label-text-input').addEventListener('input', function () {
      photo.labelText = this.value;
    });

    card.querySelector('.label-color-swatch').addEventListener('click', function () {
      openColorPicker(photo.id);
    });

    card.querySelector('.label-pos-select').addEventListener('change', function () {
      photo.labelPosition = this.value;
    });

    var canvas = card.querySelector('.photo-thumb');
    if (photo.originalImg) {
      drawThumb(photo.originalImg, canvas);
    }

    return card;
  }

  function drawThumb(img, canvas) {
    var maxW = 240, maxH = 160;
    var scale = Math.min(maxW / img.width, maxH / img.height);
    canvas.width  = Math.round(img.width  * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  }

  function renderPhotoGrid() {
    if (!dom.photoCardsGrid) return;
    dom.photoCardsGrid.innerHTML = '';
    state.photos.forEach(function (photo) {
      dom.photoCardsGrid.appendChild(createPhotoCard(photo));
    });
    updateStatusText();
    updateClearButton();
  }

  function updateStatusText() {
    if (!dom.statusUpload) return;
    var n = state.photos.length;
    if (n === 0) dom.statusUpload.textContent = 'Add at least two photos to begin.';
    else if (n === 1) dom.statusUpload.textContent = 'Add at least one more photo.';
    else dom.statusUpload.textContent = n + ' photos loaded. Click "Align photos" to process.';
  }

  function syncReferenceSelect() {
    if (!dom.selectReference) return;
    dom.selectReference.innerHTML = '';
    state.photos.forEach(function (photo, idx) {
      var opt = document.createElement('option');
      opt.value = String(idx);
      opt.textContent = photo.name;
      if (idx === state.refIdx) opt.selected = true;
      dom.selectReference.appendChild(opt);
    });
  }

  function updateAlignButtonState() {
    if (dom.btnAlign) dom.btnAlign.disabled = state.photos.length < 2;
  }

  function updateClearButton() {
    if (dom.btnClear) dom.btnClear.disabled = state.photos.length === 0;
  }

  // ── Add photos ───────────────────────────────────────────────────────────────

  async function addFiles(files) {
    var arr = Array.from(files).filter(function (f) { return f.type.startsWith('image/'); });
    if (!arr.length) return;

    for (var i = 0; i < arr.length; i++) {
      var file = arr[i];
      try {
        var img = await loadImageFromFile(file);
        var exifDate = await readExifDate(file);
        var photo = {
          id: makePhotoId(),
          file: file,
          name: file.name.replace(/\.[^.]+$/, ''),
          objectUrl: img._objectUrl,
          originalImg: img,
          exifDate: exifDate,
          labelEnabled: Boolean(exifDate),
          labelText: exifDate || '',
          labelColor: '#FFFFFF',
          labelPosition: 'bottom-left',
          alignedB64: null,
          kpRef: [],
          kpImg: [],
          nInliers: 0,
          isReference: false
        };
        state.photos.push(photo);
      } catch (_) {}
    }

    renderPhotoGrid();
    syncReferenceSelect();
    updateAlignButtonState();
    invalidateAlignment();
  }

  // ── Alignment ────────────────────────────────────────────────────────────────

  function setProgress(pct, msg) {
    if (dom.progressBar) dom.progressBar.style.width = pct + '%';
    if (dom.statusUpload) dom.statusUpload.textContent = msg || '';
    if (dom.progressBarWrap) dom.progressBarWrap.classList.toggle('hidden', pct <= 0);
  }

  async function runAlignment() {
    if (state.photos.length < 2) return;
    if (dom.btnAlign) dom.btnAlign.disabled = true;

    setProgress(5, 'Loading alignment engine…');

    try {
      window.ChronoSyncWorker.preload();
      setProgress(15, 'Resizing images…');

      var imagesB64 = state.photos.map(function (p) {
        return resizeToBase64(p.originalImg, MAX_WORK_PX);
      });

      setProgress(30, 'Detecting and matching features…');

      var result = await window.ChronoSyncWorker.run({
        ref_idx: state.refIdx,
        images: imagesB64
      });

      setProgress(85, 'Applying alignment…');

      result.forEach(function (r, idx) {
        var photo = state.photos[idx];
        if (!photo) return;
        photo.alignedB64   = r.aligned_b64;
        photo.kpRef        = r.kp_ref;
        photo.kpImg        = r.kp_img;
        photo.nInliers     = r.n_inliers;
        photo.isReference  = r.is_reference;
      });

      state.aligned = true;
      setProgress(0, state.photos.length + ' photos aligned. Click "Compose collage" to assemble.');
      showAlignedPreview();
      if (dom.panelPreview) dom.panelPreview.classList.remove('hidden');
    } catch (err) {
      setProgress(0, 'Alignment error: ' + err.message);
      console.error('ChronoSync alignment error', err);
    }

    if (dom.btnAlign) dom.btnAlign.disabled = false;
  }

  // ── Aligned preview ──────────────────────────────────────────────────────────

  function showAlignedPreview() {
    if (!dom.alignedGrid) return;
    dom.alignedGrid.innerHTML = '';

    state.photos.forEach(function (photo) {
      if (!photo.alignedB64) return;

      var wrap = document.createElement('div');
      wrap.className = 'aligned-item';

      var label = document.createElement('div');
      label.className = 'aligned-item-label';
      label.textContent = photo.name + (photo.isReference ? ' (reference)' : ' — ' + photo.nInliers + ' inliers');

      var canvas = document.createElement('canvas');
      canvas.className = 'aligned-canvas';

      wrap.appendChild(label);
      wrap.appendChild(canvas);
      dom.alignedGrid.appendChild(wrap);

      var img = new Image();
      img.onload = function () {
        canvas.width  = img.width;
        canvas.height = img.height;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        if (state.showKeypoints) drawKeypoints(ctx, photo, img.width, img.height);
      };
      img.src = photo.alignedB64;
      photo._alignedCanvas = canvas;
    });
  }

  function drawKeypoints(ctx, photo, w, h) {
    var pts = photo.isReference ? photo.kpRef : photo.kpImg;
    if (!pts || !pts.length) return;

    var xscale = w / MAX_WORK_PX;
    var yscale = h / MAX_WORK_PX;
    if (state.photos[state.refIdx]) {
      var refImg = state.photos[state.refIdx].originalImg;
      if (refImg) {
        xscale = w / Math.min(refImg.width,  MAX_WORK_PX);
        yscale = h / Math.min(refImg.height, MAX_WORK_PX);
      }
    }

    ctx.save();
    pts.forEach(function (kp) {
      var x = kp[0] * xscale;
      var y = kp[1] * yscale;
      ctx.beginPath();
      ctx.arc(x, y, KEYPOINT_RADIUS, 0, Math.PI * 2);
      ctx.strokeStyle = photo.isReference ? '#58A6FF' : '#3FB950';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = photo.isReference ? 'rgba(88,166,255,0.35)' : 'rgba(63,185,80,0.35)';
      ctx.fill();
    });
    ctx.restore();
  }

  function refreshKeypointsVisibility() {
    state.photos.forEach(function (photo) {
      if (!photo._alignedCanvas || !photo.alignedB64) return;
      var canvas = photo._alignedCanvas;
      var img = new Image();
      img.onload = function () {
        canvas.width  = img.width;
        canvas.height = img.height;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        if (state.showKeypoints) drawKeypoints(ctx, photo, img.width, img.height);
      };
      img.src = photo.alignedB64;
    });
  }

  // ── Collage composition ──────────────────────────────────────────────────────

  function isVertical(photo) {
    var img = photo.originalImg;
    return img && img.height >= img.width;
  }

  function composeCollage() {
    var aligned = state.photos.filter(function (p) { return p.alignedB64; });
    if (!aligned.length) return;

    var loadAll = aligned.map(function (photo) {
      return new Promise(function (resolve) {
        var img = new Image();
        img.onload = function () { resolve({ photo: photo, img: img }); };
        img.src = photo.alignedB64;
      });
    });

    Promise.all(loadAll).then(function (items) {
      var ref = items[0].img;
      var iw = ref.width, ih = ref.height;
      var n = items.length;
      var vertical = isVertical(items[0].photo);
      var cw, ch;

      if (vertical) {
        cw = iw * n;
        ch = ih;
      } else {
        cw = iw;
        ch = ih * n;
      }

      dom.collageCanvas.width  = cw;
      dom.collageCanvas.height = ch;
      var ctx = dom.collageCanvas.getContext('2d', { willReadFrequently: true });
      ctx.clearRect(0, 0, cw, ch);

      var fontSize = Math.round(Math.max(iw, ih) * LABEL_FONT_SIZE_RATIO);

      items.forEach(function (item, idx) {
        var x = vertical ? idx * iw : 0;
        var y = vertical ? 0 : idx * ih;
        ctx.drawImage(item.img, x, y, iw, ih);

        if (item.photo.labelEnabled && item.photo.labelText) {
          drawLabel(ctx, item.photo, x, y, iw, ih, fontSize);
        }
      });

      state.collageBase = ctx.getImageData(0, 0, cw, ch);
      if (dom.panelOutputEdits) dom.panelOutputEdits.classList.remove('hidden');
      if (dom.btnDownload) dom.btnDownload.disabled = false;
      setEditControlsEnabled(true);
      applyOutputEdits();
    });
  }

  function drawLabel(ctx, photo, x, y, iw, ih, fontSize) {
    var text = photo.labelText;
    var pos = photo.labelPosition || 'bottom-left';
    var color = photo.labelColor || '#FFFFFF';
    var pad = LABEL_PADDING;

    ctx.save();
    ctx.font = 'bold ' + fontSize + 'px system-ui, sans-serif';
    ctx.textBaseline = 'middle';

    var metrics = ctx.measureText(text);
    var tw = metrics.width;
    var th = fontSize;
    var bx, by;

    if (pos === 'top-left')     { bx = x + pad; by = y + pad + th / 2; }
    else if (pos === 'top-right') { bx = x + iw - pad - tw; by = y + pad + th / 2; }
    else if (pos === 'bottom-right') { bx = x + iw - pad - tw; by = y + ih - pad - th / 2; }
    else                           { bx = x + pad; by = y + ih - pad - th / 2; }

    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(bx - pad / 2, by - th * 0.65, tw + pad, th * 1.3);

    ctx.fillStyle = color;
    ctx.fillText(text, bx, by);
    ctx.restore();
  }

  // ── Output edits ─────────────────────────────────────────────────────────────

  function setEditControlsEnabled(enabled) {
    [dom.outputBrightness, dom.outputContrast, dom.outputSaturation].forEach(function (el) {
      if (el) el.disabled = !enabled;
    });
    if (dom.btnOutputReset) dom.btnOutputReset.disabled = !enabled;
  }

  function applyOutputEdits() {
    if (!state.collageBase || !dom.collageCanvas) return;
    var src = state.collageBase;
    var canvas = dom.collageCanvas;
    canvas.width  = src.width;
    canvas.height = src.height;
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    var out = ctx.createImageData(src.width, src.height);
    var data = src.data;
    var od   = out.data;

    var br = state.edits.brightness / 100;
    var co = state.edits.contrast;
    var sa = state.edits.saturation / 100;
    var cf = Math.tan((co + 100) / 200 * Math.PI / 2);

    for (var i = 0; i < data.length; i += 4) {
      var r = data[i], g = data[i + 1], b = data[i + 2];
      r += br * 255; g += br * 255; b += br * 255;
      r = (r - 128) * cf + 128;
      g = (g - 128) * cf + 128;
      b = (b - 128) * cf + 128;
      var lum = 0.299 * r + 0.587 * g + 0.114 * b;
      r = lum + (r - lum) * (1 + sa);
      g = lum + (g - lum) * (1 + sa);
      b = lum + (b - lum) * (1 + sa);
      od[i]     = Math.max(0, Math.min(255, Math.round(r)));
      od[i + 1] = Math.max(0, Math.min(255, Math.round(g)));
      od[i + 2] = Math.max(0, Math.min(255, Math.round(b)));
      od[i + 3] = data[i + 3];
    }
    ctx.putImageData(out, 0, 0);
  }

  function resetEdits() {
    state.edits = { brightness: 0, contrast: 0, saturation: 0 };
    if (dom.outputBrightness) { dom.outputBrightness.value = 0; dom.valBrightness.textContent = '0'; }
    if (dom.outputContrast)   { dom.outputContrast.value   = 0; dom.valContrast.textContent   = '0'; }
    if (dom.outputSaturation) { dom.outputSaturation.value = 0; dom.valSaturation.textContent = '0'; }
    applyOutputEdits();
  }

  // ── Download ─────────────────────────────────────────────────────────────────

  function downloadCollage() {
    if (!dom.collageCanvas) return;
    var a = document.createElement('a');
    a.download = 'chronosync-collage.png';
    a.href = dom.collageCanvas.toDataURL('image/png');
    a.click();
  }

  // ── Drag & drop ──────────────────────────────────────────────────────────────

  function bindDragDrop() {
    var target = dom.photoCardsGrid || document.querySelector('.panel-upload');
    if (!target) return;
    target.addEventListener('dragover', function (e) { e.preventDefault(); target.classList.add('drag-over'); });
    target.addEventListener('dragleave', function () { target.classList.remove('drag-over'); });
    target.addEventListener('drop', function (e) {
      e.preventDefault();
      target.classList.remove('drag-over');
      addFiles(e.dataTransfer.files);
    });
  }

  // ── i18n & theme ─────────────────────────────────────────────────────────────

  function readLangFromUrl() {
    if (window.SharedUiCore) return window.SharedUiCore.readLangFromUrl('en');
    var lang = (new URLSearchParams(window.location.search).get('lang') || '').toLowerCase();
    return lang === 'es' ? 'es' : 'en';
  }

  function applyTheme() {
    if (window.SharedUiCore) { window.SharedUiCore.applyBodyTheme(state.theme); return; }
    document.body.classList.toggle('dark', state.theme === 'dark');
  }

  function toggleTheme() {
    state.theme = window.SharedUiCore ? window.SharedUiCore.toggleThemeValue(state.theme) : (state.theme === 'dark' ? 'light' : 'dark');
    localStorage.setItem('theme', state.theme);
    var btn = document.getElementById('btn-theme');
    if (window.SharedUiCore && btn) window.SharedUiCore.animateThemeButton(btn, 420);
    applyTheme();
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Init ─────────────────────────────────────────────────────────────────────

  function init() {
    cacheDOM();
    state.lang = readLangFromUrl();
    applyTheme();

    if (window.SharedUiCore && window.SharedUiCore.bindHeaderControls) {
      window.SharedUiCore.bindHeaderControls({
        themeButtonId: 'btn-theme',
        langSwitcherSelector: '#lang-switcher',
        onToggleTheme: toggleTheme,
        onToggleLang: function () {}
      });
    } else {
      var btnTheme = document.getElementById('btn-theme');
      if (btnTheme) btnTheme.addEventListener('click', toggleTheme);
    }

    if (dom.fileAdd) {
      dom.fileAdd.addEventListener('change', function () { addFiles(this.files); this.value = ''; });
    }

    if (dom.selectReference) {
      dom.selectReference.addEventListener('change', function () {
        state.refIdx = Number(this.value);
        invalidateAlignment();
      });
    }

    if (dom.btnAlign) {
      dom.btnAlign.addEventListener('click', runAlignment);
    }

    if (dom.btnClear) {
      dom.btnClear.addEventListener('click', function () {
        state.photos.forEach(function (p) { if (p.objectUrl) URL.revokeObjectURL(p.objectUrl); });
        state.photos = [];
        state.refIdx = 0;
        renderPhotoGrid();
        syncReferenceSelect();
        updateAlignButtonState();
        updateClearButton();
        invalidateAlignment();
        setProgress(0, 'Add at least two photos to begin.');
      });
    }

    if (dom.toggleKeypoints) {
      dom.toggleKeypoints.addEventListener('change', function () {
        state.showKeypoints = this.checked;
        refreshKeypointsVisibility();
      });
    }

    if (dom.btnCompose) {
      dom.btnCompose.addEventListener('click', composeCollage);
    }

    if (dom.btnDownload) {
      dom.btnDownload.addEventListener('click', downloadCollage);
    }

    if (dom.outputBrightness) {
      dom.outputBrightness.addEventListener('input', function () {
        state.edits.brightness = Number(this.value);
        dom.valBrightness.textContent = this.value;
        applyOutputEdits();
      });
    }
    if (dom.outputContrast) {
      dom.outputContrast.addEventListener('input', function () {
        state.edits.contrast = Number(this.value);
        dom.valContrast.textContent = this.value;
        applyOutputEdits();
      });
    }
    if (dom.outputSaturation) {
      dom.outputSaturation.addEventListener('input', function () {
        state.edits.saturation = Number(this.value);
        dom.valSaturation.textContent = this.value;
        applyOutputEdits();
      });
    }
    if (dom.btnOutputReset) {
      dom.btnOutputReset.addEventListener('click', resetEdits);
    }

    bindColorPicker();
    bindDragDrop();

    if (window.ChronoSyncWorker) window.ChronoSyncWorker.preload();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
