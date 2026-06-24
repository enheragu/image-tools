(function () {
  'use strict';

  var LABEL_POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
  var KEYPOINT_RADIUS = 4;

  var state = {
    lang: 'en',
    theme: window.SharedUiCore ? window.SharedUiCore.getPreferredTheme() : (localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')),
    photos: [],
    refIdx: 0,
    aligned: false,
    showKeypoints: true,
    showGrid: false,
    showSeams: true,   // composite mode: thin lines marking each piece (stripped on download)
    trimBlack: true,       // true = crop to the largest black-free rectangle (no black wedges)
    compositeFill: false,  // composite: fill no-data zones with a covering image (content-aware)
    collageBase: null,
    collageLayout: null,
    collageItems: null,   // cached loaded aligned images, so mosaic changes re-layout without reloading
    mosaic: {
      mode: 'cascade',        // 'cascade' | 'grid' | 'composite'
      orientation: 'auto',    // cascade: 'auto' | 'sidebyside' | 'stacked'
      gridCols: 2,            // grid: number of columns
      pattern: 'stripes',     // composite: 'stripes' | 'blocks' | 'radial'
      bandsPerImage: 1,       // stripes: bands contributed by each image (1 = 1/N each)
      angle: 0,              // stripes: gradient angle in degrees (0 = vertical stripes, 90 = horizontal)
      blocksX: 4,            // blocks: tiles across
      blocksY: 4,            // blocks: tiles down
      sectors: 4              // radial: angular sectors
    },
    edits: { brightness: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0, gamma: 0 },
    photoEditModalIdx: -1,
    photoEditModalDirty: false,
    labelGlobals: {
      position:  'bottom-left',
      color:     '#FFD700',
      font:      'system-ui, sans-serif',
      size:      27,    // 1-100; ratio = size/1000 of longest side
      bold:      false,
      italic:    false,
      bgColor:      '#000000',
      bgOpacity:    0,    // 0-100; 0 = no background
      colorOpacity: 100,  // 0-100; text opacity
      margin:       1     // 0-5 (percent of longest side)
    }
  };

  var i18n = window.ChronoSyncI18n || { getCopy: function (l) { return { lang: l }; } };

  // ── DOM ─────────────────────────────────────────────────────────────────────

  var dom = {};
  function cacheDOM() {
    dom.fileAdd               = document.getElementById('file-add');
    dom.dropZone              = document.getElementById('photo-drop-zone');
    dom.uploadActionsRow      = document.getElementById('upload-actions-row');
    dom.selectReference       = document.getElementById('select-reference');
    dom.btnAlign              = document.getElementById('btn-align');
    dom.btnClear              = document.getElementById('btn-clear');
    dom.photoCardsGrid        = document.getElementById('photo-cards-grid');
    dom.statusUpload          = document.getElementById('status-upload');
    dom.progressBarWrap       = document.getElementById('progress-bar-wrap');
    dom.progressBar           = document.getElementById('progress-bar');
    dom.panelPreview          = document.getElementById('panel-preview');
    dom.toggleKeypoints       = document.getElementById('toggle-keypoints');
    dom.toggleGrid            = document.getElementById('toggle-grid');
    dom.toggleTrimBlack       = document.getElementById('toggle-trim-black');
    dom.toggleFillGaps        = document.getElementById('toggle-fill-gaps');
    dom.mosaicMode            = document.getElementById('mosaic-mode');
    dom.mosaicOrientation     = document.getElementById('mosaic-orientation');
    dom.mosaicCols            = document.getElementById('mosaic-cols');
    dom.mosaicPattern         = document.getElementById('mosaic-pattern');
    dom.mosaicBands           = document.getElementById('mosaic-bands');
    dom.mosaicAngle           = document.getElementById('mosaic-angle');
    dom.valMosaicAngle        = document.getElementById('val-mosaic-angle');
    dom.mosaicBlocksX         = document.getElementById('mosaic-blocks-x');
    dom.mosaicBlocksY         = document.getElementById('mosaic-blocks-y');
    dom.mosaicSectors         = document.getElementById('mosaic-sectors');
    dom.btnDownload           = document.getElementById('btn-download');
    dom.btnExpandCollage      = document.getElementById('btn-expand-collage');
    dom.collageModalOverlay   = document.getElementById('collage-modal-overlay');
    dom.btnCloseCollageModal  = document.getElementById('btn-close-collage-modal');
    dom.collageModalImg       = document.getElementById('collage-modal-img');
    dom.labelGlobalControls   = document.getElementById('label-global-controls');
    dom.labelGlobalPos        = document.getElementById('label-global-pos');
    dom.labelGlobalColor      = document.getElementById('label-global-color');
    dom.labelGlobalBold       = document.getElementById('label-global-bold');
    dom.labelGlobalItalic     = document.getElementById('label-global-italic');
    dom.labelGlobalBgColor    = document.getElementById('label-global-bg-color');
    dom.labelGlobalFont       = document.getElementById('label-global-font');
    dom.labelGlobalSize         = document.getElementById('label-global-size');
    dom.valLabelGlobalSize      = document.getElementById('val-label-global-size');
    dom.labelGlobalMargin       = document.getElementById('label-global-margin');
    dom.valLabelGlobalMargin    = document.getElementById('val-label-global-margin');
    dom.outputBrightness      = document.getElementById('output-brightness');
    dom.outputContrast        = document.getElementById('output-contrast');
    dom.outputSaturation      = document.getElementById('output-saturation');
    dom.valBrightness         = document.getElementById('val-output-brightness');
    dom.valContrast           = document.getElementById('val-output-contrast');
    dom.valSaturation         = document.getElementById('val-output-saturation');
    dom.outputTemperature     = document.getElementById('output-temperature');
    dom.outputTint            = document.getElementById('output-tint');
    dom.outputGamma           = document.getElementById('output-gamma');
    dom.valTemperature        = document.getElementById('val-output-temperature');
    dom.valTint               = document.getElementById('val-output-tint');
    dom.valGamma              = document.getElementById('val-output-gamma');
    dom.btnOutputReset        = document.getElementById('btn-output-reset');
    dom.collageCanvas         = document.getElementById('collage-canvas');
    dom.collageWrap           = document.getElementById('collage-wrap');
    dom.photoEditModalOverlay = document.getElementById('photo-edit-modal-overlay');
    dom.photoEditCanvas       = document.getElementById('photo-edit-canvas');
    dom.photoEditName         = document.getElementById('photo-edit-modal-title');
    dom.btnPhotoModalPrev     = document.getElementById('btn-photo-modal-prev');
    dom.btnPhotoModalNext     = document.getElementById('btn-photo-modal-next');
    dom.btnClosePhotoEdit     = document.getElementById('btn-close-photo-edit');
    dom.photoEditBrightness   = document.getElementById('photo-edit-brightness');
    dom.photoEditContrast     = document.getElementById('photo-edit-contrast');
    dom.photoEditSaturation   = document.getElementById('photo-edit-saturation');
    dom.photoEditTemperature  = document.getElementById('photo-edit-temperature');
    dom.photoEditTint         = document.getElementById('photo-edit-tint');
    dom.photoEditSharpness    = document.getElementById('photo-edit-sharpness');
    dom.photoEditVignette     = document.getElementById('photo-edit-vignette');
    dom.valPhotoEditBr        = document.getElementById('val-photo-edit-brightness');
    dom.valPhotoEditCo        = document.getElementById('val-photo-edit-contrast');
    dom.valPhotoEditSa        = document.getElementById('val-photo-edit-saturation');
    dom.valPhotoEditTe        = document.getElementById('val-photo-edit-temperature');
    dom.valPhotoEditTi        = document.getElementById('val-photo-edit-tint');
    dom.valPhotoEditSh        = document.getElementById('val-photo-edit-sharpness');
    dom.valPhotoEditVi        = document.getElementById('val-photo-edit-vignette');
    dom.photoEditLabelEnabled = document.getElementById('photo-edit-label-enabled');
    dom.photoEditLabelText    = document.getElementById('photo-edit-label-text');
    dom.photoEditLabelColor   = document.getElementById('photo-edit-label-color');
    dom.photoEditLabelPos     = document.getElementById('photo-edit-label-pos');
  }

  // ── Utility ──────────────────────────────────────────────────────────────────

  function hexToRgbStr(hex) {
    return parseInt(hex.slice(1,3),16) + ',' + parseInt(hex.slice(3,5),16) + ',' + parseInt(hex.slice(5,7),16);
  }

  // ── EXIF date reading (exifr — lazy CDN, supports JPEG/HEIC/TIFF/…) ─────────

  var _EXIFR_CDN = 'https://cdn.jsdelivr.net/npm/exifr@7/dist/full.umd.js';
  var _exifrReady = null;

  function _ensureExifr() {
    if (window.exifr) return Promise.resolve();
    if (_exifrReady) return _exifrReady;
    _exifrReady = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = _EXIFR_CDN;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('exifr CDN load failed')); };
      document.head.appendChild(s);
    });
    return _exifrReady;
  }

  function readExifDate(file) {
    return _ensureExifr().then(function () {
      return window.exifr.parse(file, ['DateTimeOriginal', 'CreateDate', 'DateTime']);
    }).then(function (tags) {
      if (!tags) return null;
      var d = tags.DateTimeOriginal || tags.CreateDate || tags.DateTime;
      if (!(d instanceof Date)) return null;
      var y = d.getFullYear();
      var mo = String(d.getMonth() + 1).padStart(2, '0');
      var day = String(d.getDate()).padStart(2, '0');
      return y + '-' + mo + '-' + day;
    }).catch(function () { return null; });
  }

  // ── Image resize helpers ─────────────────────────────────────────────────────

  function loadImageFromFile(file) {
    var loadFn = function (blob) {
      return new Promise(function (resolve, reject) {
        var img = new Image();
        var url = URL.createObjectURL(blob);
        // Revoke as soon as the bitmap is decoded — the Image holds the pixels, the
        // source blob is no longer needed, so we free it immediately instead of
        // keeping it alive until the photo is removed.
        img.onload  = function () { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('decode')); };
        img.src = url;
        img._objectUrl = null;
      });
    };
    if (window.SharedHeicLoader && SharedHeicLoader.isHeic(file)) {
      return SharedHeicLoader.toBlob(file).then(loadFn);
    }
    return loadFn(file);
  }

  function imgToBase64(img) {
    var c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    c.getContext('2d').drawImage(img, 0, 0);
    return c.toDataURL('image/jpeg', 0.92);
  }

  // Downscale an image to factor s and return a JPEG data URL — only this small image
  // is sent to the worker, so full-res pixels never enter Pyodide.
  function downscaleToB64(img, s) {
    var w = Math.max(1, Math.round(img.width * s));
    var h = Math.max(1, Math.round(img.height * s));
    var c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/jpeg', 0.9);
  }

  // Worker returns a 3×3 matrix (img→ref) in the DOWNSCALED coord space. Convert to the
  // original resolution and flatten to [a,b,c,d,e,f]: linear part is scale-invariant,
  // translation scales by 1/s. (orig coords = small coords / s.)
  function scaleMatrixToOrig(m, s) {
    if (!m) return [1, 0, 0, 0, 1, 0];
    return [m[0][0], m[0][1], m[0][2] / s,
            m[1][0], m[1][1], m[1][2] / s];
  }

  function scalePts(pts, k) {
    return (pts || []).map(function (p) { return [p[0] * k, p[1] * k]; });
  }

  // Axis-aligned bbox (reference frame) of an image's transformed corners.
  function transformBbox(t, w, h) {
    var xs = [], ys = [], cs = [[0, 0], [w, 0], [w, h], [0, h]];
    cs.forEach(function (p) {
      xs.push(t[0] * p[0] + t[1] * p[1] + t[2]);
      ys.push(t[3] * p[0] + t[4] * p[1] + t[5]);
    });
    return [Math.min.apply(null, xs), Math.min.apply(null, ys),
            Math.max.apply(null, xs), Math.max.apply(null, ys)];
  }

  // ── Color picker ─────────────────────────────────────────────────────────────

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
    state.collageLayout = null;
    state.collageItems = null;   // drop the cached full-res aligned Images
    // The aligned outputs are no longer valid — free the heavy per-photo data so it
    // doesn't linger until the next alignment (each alignedB64 is a multi-MB string).
    state.photos.forEach(function (p) {
      p.alignedB64 = null;
      p.transform = null;
      p.kpRef = []; p.kpImg = []; p.kpAll = [];
      p.validBbox = null;
    });
    if (dom.panelPreview) dom.panelPreview.classList.add('hidden');
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
      '  <div class="card-header-actions">',
      '    <button class="btn-card-up shared-icon-btn shared-icon-btn-sm" type="button" aria-label="Move earlier" title="Move earlier">',
      '      <svg viewBox="0 0 24 24" role="presentation" focusable="false" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 14l5-5 5 5"/></svg>',
      '    </button>',
      '    <button class="btn-card-down shared-icon-btn shared-icon-btn-sm" type="button" aria-label="Move later" title="Move later">',
      '      <svg viewBox="0 0 24 24" role="presentation" focusable="false" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10l5 5 5-5"/></svg>',
      '    </button>',
      '    <button class="btn-card-expand shared-icon-btn shared-icon-btn-sm" type="button" aria-label="Expand photo" title="Expand">',
      '      <svg viewBox="0 0 24 24" role="presentation" focusable="false" width="14" height="14" fill="currentColor">',
      '        <path d="M3 3h7v2H5v5H3zm11 0h7v7h-2V5h-5zm7 11v7h-7v-2h5v-5zM3 14h2v5h5v2H3z"/>',
      '      </svg>',
      '    </button>',
      '    <button class="btn-card-remove shared-icon-btn shared-icon-btn-sm shared-icon-btn-danger" type="button" aria-label="Remove photo" title="Remove">',
      '      <span aria-hidden="true" class="icon-trash">',
      '        <svg viewBox="0 0 24 24" role="presentation" focusable="false">',
      '          <path d="M4 7h16M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7m-8 0 1 12.5A1.5 1.5 0 0 0 9.49 21h5.02A1.5 1.5 0 0 0 16 19.5L17 7M10 11v6m4-6v6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
      '        </svg>',
      '      </span>',
      '    </button>',
      '  </div>',
      '</div>',
      '<canvas class="photo-thumb" width="240" height="160"></canvas>',
      '<div class="photo-label-config">',
      '  <div class="card-label-row">',
      '    <label class="label-toggle">',
      '      <input type="checkbox" class="label-enabled-check" ' + (photo.labelEnabled ? 'checked' : '') + '>',
      '      <span class="label-toggle-text">Date label</span>',
      '    </label>',
      '    <input type="text" class="label-text-input' + (photo.labelEnabled ? '' : ' hidden') + '" value="' + escapeHtml(photo.labelText) + '" placeholder="Date" aria-label="Date label text">',
      '  </div>',
      '</div>'
    ].join('\n');

    card.querySelector('.btn-card-remove').addEventListener('click', function () { removePhoto(photo.id); });
    card.querySelector('.btn-card-expand').addEventListener('click', function () {
      openPhotoEditModal(state.photos.findIndex(function (p) { return p.id === photo.id; }));
    });
    card.querySelector('.btn-card-up').addEventListener('click', function () { movePhoto(photo.id, -1); });
    card.querySelector('.btn-card-down').addEventListener('click', function () { movePhoto(photo.id, 1); });

    // Drag & drop reorder. Dragging from a form control is ignored so text stays selectable.
    card.draggable = true;
    card.addEventListener('dragstart', function (e) {
      if (e.target.matches('input, textarea, button, svg, path')) { e.preventDefault(); return; }
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(photo.id));
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', function () { card.classList.remove('dragging'); });
    card.addEventListener('dragover', function (e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; card.classList.add('drag-over'); });
    card.addEventListener('dragleave', function () { card.classList.remove('drag-over'); });
    card.addEventListener('drop', function (e) {
      e.preventDefault();
      card.classList.remove('drag-over');
      var srcId = e.dataTransfer.getData('text/plain');
      if (srcId) reorderPhotos(srcId, photo.id);
    });

    var check = card.querySelector('.label-enabled-check');
    check.addEventListener('change', function () {
      photo.labelEnabled = this.checked;
      var inp = card.querySelector('.label-text-input');
      if (inp) inp.classList.toggle('hidden', !this.checked);
    });

    card.querySelector('.label-text-input').addEventListener('input', function () {
      photo.labelText = this.value;
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
    if (dom.dropZone) dom.dropZone.classList.toggle('has-photos', state.photos.length > 0);
  }

  // ── Reorder ────────────────────────────────────────────────────────────────
  // One reorder of state.photos drives every output mode: cascade/line order, grid
  // cells, and composite zone assignment (mask uses idx % n). The reference stays
  // pinned to the same photo across the reorder.
  function applyReorder() {
    renderPhotoGrid();
    syncReferenceSelect();
    if (state.collageItems && state.collageItems.length) {
      state.collageItems.sort(function (a, b) {
        return state.photos.indexOf(a.photo) - state.photos.indexOf(b.photo);
      });
      recomposeCollage();
    }
  }

  function movePhoto(id, delta) {
    var i = state.photos.findIndex(function (p) { return String(p.id) === String(id); });
    var j = i + delta;
    if (i < 0 || j < 0 || j >= state.photos.length) return;
    var refPhoto = state.photos[state.refIdx];
    var tmp = state.photos[i]; state.photos[i] = state.photos[j]; state.photos[j] = tmp;
    state.refIdx = Math.max(0, state.photos.indexOf(refPhoto));
    applyReorder();
  }

  function reorderPhotos(srcId, targetId) {
    if (String(srcId) === String(targetId)) return;
    var from = state.photos.findIndex(function (p) { return String(p.id) === String(srcId); });
    var to   = state.photos.findIndex(function (p) { return String(p.id) === String(targetId); });
    if (from < 0 || to < 0) return;
    var refPhoto = state.photos[state.refIdx];
    var moved = state.photos.splice(from, 1)[0];
    state.photos.splice(to, 0, moved);
    state.refIdx = Math.max(0, state.photos.indexOf(refPhoto));
    applyReorder();
  }

  function updateStatusText() {
    if (!dom.statusUpload) return;
    var copy = i18n.getCopy(state.lang);
    var n = state.photos.length;
    if (n === 0) dom.statusUpload.textContent = copy.statusEmpty;
    else if (n === 1) dom.statusUpload.textContent = copy.statusOne;
    else dom.statusUpload.textContent = n + copy.statusReady;
  }

  function syncReferenceSelect() {
    if (!dom.selectReference) return;
    dom.selectReference.innerHTML = '';
    if (state.photos.length === 0) {
      var ph = document.createElement('option');
      ph.disabled = true; ph.selected = true; ph.textContent = '—';
      dom.selectReference.appendChild(ph);
      return;
    }
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
    var arr = Array.from(files).filter(function (f) {
      return f.type.startsWith('image/') || (window.SharedHeicLoader && SharedHeicLoader.isHeic(f));
    });
    if (!arr.length) return;
    var copy = i18n.getCopy(state.lang);

    for (var i = 0; i < arr.length; i++) {
      var file = arr[i];
      if (window.SharedHeicLoader && SharedHeicLoader.isHeic(file)) {
        if (dom.statusUpload) dom.statusUpload.textContent = copy.convertingHeic;
      }
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
          labelColor: state.labelGlobals.color,
          labelPosition: state.labelGlobals.position,
          alignedB64: null,
          transform: null,
          kpRef: [],
          kpImg: [],
          kpAll: [],
          nInliers: 0,
          isReference: false,
          validBbox: null,
          photoEdits: { brightness: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0, sharpness: 0, vignette: 0 }
        };
        state.photos.push(photo);
      } catch (_) {
        if (dom.statusUpload) dom.statusUpload.textContent = (copy.loadError || 'Could not load') + ': ' + file.name;
      }
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

    var copy = i18n.getCopy(state.lang);
    setProgress(5, copy.loadingEngine);

    try {
      setProgress(15, copy.resizing);

      // Downscale every image by ONE common factor so the largest side ≤ ALIGN_SIZE,
      // then send only those small images to the worker. Full-res never enters Pyodide.
      var ALIGN_SIZE = 900;
      var maxDim = 1;
      state.photos.forEach(function (p) {
        maxDim = Math.max(maxDim, p.originalImg.width, p.originalImg.height);
      });
      var sApp = Math.min(ALIGN_SIZE / maxDim, 1);

      var imagesB64 = state.photos.map(function (p) {
        return downscaleToB64(p.originalImg, sApp);
      });

      setProgress(30, copy.detecting);

      var result = await window.ChronoSyncWorker.run({
        ref_idx: state.refIdx,
        images: imagesB64
      });

      setProgress(85, copy.applyingAlign);

      var inv = 1 / sApp;
      result.forEach(function (r, idx) {
        var photo = state.photos[idx];
        if (!photo) return;
        photo.transform    = scaleMatrixToOrig(r.matrix, sApp);   // → original-res affine
        photo.kpRef        = scalePts(r.kp_ref, inv);
        photo.kpAll        = scalePts(r.kp_all, inv);
        photo.nInliers     = r.n_inliers;
        photo.isReference  = r.is_reference;
        photo.validBbox    = transformBbox(photo.transform, photo.originalImg.width, photo.originalImg.height);
        photo.alignedB64   = null;
        if (r.error) {
          console.warn('[ChronoSync] photo', idx, photo.name, '— ALIGNMENT FAILED:', r.error, r.debug || '');
        } else {
          console.log('[ChronoSync] photo', idx, photo.name,
            r.is_reference ? '(reference) kp:' + r.kp_ref.length
                           : 'inliers:' + r.n_inliers + ' detector:' + (r.debug && r.debug.detector || '?'));
        }
      });

      state.aligned = true;
      setProgress(0, state.photos.length + copy.alignedStatus);
      composeCollage();
    } catch (err) {
      setProgress(0, 'Alignment error: ' + err.message);
      console.error('ChronoSync alignment error', err);
    }

    if (dom.btnAlign) dom.btnAlign.disabled = false;
  }

  // ── Keypoints overlay on collage ─────────────────────────────────────────────

  function drawKeypointsOnCollage(ctx) {
    var layout = state.collageLayout;
    if (!layout || !layout.panels || !layout.panels.length) return;
    var canvas = dom.collageCanvas;
    // Scale geometry to stay visible regardless of CSS zoom
    var scale  = (canvas.clientWidth > 0) ? canvas.width / canvas.clientWidth : 1;
    var radius = Math.ceil(KEYPOINT_RADIUS * scale);
    var lineW  = Math.max(1, Math.ceil(1.5 * scale));
    var cropX = layout.cropX || 0;
    var cropY = layout.cropY || 0;
    var refPanel = null;
    layout.panels.forEach(function (p) { if (p.photo.isReference) refPanel = p; });

    layout.panels.forEach(function (panel) {
      var photo = panel.photo;
      // kpRef is in full-res reference-frame coords; subtract crop offset to get canvas coords
      var pts = photo.kpRef;
      ctx.save();

      // Faint dots for ALL detected keypoints (non-reference panels), so coverage is
      // visible — not just the dozen inliers that survived RANSAC. Drawn first, under
      // the bright inliers.
      if (!photo.isReference && photo.kpAll && photo.kpAll.length) {
        var rAll = Math.max(1, radius - 1);
        ctx.fillStyle = 'rgba(63,185,80,0.18)';
        photo.kpAll.forEach(function (kp) {
          ctx.beginPath();
          ctx.arc(kp[0] - cropX + panel.x, kp[1] - cropY + panel.y, rAll, 0, Math.PI * 2);
          ctx.fill();
        });
      }

      if (!pts || !pts.length) { ctx.restore(); return; }

      // Connecting lines from the reference panel to this non-reference panel
      if (!photo.isReference && refPanel) {
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(255,200,50,0.55)';
        ctx.lineWidth   = Math.max(1.5, scale * 1.5);
        pts.forEach(function (kp) {
          ctx.moveTo(kp[0] - cropX + refPanel.x, kp[1] - cropY + refPanel.y);
          ctx.lineTo(kp[0] - cropX + panel.x,    kp[1] - cropY + panel.y);
        });
        ctx.stroke();
      }

      // Keypoint circles
      pts.forEach(function (kp) {
        ctx.beginPath();
        ctx.arc(kp[0] - cropX + panel.x, kp[1] - cropY + panel.y, radius, 0, Math.PI * 2);
        ctx.strokeStyle = photo.isReference ? '#58A6FF' : '#3FB950';
        ctx.lineWidth = lineW;
        ctx.stroke();
        ctx.fillStyle = photo.isReference ? 'rgba(88,166,255,0.35)' : 'rgba(63,185,80,0.35)';
        ctx.fill();
      });
      ctx.restore();
    });
  }

  // ── Grid overlay ─────────────────────────────────────────────────────────────

  function drawGridOnCollage(ctx) {
    var layout = state.collageLayout;
    if (!layout || !layout.panels || !layout.panels.length) return;
    var canvas = dom.collageCanvas;
    var scale  = (canvas.clientWidth > 0) ? canvas.width / canvas.clientWidth : 1;
    ctx.save();
    layout.panels.forEach(function (panel) {
      var px = panel.x, py = panel.y, iw = panel.w, ih = panel.h;
      // Rule of thirds
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(255,255,255,0.65)';
      ctx.lineWidth = Math.max(1, scale);
      for (var t = 1; t <= 2; t++) {
        ctx.moveTo(px + t * iw / 3, py);       ctx.lineTo(px + t * iw / 3, py + ih);
        ctx.moveTo(px,              py + t * ih / 3); ctx.lineTo(px + iw, py + t * ih / 3);
      }
      ctx.stroke();
      // Fine 9ths
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
      ctx.lineWidth = Math.max(0.5, scale * 0.55);
      for (var f = 1; f <= 8; f++) {
        if (f % 3 === 0) continue;
        ctx.moveTo(px + f * iw / 9, py);       ctx.lineTo(px + f * iw / 9, py + ih);
        ctx.moveTo(px,              py + f * ih / 9); ctx.lineTo(px + iw, py + f * ih / 9);
      }
      ctx.stroke();
    });
    ctx.restore();
  }

  // ── Collage composition ──────────────────────────────────────────────────────

  function isVertical(photo) {
    var img = photo.originalImg;
    return img && img.height >= img.width;
  }

  // Render one photo into a fresh iw×ih tile: warp the ORIGINAL full-res image into the
  // reference frame via its affine transform (full-res warp on the canvas — GPU, low
  // memory), offset by the crop origin, then apply its per-photo edits. The reference's
  // transform is identity. Shared by every mosaic mode.
  function renderPhotoTile(item, iw, ih, cx0, cy0) {
    var tmp = document.createElement('canvas');
    tmp.width = iw; tmp.height = ih;
    var tc = tmp.getContext('2d', { willReadFrequently: true });
    var t = item.transform || [1, 0, 0, 0, 1, 0];   // [a,b,c,d,e,f]: refX=a x+b y+c, refY=d x+e y+f
    tc.save();
    tc.translate(-cx0, -cy0);
    tc.transform(t[0], t[3], t[1], t[4], t[2], t[5]);  // canvas (m11,m12,m21,m22,dx,dy)
    tc.drawImage(item.originalImg, 0, 0);
    tc.restore();
    var pe = item.photo.photoEdits;
    if (pe && hasAnyPhotoEdit(pe)) applyPhotoEditPixels(tc, iw, ih, pe);
    return tmp;
  }

  // Largest all-covered axis-aligned rectangle in a binary coverage grid (classic
  // histogram + stack method). Returns {x0,y0,x1,y1} in grid coords (x1/y1 exclusive).
  function largestCoveredRect(cov, W, H) {
    var height = new Int32Array(W), best = { area: 0, x0: 0, y0: 0, x1: W, y1: H };
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) height[x] = cov[y * W + x] ? height[x] + 1 : 0;
      var stack = [], i = 0;
      while (i <= W) {
        var h = (i < W) ? height[i] : 0;
        if (!stack.length || h >= height[stack[stack.length - 1]]) { stack.push(i++); }
        else {
          var hh = height[stack.pop()];
          var left = stack.length ? stack[stack.length - 1] + 1 : 0;
          var area = hh * (i - left);
          if (area > best.area) best = { area: area, x0: left, y0: y - hh + 1, x1: i, y1: y + 1 };
        }
      }
    }
    return best;
  }

  // Crop window (in reference-frame full-res coords) = largest rectangle covered by
  // EVERY aligned image. A warped image covers a quadrilateral, so its bounding box
  // still contains black corners; intersecting boxes leaves black. Working from the
  // actual per-pixel coverage and taking the largest inscribed rectangle yields a
  // black-free crop. Computed on a small grid for speed, then snapped inward.
  function computeCoverageCrop(items, refW, refH) {
    var W = 240, H = Math.max(1, Math.round(W * refH / refW));
    var cnv = document.createElement('canvas'); cnv.width = W; cnv.height = H;
    var c = cnv.getContext('2d', { willReadFrequently: true });
    var gx = W / refW, gy = H / refH;
    var cov = new Uint8Array(W * H); cov.fill(1);
    items.forEach(function (it) {
      var t = it.transform || [1, 0, 0, 0, 1, 0];
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, W, H);
      c.setTransform(gx, 0, 0, gy, 0, 0);                 // reference frame → coverage grid
      c.transform(t[0], t[3], t[1], t[4], t[2], t[5]);    // original → reference frame
      c.drawImage(it.originalImg, 0, 0);
      c.setTransform(1, 0, 0, 1, 0, 0);
      var d = c.getImageData(0, 0, W, H).data;
      for (var i = 0; i < W * H; i++) if (d[i * 4 + 3] === 0) cov[i] = 0;
    });
    var r = largestCoveredRect(cov, W, H);
    var sx = refW / W, sy = refH / H;
    return {
      cx0: Math.ceil(r.x0 * sx), cy0: Math.ceil(r.y0 * sy),
      cx1: Math.floor(r.x1 * sx), cy1: Math.floor(r.y1 * sy)
    };
  }

  // Per-pixel source-image index for composite mode → Uint8Array(iw*ih) of 0..n-1.
  function buildCompositeMask(iw, ih, n) {
    var m = state.mosaic;
    var mask = new Uint8Array(iw * ih);
    var p = 0, x, y;
    if (m.pattern === 'blocks') {
      var bwx = iw / Math.max(1, m.blocksX), bwy = ih / Math.max(1, m.blocksY);
      for (y = 0; y < ih; y++) for (x = 0; x < iw; x++) {
        mask[p++] = (Math.floor(x / bwx) + Math.floor(y / bwy)) % n;
      }
    } else if (m.pattern === 'radial') {
      var cx = iw / 2, cy = ih / 2, sectors = Math.max(2, m.sectors);
      for (y = 0; y < ih; y++) for (x = 0; x < iw; x++) {
        var ang = Math.atan2(y - cy, x - cx) + Math.PI; // 0..2π
        mask[p++] = Math.floor(ang / (2 * Math.PI) * sectors) % n;
      }
    } else { // stripes
      var th = m.angle * Math.PI / 180, ct = Math.cos(th), st = Math.sin(th);
      var corners = [0, iw * ct, ih * st, iw * ct + ih * st];
      var tMin = Math.min.apply(null, corners), tMax = Math.max.apply(null, corners);
      var totalBands = Math.max(1, m.bandsPerImage * n);
      var bandW = (tMax - tMin) / totalBands || 1;
      for (y = 0; y < ih; y++) for (x = 0; x < iw; x++) {
        var b = Math.floor((x * ct + y * st - tMin) / bandW);
        if (b >= totalBands) b = totalBands - 1;
        if (b < 0) b = 0;
        mask[p++] = b % n;
      }
    }
    return mask;
  }

  // Combine the per-image tiles into one iw×ih canvas, choosing each pixel's
  // source from the mask. Tiles are already aligned to the reference frame.
  function compositeTiles(tiles, iw, ih, mask, fill) {
    var out = document.createElement('canvas');
    out.width = iw; out.height = ih;
    var octx = out.getContext('2d', { willReadFrequently: true });
    var outData = octx.createImageData(iw, ih);
    var od = outData.data;
    var datas = tiles.map(function (t) {
      return t.getContext('2d').getImageData(0, 0, iw, ih).data;
    });
    for (var i = 0; i < mask.length; i++) {
      var j = i * 4;
      var src = datas[mask[i]] || datas[0];
      // Content-aware fill: if the pattern's assigned image has no data here (it was
      // warped out → transparent), borrow the first image that does cover this pixel.
      if (fill && src[j + 3] === 0) {
        for (var t = 0; t < datas.length; t++) {
          if (datas[t][j + 3] > 0) { src = datas[t]; break; }
        }
      }
      od[j] = src[j]; od[j + 1] = src[j + 1]; od[j + 2] = src[j + 2]; od[j + 3] = src[j + 3];
    }
    octx.putImageData(outData, 0, 0);
    return out;
  }

  function composeCollage() {
    // Each aligned photo carries its original Image (already in memory) + its affine
    // transform; the warp happens on the canvas at layout time. No aligned bitmaps to
    // load, so this is synchronous and holds no extra full-res copies.
    var aligned = state.photos.filter(function (p) { return p.transform; });
    if (!aligned.length) return;
    state.collageItems = aligned.map(function (p) {
      return { photo: p, originalImg: p.originalImg, transform: p.transform };
    });
    layoutCollage();
    if (dom.panelPreview) dom.panelPreview.classList.remove('hidden');
    if (dom.btnDownload) dom.btnDownload.disabled = false;
    setEditControlsEnabled(true);
    applyOutputEdits();
  }

  // Lay the aligned tiles out according to state.mosaic, then store
  // state.collageBase (pre-global-edit pixels) and state.collageLayout.
  function layoutCollage() {
    var items = state.collageItems;
    if (!items || !items.length) return;

    var refItem = null;
    items.forEach(function (it) { if (it.photo.isReference) refItem = it; });
    if (!refItem) refItem = items[0];
    var refW = refItem.originalImg.width, refH = refItem.originalImg.height;

    // Crop window. Default (trimBlack): the largest rectangle covered by EVERY image,
    // computed from real per-pixel coverage → no black wedges, minimal FOV loss even
    // when an image is rotated (its bounding box would otherwise carry black corners).
    // Off: keep the whole reference frame (may show black where an image didn't reach).
    var cx0 = 0, cy0 = 0, cx1 = refW, cy1 = refH;
    if (state.trimBlack) {
      var cr = computeCoverageCrop(items, refW, refH);
      if (cr.cx1 - cr.cx0 > 16 && cr.cy1 - cr.cy0 > 16) {
        cx0 = cr.cx0; cy0 = cr.cy0; cx1 = cr.cx1; cy1 = cr.cy1;
      }
    }

    var iw = cx1 - cx0, ih = cy1 - cy0;
    var n = items.length;
    var tiles = items.map(function (it) { return renderPhotoTile(it, iw, ih, cx0, cy0); });

    var mode = state.mosaic.mode;
    var cw, ch, ctx, panels = [], mask = null, compositePhotos = null;

    if (mode === 'composite') {
      mask = buildCompositeMask(iw, ih, n);
      compositePhotos = items.map(function (it) { return it.photo; });
      var comp = compositeTiles(tiles, iw, ih, mask, state.compositeFill);
      cw = iw; ch = ih;
      dom.collageCanvas.width = cw; dom.collageCanvas.height = ch;
      ctx = dom.collageCanvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(comp, 0, 0);
    } else if (mode === 'grid') {
      var cols = Math.max(1, Math.min(n, state.mosaic.gridCols || Math.ceil(Math.sqrt(n))));
      var rows = Math.ceil(n / cols);
      cw = iw * cols; ch = ih * rows;
      dom.collageCanvas.width = cw; dom.collageCanvas.height = ch;
      ctx = dom.collageCanvas.getContext('2d', { willReadFrequently: true });
      ctx.clearRect(0, 0, cw, ch);
      tiles.forEach(function (t, idx) {
        var x = (idx % cols) * iw, y = Math.floor(idx / cols) * ih;
        ctx.drawImage(t, x, y);
        panels.push({ photo: items[idx].photo, x: x, y: y, w: iw, h: ih });
      });
    } else { // cascade
      var orient = state.mosaic.orientation;
      var sideBySide = orient === 'sidebyside' || (orient === 'auto' && isVertical(items[0].photo));
      cw = sideBySide ? iw * n : iw;
      ch = sideBySide ? ih : ih * n;
      dom.collageCanvas.width = cw; dom.collageCanvas.height = ch;
      ctx = dom.collageCanvas.getContext('2d', { willReadFrequently: true });
      ctx.clearRect(0, 0, cw, ch);
      tiles.forEach(function (t, idx) {
        var x = sideBySide ? idx * iw : 0;
        var y = sideBySide ? 0 : idx * ih;
        ctx.drawImage(t, x, y);
        panels.push({ photo: items[idx].photo, x: x, y: y, w: iw, h: ih });
      });
    }

    state.collageBase = ctx.getImageData(0, 0, cw, ch);
    state.collageLayout = {
      mode: mode, panels: panels, iw: iw, ih: ih, cropX: cx0, cropY: cy0,
      mask: mask, compositePhotos: compositePhotos
    };
  }

  // Re-layout using the already-loaded tiles (mosaic option changes).
  function recomposeCollage() {
    if (!state.collageItems || !state.collageItems.length) return;
    layoutCollage();
    applyOutputEdits();
  }

  function drawLabel(ctx, photo, x, y, iw, ih) {
    var text = photo.labelText;
    var pos      = photo.labelPosition || state.labelGlobals.position;
    var color    = photo.labelColor    || state.labelGlobals.color;
    var font     = state.labelGlobals.font;
    var fontSize = Math.round(Math.max(iw, ih) * state.labelGlobals.size / 1000);
    var edgePad  = Math.round(Math.max(iw, ih) * state.labelGlobals.margin / 100);
    var bgAlpha   = state.labelGlobals.bgOpacity / 100;
    var textAlpha = (state.labelGlobals.colorOpacity !== undefined ? state.labelGlobals.colorOpacity : 100) / 100;
    var bgPad     = Math.round(fontSize * 0.3);
    var weight   = state.labelGlobals.bold   ? 'bold '   : '';
    var style    = state.labelGlobals.italic ? 'italic ' : '';

    ctx.save();
    ctx.font = style + weight + fontSize + 'px ' + font;
    ctx.textBaseline = 'middle';

    var metrics = ctx.measureText(text);
    var tw = metrics.width;
    var th = fontSize;
    var bx, by;

    if (pos === 'top-left')          { bx = x + edgePad;           by = y + edgePad + th / 2; }
    else if (pos === 'top-right')    { bx = x + iw - edgePad - tw; by = y + edgePad + th / 2; }
    else if (pos === 'bottom-right') { bx = x + iw - edgePad - tw; by = y + ih - edgePad - th / 2; }
    else                             { bx = x + edgePad;           by = y + ih - edgePad - th / 2; }

    if (bgAlpha > 0) {
      ctx.fillStyle = 'rgba(' + hexToRgbStr(state.labelGlobals.bgColor) + ',' + bgAlpha.toFixed(2) + ')';
      ctx.fillRect(bx - bgPad, by - th * 0.65, tw + bgPad * 2, th * 1.3);
    }
    ctx.fillStyle = textAlpha < 1 ? 'rgba(' + hexToRgbStr(color) + ',' + textAlpha.toFixed(2) + ')' : color;
    ctx.fillText(text, bx, by);
    ctx.restore();
  }

  // Draw a photo's label centred at (cx, cy) — used in composite mode where each
  // image occupies an irregular region rather than a rectangular panel.
  function drawLabelCentered(ctx, photo, cx, cy, refSide) {
    var text = photo.labelText;
    if (!text) return;
    var color    = photo.labelColor || state.labelGlobals.color;
    var font     = state.labelGlobals.font;
    var fontSize = Math.round(refSide * state.labelGlobals.size / 1000);
    var bgAlpha   = state.labelGlobals.bgOpacity / 100;
    var textAlpha = (state.labelGlobals.colorOpacity !== undefined ? state.labelGlobals.colorOpacity : 100) / 100;
    var bgPad     = Math.round(fontSize * 0.3);
    var weight   = state.labelGlobals.bold   ? 'bold '   : '';
    var style    = state.labelGlobals.italic ? 'italic ' : '';
    ctx.save();
    ctx.font = style + weight + fontSize + 'px ' + font;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    var tw = ctx.measureText(text).width, th = fontSize;
    if (bgAlpha > 0) {
      ctx.fillStyle = 'rgba(' + hexToRgbStr(state.labelGlobals.bgColor) + ',' + bgAlpha.toFixed(2) + ')';
      ctx.fillRect(cx - tw / 2 - bgPad, cy - th * 0.65, tw + bgPad * 2, th * 1.3);
    }
    ctx.fillStyle = textAlpha < 1 ? 'rgba(' + hexToRgbStr(color) + ',' + textAlpha.toFixed(2) + ')' : color;
    ctx.fillText(text, cx, cy);
    ctx.restore();
  }

  // Anchor for an image's label in composite mode: centroid of its LARGEST
  // contiguous region (4-connected components on a coarse sample grid). The plain
  // global centroid fails for interleaved patterns (blocks/radial) — it collapses to
  // the image centre, where regions of different images overlap. The largest-region
  // centroid instead lands inside a real piece of that image, per pattern: on its
  // band (stripes), inside one of its blocks (blocks), in its sector (radial).
  function compositeLabelAnchor(mask, iw, ih, j) {
    var GW = Math.min(160, iw), GH = Math.min(160, ih);
    var sx = iw / GW, sy = ih / GH;
    var own = new Uint8Array(GW * GH);
    var gx, gy;
    for (gy = 0; gy < GH; gy++) for (gx = 0; gx < GW; gx++) {
      var mx = Math.min(iw - 1, Math.floor((gx + 0.5) * sx));
      var my = Math.min(ih - 1, Math.floor((gy + 0.5) * sy));
      if (mask[my * iw + mx] === j) own[gy * GW + gx] = 1;
    }
    var seen = new Uint8Array(GW * GH), stack = [];
    var bestArea = 0, bestCx = 0, bestCy = 0, i;
    for (i = 0; i < GW * GH; i++) {
      if (!own[i] || seen[i]) continue;
      stack.length = 0; stack.push(i); seen[i] = 1;
      var area = 0, sumx = 0, sumy = 0;
      while (stack.length) {
        var c = stack.pop(); area++;
        var cx = c % GW, cy = (c / GW) | 0; sumx += cx; sumy += cy;
        if (cx > 0      && own[c - 1]  && !seen[c - 1])  { seen[c - 1]  = 1; stack.push(c - 1); }
        if (cx < GW - 1 && own[c + 1]  && !seen[c + 1])  { seen[c + 1]  = 1; stack.push(c + 1); }
        if (cy > 0      && own[c - GW] && !seen[c - GW]) { seen[c - GW] = 1; stack.push(c - GW); }
        if (cy < GH - 1 && own[c + GW] && !seen[c + GW]) { seen[c + GW] = 1; stack.push(c + GW); }
      }
      if (area > bestArea) { bestArea = area; bestCx = sumx / area; bestCy = sumy / area; }
    }
    if (!bestArea) return null;
    return { x: (bestCx + 0.5) * sx, y: (bestCy + 0.5) * sy };
  }

  // Composite mode: one label per image, placed inside its largest region.
  function drawCompositeLabels(ctx, layout) {
    var iw = layout.iw, ih = layout.ih, mask = layout.mask, photos = layout.compositePhotos;
    if (!mask || !photos) return;
    var refSide = Math.max(iw, ih);
    photos.forEach(function (photo, j) {
      if (!photo.labelEnabled || !photo.labelText) return;
      var a = compositeLabelAnchor(mask, iw, ih, j);
      if (a) drawLabelCentered(ctx, photo, a.x, a.y, refSide);
    });
  }

  // Composite mode: thin lines along region boundaries, so each piece's source is visible.
  function drawSeamsOnComposite(ctx, layout) {
    var iw = layout.iw, ih = layout.ih, mask = layout.mask;
    if (!mask) return;
    var id = ctx.getImageData(0, 0, iw, ih), d = id.data, a = 0.85;
    for (var y = 0; y < ih; y++) {
      for (var x = 0; x < iw; x++) {
        var i = y * iw + x;
        var edge = (x + 1 < iw && mask[i] !== mask[i + 1]) ||
                   (y + 1 < ih && mask[i] !== mask[i + iw]);
        if (edge) {
          var j = i * 4;
          d[j]     = d[j]     * (1 - a) + 255 * a;
          d[j + 1] = d[j + 1] * (1 - a) + 255 * a;
          d[j + 2] = d[j + 2] * (1 - a) + 255 * a;
        }
      }
    }
    ctx.putImageData(id, 0, 0);
  }

  // ── Per-photo pixel edits ────────────────────────────────────────────────────

  function hasAnyPhotoEdit(e) {
    return e.brightness !== 0 || e.contrast !== 0 || e.saturation !== 0 ||
           e.temperature !== 0 || e.tint !== 0 || e.sharpness !== 0 || e.vignette !== 0;
  }

  function applyPhotoEditPixels(ctx, w, h, e) {
    var imgd = ctx.getImageData(0, 0, w, h);
    var d    = imgd.data;
    var br   = e.brightness  / 100;
    var co   = e.contrast;
    var sa   = e.saturation  / 100;
    var temp = e.temperature / 100 * 40;
    var tnt  = e.tint        / 100 * 40;
    var cf   = Math.tan((co + 100) / 200 * Math.PI / 2);
    var sharp = e.sharpness  / 100;
    var vig   = e.vignette   / 100;
    var cx = w / 2, cy = h / 2;

    for (var i = 0; i < d.length; i += 4) {
      var r = d[i], g = d[i + 1], b = d[i + 2];
      r += br * 255; g += br * 255; b += br * 255;
      r = (r - 128) * cf + 128;
      g = (g - 128) * cf + 128;
      b = (b - 128) * cf + 128;
      r += temp; b -= temp; g += tnt;
      var lum = 0.299 * r + 0.587 * g + 0.114 * b;
      r = lum + (r - lum) * (1 + sa);
      g = lum + (g - lum) * (1 + sa);
      b = lum + (b - lum) * (1 + sa);
      d[i]     = Math.max(0, Math.min(255, Math.round(r)));
      d[i + 1] = Math.max(0, Math.min(255, Math.round(g)));
      d[i + 2] = Math.max(0, Math.min(255, Math.round(b)));
    }

    var orig = sharp > 0 ? new Uint8ClampedArray(d) : null;
    if (sharp > 0 && orig) {
      var out = new Uint8ClampedArray(d);
      for (var y = 1; y < h - 1; y++) {
        for (var x = 1; x < w - 1; x++) {
          var pi = (y * w + x) * 4;
          for (var c = 0; c < 3; c++) {
            var sc = 5 * orig[pi + c]
                   - orig[pi - w * 4 + c]
                   - orig[pi + w * 4 + c]
                   - orig[pi - 4 + c]
                   - orig[pi + 4 + c];
            out[pi + c] = Math.max(0, Math.min(255,
              Math.round(d[pi + c] * (1 - sharp) + sc * sharp)));
          }
        }
      }
      for (var j = 0; j < d.length; j++) d[j] = out[j];
    }

    if (vig > 0) {
      for (var vi = 0; vi < d.length; vi += 4) {
        var px = (vi / 4) % w;
        var py = Math.floor(vi / 4 / w);
        var dx = (px - cx) / cx, dy = (py - cy) / cy;
        var f  = Math.max(0, 1 - vig * (dx * dx + dy * dy));
        d[vi]     = Math.round(d[vi]     * f);
        d[vi + 1] = Math.round(d[vi + 1] * f);
        d[vi + 2] = Math.round(d[vi + 2] * f);
      }
    }

    ctx.putImageData(imgd, 0, 0);
  }

  // ── Output edits ─────────────────────────────────────────────────────────────

  function setEditControlsEnabled(enabled) {
    [dom.outputBrightness, dom.outputContrast, dom.outputSaturation,
     dom.outputTemperature, dom.outputTint, dom.outputGamma].forEach(function (el) {
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

    var br   = state.edits.brightness  / 100;
    var co   = state.edits.contrast;
    var sa   = state.edits.saturation  / 100;
    var temp = state.edits.temperature / 100 * 40;
    var tnt  = state.edits.tint        / 100 * 40;
    var cf   = Math.tan((co + 100) / 200 * Math.PI / 2);
    var gammaExp = 1 - state.edits.gamma / 200;
    var gammaLut = new Uint8Array(256);
    for (var gi = 0; gi < 256; gi++) {
      gammaLut[gi] = Math.round(255 * Math.pow(gi / 255, gammaExp));
    }

    for (var i = 0; i < data.length; i += 4) {
      var r = data[i], g = data[i + 1], b = data[i + 2];
      r += br * 255; g += br * 255; b += br * 255;
      r = (r - 128) * cf + 128;
      g = (g - 128) * cf + 128;
      b = (b - 128) * cf + 128;
      r += temp; b -= temp; g += tnt;
      var lum = 0.299 * r + 0.587 * g + 0.114 * b;
      r = lum + (r - lum) * (1 + sa);
      g = lum + (g - lum) * (1 + sa);
      b = lum + (b - lum) * (1 + sa);
      od[i]     = gammaLut[Math.max(0, Math.min(255, Math.round(r)))];
      od[i + 1] = gammaLut[Math.max(0, Math.min(255, Math.round(g)))];
      od[i + 2] = gammaLut[Math.max(0, Math.min(255, Math.round(b)))];
      od[i + 3] = data[i + 3];
    }
    ctx.putImageData(out, 0, 0);

    // Overlays — drawn after pixel adjustment so they're never color-shifted.
    var layout = state.collageLayout;
    if (layout && layout.mode === 'composite') {
      // No panels: mark seams between pieces, label each image on its own region.
      if (state.showSeams) drawSeamsOnComposite(ctx, layout);
      drawCompositeLabels(ctx, layout);
    } else if (layout && layout.panels) {
      layout.panels.forEach(function (panel) {
        var photo = panel.photo;
        if (photo.labelEnabled && photo.labelText) drawLabel(ctx, photo, panel.x, panel.y, panel.w, panel.h);
      });
      // Grid + keypoints overlays — not included in download
      if (state.showGrid)      drawGridOnCollage(ctx);
      if (state.showKeypoints) drawKeypointsOnCollage(ctx);
    }
  }

  function resetEdits() {
    state.edits = { brightness: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0, gamma: 0 };
    if (dom.outputBrightness)  { dom.outputBrightness.value  = 0; dom.valBrightness.textContent  = '0'; }
    if (dom.outputContrast)    { dom.outputContrast.value    = 0; dom.valContrast.textContent    = '0'; }
    if (dom.outputSaturation)  { dom.outputSaturation.value  = 0; dom.valSaturation.textContent  = '0'; }
    if (dom.outputTemperature) { dom.outputTemperature.value = 0; dom.valTemperature.textContent = '0'; }
    if (dom.outputTint)        { dom.outputTint.value        = 0; dom.valTint.textContent        = '0'; }
    if (dom.outputGamma)       { dom.outputGamma.value       = 0; dom.valGamma.textContent       = '0'; }
    applyOutputEdits();
  }

  // ── Download ─────────────────────────────────────────────────────────────────

  function downloadCollage() {
    if (!dom.collageCanvas || !state.collageBase) return;
    // Strip guide overlays (keypoints, grid, composite seams) from the downloaded file
    var prevKps   = state.showKeypoints;
    var prevGrid  = state.showGrid;
    var prevSeams = state.showSeams;
    state.showKeypoints = false;
    state.showGrid      = false;
    state.showSeams     = false;
    applyOutputEdits();
    var a = document.createElement('a');
    a.download = 'chronosync-collage.png';
    a.href = dom.collageCanvas.toDataURL('image/png');
    a.click();
    state.showKeypoints = prevKps;
    state.showGrid      = prevGrid;
    state.showSeams     = prevSeams;
    if (prevKps || prevGrid || prevSeams) applyOutputEdits();
  }

  // ── Drag & drop ──────────────────────────────────────────────────────────────

  function bindDragDrop() {
    var zone = dom.dropZone;
    if (!zone) return;

    zone.addEventListener('dragover', function (e) { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', function (e) {
      if (!zone.contains(e.relatedTarget)) zone.classList.remove('drag-over');
    });
    zone.addEventListener('drop', function (e) {
      e.preventDefault();
      zone.classList.remove('drag-over');
      addFiles(e.dataTransfer.files);
    });
    zone.addEventListener('click', function (e) {
      // Avoid double-trigger when clicking the label/button inside the zone
      if (e.target === dom.fileAdd || e.target.closest('label[for="file-add"]')) return;
      if (dom.fileAdd) dom.fileAdd.click();
    });
    zone.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (dom.fileAdd) dom.fileAdd.click(); }
    });
  }

  // ── i18n & theme ─────────────────────────────────────────────────────────────

  function applyI18n(copy) {
    if (!copy) return;
    function setText(id, val) { var el = document.getElementById(id); if (el && val) el.textContent = val; }
    setText('upload-title',         copy.uploadTitle);
    setText('lbl-add-photos',       copy.addPhotos);
    setText('drop-zone-hint',       copy.dropHint);
    setText('lbl-reference',        copy.referenceLabel);
    setText('btn-align',            copy.alignBtn);
    setText('btn-clear',            copy.clearBtn);
    setText('lbl-show-keypoints',   copy.showKps);
    setText('lbl-show-grid',        copy.showGrid);
    setText('lbl-trim-black',       copy.trimBlack);
    setText('lbl-fill-gaps',        copy.fillGaps);
    setText('lbl-mosaic-mode',      copy.mosaicLayout);
    setText('lbl-mosaic-orient',    copy.mosaicOrient);
    setText('lbl-mosaic-cols',      copy.mosaicColumns);
    setText('lbl-mosaic-pattern',   copy.mosaicPattern);
    setText('lbl-mosaic-bands',     copy.mosaicBands);
    setText('lbl-mosaic-angle',     copy.mosaicAngle);
    setText('lbl-mosaic-blocks',    copy.mosaicBlocks);
    setText('lbl-mosaic-sectors',   copy.mosaicSectors);
    function setOpt(selId, val, txt) {
      var o = document.querySelector('#' + selId + ' option[value="' + val + '"]');
      if (o && txt) o.textContent = txt;
    }
    setOpt('mosaic-mode', 'cascade', copy.mosaicCascade);
    setOpt('mosaic-mode', 'grid', copy.mosaicGrid);
    setOpt('mosaic-mode', 'composite', copy.mosaicComposite);
    setOpt('mosaic-orientation', 'auto', copy.orientAuto);
    setOpt('mosaic-orientation', 'sidebyside', copy.orientSide);
    setOpt('mosaic-orientation', 'stacked', copy.orientStacked);
    setOpt('mosaic-pattern', 'stripes', copy.patStripes);
    setOpt('mosaic-pattern', 'blocks', copy.patBlocks);
    setOpt('mosaic-pattern', 'radial', copy.patRadial);
    setText('btn-download',         copy.downloadBtn);
    setText('output-edit-title',    copy.outputEdits);
    setText('btn-output-reset',     copy.resetEdits);
    setText('lbl-output-brightness',  copy.brightness);
    setText('lbl-output-contrast',    copy.contrast);
    setText('lbl-output-saturation',  copy.saturation);
    setText('lbl-output-temperature', copy.temperature);
    setText('lbl-output-tint',        copy.tint);
    setText('lbl-output-gamma',       copy.gamma);
    setText('shared-cp-title',         copy.chooseColor);
    setText('lbl-label-settings',     copy.labelSettings);
    setText('lbl-label-font',         copy.labelFont);
    setText('lbl-label-size',         copy.labelSize);
    setText('lbl-label-position',     copy.labelPos);
    setText('lbl-label-color',        copy.labelColor);
    setText('lbl-label-bg-opacity',   copy.labelBgOpacity);
    setText('lbl-label-margin',       copy.labelMargin);
    if (state.photos.length === 0) setText('status-upload', copy.statusEmpty);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Photo edit modal ─────────────────────────────────────────────────────────

  function openPhotoEditModal(idx) {
    if (idx < 0 || idx >= state.photos.length) return;
    state.photoEditModalIdx   = idx;
    state.photoEditModalDirty = false;
    if (dom.photoEditModalOverlay) {
      dom.photoEditModalOverlay.classList.remove('hidden');
      dom.photoEditModalOverlay.setAttribute('aria-hidden', 'false');
    }
    loadPhotoIntoModal(idx);
  }

  function closePhotoEditModal() {
    if (dom.photoEditModalOverlay) {
      dom.photoEditModalOverlay.classList.add('hidden');
      dom.photoEditModalOverlay.setAttribute('aria-hidden', 'true');
    }
    if (state.photoEditModalDirty && state.aligned) composeCollage();
    state.photoEditModalIdx   = -1;
    state.photoEditModalDirty = false;
  }

  function loadPhotoIntoModal(idx) {
    var photo = state.photos[idx];
    if (!photo) return;

    var n = state.photos.length;
    if (dom.btnPhotoModalPrev) dom.btnPhotoModalPrev.disabled = (idx <= 0);
    if (dom.btnPhotoModalNext) dom.btnPhotoModalNext.disabled = (idx >= n - 1);
    if (dom.photoEditName) dom.photoEditName.textContent = photo.name;

    var pe = photo.photoEdits;
    function setSlider(el, val, dispEl) {
      if (el) el.value = val;
      if (dispEl) dispEl.textContent = val;
    }
    setSlider(dom.photoEditBrightness, pe.brightness,  dom.valPhotoEditBr);
    setSlider(dom.photoEditContrast,   pe.contrast,    dom.valPhotoEditCo);
    setSlider(dom.photoEditSaturation, pe.saturation,  dom.valPhotoEditSa);
    setSlider(dom.photoEditTemperature,pe.temperature, dom.valPhotoEditTe);
    setSlider(dom.photoEditTint,       pe.tint,        dom.valPhotoEditTi);
    setSlider(dom.photoEditSharpness,  pe.sharpness,   dom.valPhotoEditSh);
    setSlider(dom.photoEditVignette,   pe.vignette,    dom.valPhotoEditVi);

    if (dom.photoEditLabelEnabled) dom.photoEditLabelEnabled.checked = photo.labelEnabled;
    if (dom.photoEditLabelText)    dom.photoEditLabelText.value      = photo.labelText;
    if (dom.photoEditLabelColor)   dom.photoEditLabelColor.style.setProperty('--swatch', photo.labelColor);
    if (dom.photoEditLabelPos)     dom.photoEditLabelPos.value       = photo.labelPosition || state.labelGlobals.position;

    drawPhotoEditPreview();
  }

  function drawPhotoEditPreview() {
    var photo = state.photos[state.photoEditModalIdx];
    if (!photo || !dom.photoEditCanvas) return;
    var src = photo.originalImg;
    if (!src) return;

    var MAX_DIM = 900;
    var scale  = Math.min(MAX_DIM / Math.max(src.width, src.height), 1);
    var pw = Math.round(src.width  * scale);
    var ph = Math.round(src.height * scale);

    dom.photoEditCanvas.width  = pw;
    dom.photoEditCanvas.height = ph;
    var ctx = dom.photoEditCanvas.getContext('2d');
    ctx.drawImage(src, 0, 0, pw, ph);
    if (hasAnyPhotoEdit(photo.photoEdits)) {
      applyPhotoEditPixels(ctx, pw, ph, photo.photoEdits);
    }
  }

  function bindPhotoEditModal() {
    if (!dom.photoEditModalOverlay) return;

    dom.photoEditModalOverlay.addEventListener('click', function (e) {
      if (e.target === dom.photoEditModalOverlay) closePhotoEditModal();
    });

    if (dom.btnClosePhotoEdit) {
      dom.btnClosePhotoEdit.addEventListener('click', closePhotoEditModal);
    }
    document.addEventListener('keydown', function (e) {
      if (!dom.photoEditModalOverlay || dom.photoEditModalOverlay.classList.contains('hidden')) return;
      if (e.key === 'Escape')      closePhotoEditModal();
      if (e.key === 'ArrowLeft')   navigatePhotoModal(-1);
      if (e.key === 'ArrowRight')  navigatePhotoModal(1);
    });

    if (dom.btnPhotoModalPrev) {
      dom.btnPhotoModalPrev.addEventListener('click', function () { navigatePhotoModal(-1); });
    }
    if (dom.btnPhotoModalNext) {
      dom.btnPhotoModalNext.addEventListener('click', function () { navigatePhotoModal(1); });
    }

    // Edit sliders
    var photoSliders = [
      ['photoEditBrightness',  'valPhotoEditBr', 'brightness'],
      ['photoEditContrast',    'valPhotoEditCo', 'contrast'],
      ['photoEditSaturation',  'valPhotoEditSa', 'saturation'],
      ['photoEditTemperature', 'valPhotoEditTe', 'temperature'],
      ['photoEditTint',        'valPhotoEditTi', 'tint'],
      ['photoEditSharpness',   'valPhotoEditSh', 'sharpness'],
      ['photoEditVignette',    'valPhotoEditVi', 'vignette'],
    ];
    photoSliders.forEach(function (s) {
      var el = dom[s[0]], valEl = dom[s[1]], key = s[2];
      if (!el) return;
      el.addEventListener('input', function () {
        var photo = state.photos[state.photoEditModalIdx];
        if (!photo) return;
        photo.photoEdits[key] = Number(this.value);
        if (valEl) valEl.textContent = this.value;
        state.photoEditModalDirty = true;
        drawPhotoEditPreview();
      });
    });

    // Label controls
    if (dom.photoEditLabelEnabled) {
      dom.photoEditLabelEnabled.addEventListener('change', function () {
        var photo = state.photos[state.photoEditModalIdx];
        if (!photo) return;
        photo.labelEnabled = this.checked;
        syncCardLabelState(photo);
        state.photoEditModalDirty = true;
      });
    }
    if (dom.photoEditLabelText) {
      dom.photoEditLabelText.addEventListener('input', function () {
        var photo = state.photos[state.photoEditModalIdx];
        if (!photo) return;
        photo.labelText = this.value;
        syncCardLabelText(photo);
        state.photoEditModalDirty = true;
      });
    }
    if (dom.photoEditLabelColor) {
      dom.photoEditLabelColor.addEventListener('click', function () {
        var photo = state.photos[state.photoEditModalIdx];
        if (!photo || !window.SharedColorPicker) return;
        SharedColorPicker.open(photo.labelColor, function (hex) {
          photo.labelColor = hex;
          if (dom.photoEditLabelColor) dom.photoEditLabelColor.style.setProperty('--swatch', hex);
          updateSwatchInCard(photo.id, hex);
          state.photoEditModalDirty = true;
        });
      });
    }
    if (dom.photoEditLabelPos) {
      dom.photoEditLabelPos.addEventListener('change', function () {
        var photo = state.photos[state.photoEditModalIdx];
        if (!photo) return;
        photo.labelPosition = this.value;
        syncCardLabelPos(photo);
        state.photoEditModalDirty = true;
      });
    }
  }

  function navigatePhotoModal(delta) {
    var next = state.photoEditModalIdx + delta;
    if (next < 0 || next >= state.photos.length) return;
    state.photoEditModalIdx = next;
    loadPhotoIntoModal(next);
  }

  function syncCardLabelState(photo) {
    var card = dom.photoCardsGrid && dom.photoCardsGrid.querySelector('[data-photo-id="' + photo.id + '"]');
    if (!card) return;
    var check = card.querySelector('.label-enabled-check');
    if (check) check.checked = photo.labelEnabled;
    var inp = card.querySelector('.label-text-input');
    if (inp) inp.classList.toggle('hidden', !photo.labelEnabled);
  }

  function syncCardLabelText(photo) {
    var card = dom.photoCardsGrid && dom.photoCardsGrid.querySelector('[data-photo-id="' + photo.id + '"]');
    if (!card) return;
    var inp = card.querySelector('.label-text-input');
    if (inp) inp.value = photo.labelText;
  }

  function syncCardLabelPos(photo) {
    var card = dom.photoCardsGrid && dom.photoCardsGrid.querySelector('[data-photo-id="' + photo.id + '"]');
    if (!card) return;
    var sel = card.querySelector('.label-pos-select');
    if (sel) sel.value = photo.labelPosition;
  }

  // ── Init ─────────────────────────────────────────────────────────────────────

  function init() {
    cacheDOM();

    if (window.SharedToolPageShell && window.SharedToolPageShell.initToolPage) {
      var shell = window.SharedToolPageShell.initToolPage({
        fallbackLang: 'en',
        i18nApi: i18n,
        onApplyLanguage: function (copy, lang) {
          state.lang = lang;
          applyI18n(copy);
        },
        onApplyTheme: function (theme) {
          state.theme = theme;
          if (window.SharedUiCore) window.SharedUiCore.applyBodyTheme(theme);
          else document.body.classList.toggle('dark', theme === 'dark');
        }
      });
      if (shell) { state.lang = shell.lang; state.theme = shell.theme; }
    } else {
      // Fallback when theme scripts aren't available
      var uiLang = (new URLSearchParams(window.location.search).get('lang') || '').toLowerCase();
      state.lang = (uiLang === 'es') ? 'es' : 'en';
      document.body.classList.toggle('dark', state.theme === 'dark');
      document.documentElement.classList.remove('i18n-pending');
      applyI18n(i18n.getCopy(state.lang));
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
        setProgress(0, i18n.getCopy(state.lang).statusEmpty);
      });
    }

    if (dom.toggleKeypoints) {
      dom.toggleKeypoints.addEventListener('change', function () {
        state.showKeypoints = this.checked;
        applyOutputEdits();
      });
    }

    if (dom.toggleGrid) {
      dom.toggleGrid.addEventListener('change', function () {
        state.showGrid = this.checked;
        applyOutputEdits();
      });
    }

    if (dom.toggleTrimBlack) {
      dom.toggleTrimBlack.addEventListener('change', function () {
        state.trimBlack = this.checked;   // changes the crop window → must re-lay out
        recomposeCollage();
      });
    }

    if (dom.toggleFillGaps) {
      dom.toggleFillGaps.addEventListener('change', function () {
        state.compositeFill = this.checked;
        recomposeCollage();
      });
    }

    // Mosaic / layout controls — re-layout the cached tiles on change (no re-alignment)
    function updateMosaicVisibility() {
      var mode = state.mosaic.mode, pattern = state.mosaic.pattern;
      document.querySelectorAll('.mosaic-sub').forEach(function (el) {
        var show = el.getAttribute('data-show');
        var visible = (show === mode) || (mode === 'composite' && show === pattern);
        el.classList.toggle('hidden', !visible);
      });
    }
    if (dom.mosaicMode) {
      dom.mosaicMode.addEventListener('change', function () {
        state.mosaic.mode = this.value; updateMosaicVisibility(); recomposeCollage();
      });
    }
    if (dom.mosaicOrientation) {
      dom.mosaicOrientation.addEventListener('change', function () {
        state.mosaic.orientation = this.value; recomposeCollage();
      });
    }
    if (dom.mosaicCols) {
      dom.mosaicCols.addEventListener('input', function () {
        state.mosaic.gridCols = Math.max(1, Number(this.value) || 1); recomposeCollage();
      });
    }
    if (dom.mosaicPattern) {
      dom.mosaicPattern.addEventListener('change', function () {
        state.mosaic.pattern = this.value; updateMosaicVisibility(); recomposeCollage();
      });
    }
    if (dom.mosaicBands) {
      dom.mosaicBands.addEventListener('input', function () {
        state.mosaic.bandsPerImage = Math.max(1, Number(this.value) || 1); recomposeCollage();
      });
    }
    if (dom.mosaicAngle) {
      dom.mosaicAngle.addEventListener('input', function () {
        state.mosaic.angle = Number(this.value);
        if (dom.valMosaicAngle) dom.valMosaicAngle.textContent = this.value + '°';
        recomposeCollage();
      });
    }
    if (dom.mosaicBlocksX) {
      dom.mosaicBlocksX.addEventListener('input', function () {
        state.mosaic.blocksX = Math.max(1, Number(this.value) || 1); recomposeCollage();
      });
    }
    if (dom.mosaicBlocksY) {
      dom.mosaicBlocksY.addEventListener('input', function () {
        state.mosaic.blocksY = Math.max(1, Number(this.value) || 1); recomposeCollage();
      });
    }
    if (dom.mosaicSectors) {
      dom.mosaicSectors.addEventListener('input', function () {
        state.mosaic.sectors = Math.max(2, Number(this.value) || 2); recomposeCollage();
      });
    }
    updateMosaicVisibility();

    if (dom.labelGlobalBold) {
      dom.labelGlobalBold.setAttribute('aria-pressed', String(state.labelGlobals.bold));
      dom.labelGlobalBold.addEventListener('click', function () {
        state.labelGlobals.bold = !state.labelGlobals.bold;
        this.setAttribute('aria-pressed', String(state.labelGlobals.bold));
        if (state.collageBase) applyOutputEdits();
      });
    }

    if (dom.labelGlobalItalic) {
      dom.labelGlobalItalic.setAttribute('aria-pressed', String(state.labelGlobals.italic));
      dom.labelGlobalItalic.addEventListener('click', function () {
        state.labelGlobals.italic = !state.labelGlobals.italic;
        this.setAttribute('aria-pressed', String(state.labelGlobals.italic));
        if (state.collageBase) applyOutputEdits();
      });
    }

    if (dom.labelGlobalBgColor) {
      dom.labelGlobalBgColor.addEventListener('click', function () {
        if (!window.SharedColorPicker) return;
        SharedColorPicker.open(state.labelGlobals.bgColor, function (hex, op) {
          state.labelGlobals.bgColor = hex;
          if (op !== undefined) state.labelGlobals.bgOpacity = op;
          if (dom.labelGlobalBgColor) dom.labelGlobalBgColor.style.setProperty('--swatch', hex);
          if (state.collageBase) applyOutputEdits();
        }, { opacity: state.labelGlobals.bgOpacity });
      });
    }

    if (dom.btnExpandCollage) {
      dom.btnExpandCollage.addEventListener('click', function () {
        if (!dom.collageCanvas || !dom.collageModalOverlay || !dom.collageModalImg) return;
        try {
          dom.collageModalImg.src = dom.collageCanvas.toDataURL('image/png');
          dom.collageModalOverlay.classList.remove('hidden');
          dom.collageModalOverlay.setAttribute('aria-hidden', 'false');
        } catch (e) {
          console.warn('[ChronoSync] Cannot capture collage canvas:', e);
        }
      });
    }

    if (dom.btnCloseCollageModal) {
      dom.btnCloseCollageModal.addEventListener('click', function () {
        dom.collageModalOverlay.classList.add('hidden');
        dom.collageModalOverlay.setAttribute('aria-hidden', 'true');
      });
    }

    if (dom.collageModalOverlay) {
      dom.collageModalOverlay.addEventListener('click', function (e) {
        if (e.target === dom.collageModalOverlay) {
          dom.collageModalOverlay.classList.add('hidden');
          dom.collageModalOverlay.setAttribute('aria-hidden', 'true');
        }
      });
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
    if (dom.outputTemperature) {
      dom.outputTemperature.addEventListener('input', function () {
        state.edits.temperature = Number(this.value);
        dom.valTemperature.textContent = this.value;
        applyOutputEdits();
      });
    }
    if (dom.outputTint) {
      dom.outputTint.addEventListener('input', function () {
        state.edits.tint = Number(this.value);
        dom.valTint.textContent = this.value;
        applyOutputEdits();
      });
    }
    if (dom.outputGamma) {
      dom.outputGamma.addEventListener('input', function () {
        state.edits.gamma = Number(this.value);
        dom.valGamma.textContent = this.value;
        applyOutputEdits();
      });
    }
    if (dom.btnOutputReset) {
      dom.btnOutputReset.addEventListener('click', resetEdits);
    }

    if (dom.labelGlobalPos) {
      dom.labelGlobalPos.addEventListener('change', function () {
        state.labelGlobals.position = this.value;
        state.photos.forEach(function (p) { p.labelPosition = state.labelGlobals.position; });
        document.querySelectorAll('.label-pos-select').forEach(function (sel) { sel.value = state.labelGlobals.position; });
        if (state.collageBase) applyOutputEdits();
      });
    }

    if (dom.labelGlobalColor) {
      dom.labelGlobalColor.addEventListener('click', function () {
        if (!window.SharedColorPicker) return;
        SharedColorPicker.open(state.labelGlobals.color, function (hex, op) {
          state.labelGlobals.color = hex;
          if (op !== undefined) state.labelGlobals.colorOpacity = op;
          if (dom.labelGlobalColor) dom.labelGlobalColor.style.setProperty('--swatch', hex);
          state.photos.forEach(function (p) {
            p.labelColor = hex;
            updateSwatchInCard(p.id, hex);
          });
          if (state.collageBase) applyOutputEdits();
        }, { opacity: state.labelGlobals.colorOpacity });
      });
    }

    if (dom.labelGlobalFont) {
      dom.labelGlobalFont.addEventListener('change', function () {
        state.labelGlobals.font = this.value;
        if (state.collageBase) applyOutputEdits();
      });
    }

    if (dom.labelGlobalSize) {
      dom.labelGlobalSize.addEventListener('input', function () {
        state.labelGlobals.size = Number(this.value);
        if (dom.valLabelGlobalSize) dom.valLabelGlobalSize.textContent = this.value;
        if (state.collageBase) applyOutputEdits();
      });
    }

    if (dom.labelGlobalMargin) {
      dom.labelGlobalMargin.addEventListener('input', function () {
        state.labelGlobals.margin = Number(this.value);
        if (dom.valLabelGlobalMargin) dom.valLabelGlobalMargin.textContent = this.value + '%';
        if (state.collageBase) applyOutputEdits();
      });
    }

    // Stepper buttons (+/−) — shared pattern used across tools
    document.querySelectorAll('[data-step-target]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var target = document.getElementById(btn.dataset.stepTarget);
        if (!target) return;
        var step = Number(btn.dataset.step || 0);
        var minV = target.min !== '' ? Number(target.min) : -Infinity;
        var maxV = target.max !== '' ? Number(target.max) :  Infinity;
        target.value = Math.max(minV, Math.min(maxV, Number(target.value || 0) + step));
        target.dispatchEvent(new Event('input', { bubbles: true }));
      });
    });

    syncReferenceSelect();
    bindDragDrop();
    bindPhotoEditModal();
    if (window.ChronoSyncWorker) ChronoSyncWorker.preload();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
