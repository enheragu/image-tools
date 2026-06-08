(function () {
  if (window.ChronoSyncWorker) return;

  var PYODIDE_CDN = 'https://cdn.jsdelivr.net/pyodide/v0.27.0/full/pyodide.js';
  var MAX_WORKERS = 4;
  var ALIGN_SIZE  = 900;  // max px for alignment computation; full-res warp applied after

  var PYTHON_CODE = `
import numpy as np
import json
import base64
import io
from PIL import Image
from skimage.feature import ORB, match_descriptors
from skimage.measure import ransac
from skimage.transform import ProjectiveTransform, warp as sk_warp

def _decode_image(b64_str):
    data = base64.b64decode(b64_str.split(',', 1)[-1])
    img = Image.open(io.BytesIO(data)).convert('RGBA')
    return np.array(img, dtype=np.uint8)

def _encode_image(arr):
    buf = io.BytesIO()
    Image.fromarray(arr, 'RGBA').save(buf, format='PNG')
    return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()

def _to_gray(rgba):
    rgb = rgba[..., :3].astype(np.float32)
    return (rgb @ np.array([0.299, 0.587, 0.114])).astype(np.uint8)

def _resize_by_scale(rgba, scale):
    if scale >= 1.0:
        return rgba
    h, w = rgba.shape[:2]
    nw = max(1, int(round(w * scale)))
    nh = max(1, int(round(h * scale)))
    return np.array(Image.fromarray(rgba, 'RGBA').resize((nw, nh), Image.LANCZOS), dtype=np.uint8)

def _scale_homography(H, scale):
    # Both src and dst were resized with same scale, so S_inv @ H @ S gives full-res H
    S    = np.array([[scale, 0, 0], [0, scale, 0], [0, 0, 1]], dtype=np.float64)
    Sinv = np.array([[1/scale, 0, 0], [0, 1/scale, 0], [0, 0, 1]], dtype=np.float64)
    return Sinv @ H @ S

def _detect(gray, n_keypoints=350):
    det = ORB(n_keypoints=n_keypoints, fast_threshold=0.05)
    det.detect_and_extract(gray)
    return det.keypoints, det.descriptors

def process_single(_payload_json):
    payload  = json.loads(_payload_json)
    ref_b64  = payload['ref_b64']
    img_b64  = payload.get('img_b64')
    max_dim  = int(payload.get('align_size', 900))

    ref_full     = _decode_image(ref_b64)
    ref_h, ref_w = ref_full.shape[:2]

    if img_b64 is None:
        # Reference image: return full-res, compute kps at ref scale for display
        ref_scale = min(max_dim / max(ref_h, ref_w), 1.0)
        ref_small = _resize_by_scale(ref_full, ref_scale)
        ref_gray  = _to_gray(ref_small)
        ref_kp, _ = _detect(ref_gray)
        kp_xy = (ref_kp[:, ::-1] / ref_scale).tolist()
        return json.dumps({
            'aligned_b64': _encode_image(ref_full),
            'kp_ref':      kp_xy,
            'kp_img':      kp_xy,
            'n_inliers':   len(ref_kp),
            'is_reference': True,
            'valid_bbox':  [0, 0, ref_w, ref_h],
            'width':  ref_w,
            'height': ref_h
        })

    img_full     = _decode_image(img_b64)
    img_h, img_w = img_full.shape[:2]

    # Use same scale for both images so H_full = S_inv @ H_small @ S is exact
    combined_max = max(ref_h, ref_w, img_h, img_w)
    scale        = min(max_dim / combined_max, 1.0)

    ref_small = _resize_by_scale(ref_full, scale)
    img_small = _resize_by_scale(img_full, scale)
    ref_gray  = _to_gray(ref_small)
    img_gray  = _to_gray(img_small)
    ref_kp, ref_desc = _detect(ref_gray)

    try:
        img_kp, img_desc = _detect(img_gray)
        matches = match_descriptors(ref_desc, img_desc, cross_check=True, max_ratio=0.85)
        if len(matches) < 8:
            raise ValueError('Too few matches: ' + str(len(matches)))

        # src/dst in (x=col, y=row) order — same scale, so H_full derivation is clean
        src = img_kp[matches[:, 1]][:, ::-1].astype(np.float64)
        dst = ref_kp[matches[:, 0]][:, ::-1].astype(np.float64)

        model, inliers = ransac(
            (src, dst), ProjectiveTransform,
            min_samples=4, residual_threshold=5, max_trials=500
        )
        n_inliers = int(np.sum(inliers))
        if n_inliers < 4 or model is None:
            raise ValueError('RANSAC failed')

        # H_full maps (x,y) img_full → (x,y) ref_full
        H_full           = _scale_homography(model.params, scale)
        H_full_transform = ProjectiveTransform(matrix=H_full)
        # Pass .inverse as a bound method (same pattern as model.inverse in reference impl)
        # sk_warp treats callables differently from GeometricTransform objects, avoiding
        # double-inversion. H_full_transform.inverse maps ref_full → img_full. ✓

        warped = sk_warp(
            img_full.astype(np.float32) / 255.0,
            H_full_transform.inverse,
            output_shape=(ref_h, ref_w),
            preserve_range=True,
            cval=0.0
        )
        warped = np.clip(warped * 255, 0, 255).astype(np.uint8)
        if warped.shape[2] == 3:
            alpha  = np.full((*warped.shape[:2], 1), 255, dtype=np.uint8)
            warped = np.concatenate([warped, alpha], axis=2)

        kp_ref = (dst[inliers] / scale).tolist()
        kp_img = (src[inliers] / scale).tolist()

        # Bounding box of pixels that got real source data (alpha > 0 after warp)
        warp_a    = warped[:, :, 3]
        vrows     = np.where(warp_a.max(axis=1) > 0)[0]
        vcols     = np.where(warp_a.max(axis=0) > 0)[0]
        valid_bbox = [int(vcols[0]), int(vrows[0]), int(vcols[-1]) + 1, int(vrows[-1]) + 1] \
                     if (len(vrows) and len(vcols)) else [0, 0, ref_w, ref_h]

        return json.dumps({
            'aligned_b64': _encode_image(warped),
            'kp_ref':      kp_ref,
            'kp_img':      kp_img,
            'n_inliers':   n_inliers,
            'is_reference': False,
            'valid_bbox':  valid_bbox,
            'width':  ref_w,
            'height': ref_h
        })
    except Exception:
        fallback = img_full
        if fallback.shape[:2] != (ref_h, ref_w):
            fallback = np.array(
                Image.fromarray(img_full, 'RGBA').resize((ref_w, ref_h), Image.LANCZOS),
                dtype=np.uint8
            )
        return json.dumps({
            'aligned_b64': _encode_image(fallback),
            'kp_ref':      [],
            'kp_img':      [],
            'n_inliers':   0,
            'is_reference': False,
            'valid_bbox':  [0, 0, ref_w, ref_h],
            'width':  ref_w,
            'height': ref_h
        })
`;

  function makeWorkerSrc() {
    return [
      "importScripts('" + PYODIDE_CDN + "');",
      'var _pyodide = null;',
      'var _ready = false;',
      'async function _init(code) {',
      '  _pyodide = await loadPyodide();',
      "  await _pyodide.loadPackage(['numpy', 'pillow', 'scikit-image']);",
      '  _pyodide.runPython(code);',
      '  _ready = true;',
      "  postMessage({ type: 'ready' });",
      '}',
      'onmessage = async function (e) {',
      '  var d = e.data;',
      "  if (d.type === 'init') { _init(d.code); return; }",
      "  if (d.type === 'run') {",
      "    if (!_ready) { postMessage({ type: 'error', id: d.id, error: 'Worker not ready' }); return; }",
      '    try {',
      "      _pyodide.globals.set('_payload_json', d.payload);",
      "      var result = _pyodide.runPython('process_single(_payload_json)');",
      "      postMessage({ type: 'result', id: d.id, result: result });",
      '    } catch (err) {',
      "      postMessage({ type: 'error', id: d.id, error: String(err) });",
      '    }',
      '  }',
      '};'
    ].join('\n');
  }

  // ── Worker pool ──────────────────────────────────────────────────────────────

  var _workers      = [];
  var _workerReady  = [];
  var _initPromises = [];
  var _callbacks    = {};
  var _callId       = 0;

  function _makeOneWorker(idx) {
    if (_initPromises[idx]) return _initPromises[idx];
    _initPromises[idx] = new Promise(function (resolve, reject) {
      var src  = makeWorkerSrc();
      var blob = new Blob([src], { type: 'application/javascript' });
      var url  = URL.createObjectURL(blob);
      var w    = new Worker(url);
      URL.revokeObjectURL(url);

      var timer = setTimeout(function () {
        reject(new Error('Worker ' + idx + ' init timeout'));
      }, 180000);

      w.addEventListener('message', function (e) {
        var d = e.data;
        if (d.type === 'ready') {
          clearTimeout(timer);
          _workerReady[idx] = true;
          _workers[idx] = w;
          resolve(w);
          return;
        }
        if (d.type === 'result' || d.type === 'error') {
          var cb = _callbacks[d.id];
          if (!cb) return;
          delete _callbacks[d.id];
          if (d.type === 'result') cb.resolve(JSON.parse(d.result));
          else cb.reject(new Error(d.error));
        }
      });
      w.onerror = function (err) {
        clearTimeout(timer);
        _initPromises[idx] = null;
        _workerReady[idx]  = false;
        _workers[idx]      = null;
        reject(new Error(String(err.message || err)));
      };
      w.postMessage({ type: 'init', code: PYTHON_CODE });
    });

    _initPromises[idx].catch(function () {
      _initPromises[idx] = null;
      _workerReady[idx]  = false;
      _workers[idx]      = null;
    });
    return _initPromises[idx];
  }

  function _runOnWorker(workerIdx, payload) {
    return _makeOneWorker(workerIdx).then(function () {
      return new Promise(function (resolve, reject) {
        var id = ++_callId;
        _callbacks[id] = { resolve: resolve, reject: reject };
        _workers[workerIdx].postMessage({
          type: 'run', id: id, payload: JSON.stringify(payload)
        });
      });
    });
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  function run(payload) {
    var refIdx   = payload.ref_idx;
    var images   = payload.images;
    var n        = images.length;
    var refB64   = images[refIdx];
    var nWorkers = Math.min(MAX_WORKERS, n);

    // Pre-spin workers in parallel
    var spawnAll = [];
    for (var wi = 0; wi < nWorkers; wi++) {
      spawnAll.push(_makeOneWorker(wi));
    }

    return Promise.all(spawnAll).then(function () {
      var tasks = images.map(function (b64, idx) {
        var p = { ref_b64: refB64, align_size: ALIGN_SIZE };
        if (idx !== refIdx) p.img_b64 = b64;
        // spread across workers; reference goes to worker 0
        var wIdx = (idx === refIdx) ? 0 : (idx % nWorkers);
        return _runOnWorker(wIdx, p);
      });
      return Promise.all(tasks);
    });
  }

  function isReady() { return _workerReady.some(Boolean); }

  function preload() {
    _makeOneWorker(0).catch(function () {});
    _makeOneWorker(1).catch(function () {});
  }

  window.ChronoSyncWorker = { run: run, preload: preload, isReady: isReady };
})();
