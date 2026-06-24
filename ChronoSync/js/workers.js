(function () {
  if (window.ChronoSyncWorker) return;

  var PYODIDE_CDN = 'https://cdn.jsdelivr.net/pyodide/v0.27.0/full/pyodide.js';
  var MAX_WORKERS = 2;   // each worker is a full Pyodide+skimage runtime (~hundreds of MB)
  var ALIGN_SIZE  = 900;  // max px for alignment computation; full-res warp applied after

  var PYTHON_CODE = `
import numpy as np
import json
import base64
import gc
import io
from PIL import Image
from skimage.feature import ORB, SIFT, match_descriptors
from skimage.measure import ransac
from skimage.filters import gaussian
from skimage.transform import (SimilarityTransform, AffineTransform, ProjectiveTransform,
                               warp as sk_warp, resize as sk_resize)

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

def _detect(gray, n_keypoints=3000):
    # ORB (oriented FAST + rotated BRIEF) on the plain grayscale image.
    # On temporal photo pairs ORB yields far more correspondences than
    # scikit-image's SIFT and runs ~2x faster. Descriptors are binary, so
    # matching uses Hamming distance (see match_descriptors below).
    gray_f = gray.astype(np.float64) / 255.0
    orb = ORB(n_keypoints=n_keypoints)
    orb.detect_and_extract(gray_f)
    return orb.keypoints, orb.descriptors

def _detect_sift(gray):
    # SIFT (scikit-image): far more distinctive than ORB on HARD temporal pairs
    # where the scene changed a lot (new foliage covering structure, different
    # season). Slower than ORB, so it is only used as a fallback when ORB fails to
    # produce a model that beats doing nothing. Descriptors are float → L2 matching.
    sift = SIFT()
    sift.detect_and_extract(gray.astype(np.float64) / 255.0)
    return sift.keypoints, sift.descriptors

def _subsample(arr, cap):
    # Even-stride subsample to at most cap rows (display only, keeps overlay readable).
    if len(arr) <= cap:
        return arr
    step = int(np.ceil(len(arr) / float(cap)))
    return arr[::step]

def _masked_ncc(a, b, mask, sigma=2.0):
    # Structural similarity over the overlap: low-pass (kills sub-pixel jitter,
    # emphasizes geometry/edges over fine texture) then zero-mean normalized
    # cross-correlation. Returns -1 if the overlap is too small to be meaningful.
    if mask.sum() < 500:
        return -1.0
    a = gaussian(a.astype(np.float64), sigma)[mask]
    b = gaussian(b.astype(np.float64), sigma)[mask]
    a = a - a.mean()
    b = b - b.mean()
    d = np.sqrt((a * a).sum() * (b * b).sum())
    return float((a * b).sum() / d) if d > 0 else -1.0

def _estimate(src, dst, ref_gray, img_gray, ncc_identity, n_hyp):
    # Best-of-K over Similarity (4 DOF) AND Affine (6 DOF), with a strong bias toward
    # the more rigid Similarity. Affine adds shear / anisotropic scale, which on temporal
    # pairs the global NCC sometimes rewards by a hair (fitting changed-texture regions)
    # while it visibly TWISTS salient straight structures — e.g. an 8° shear that tilts a
    # lamppost. So affine is (a) constrained to be MILD (shear and anisotropy capped) and
    # (b) only chosen if it beats the best similarity by a real margin, not noise.
    #
    # Best-of-K: matches are deterministic but with the low inlier rate of temporal pairs
    # a single RANSAC fit is unstable (one run nails ~0.4°, the next drifts). We try n_hyp
    # hypotheses per model and keep, per model, the one whose aligned result structurally
    # correlates best with the reference — only if it beats doing nothing (identity).
    floor       = ncc_identity + 0.003   # must beat doing nothing
    aff_margin  = 0.02                    # affine must beat best similarity by this to win
    max_shear   = 5.0                     # deg — keep affine mild (no visible twisting)
    max_aniso   = 1.06                    # max sx/sy ratio
    best = {}   # tag -> (ncc, model, inliers)
    seen = set()
    for Model, min_samples, tag in ((SimilarityTransform, 2, 's'), (AffineTransform, 3, 'a')):
        for _hyp in range(n_hyp):
            model, inliers = ransac(
                (src, dst), Model,
                min_samples=min_samples, residual_threshold=3, max_trials=1500
            )
            if model is None or inliers is None or int(np.sum(inliers)) < 6:
                continue
            # plausibility pre-check before paying for a warp
            rot_deg = abs(float(np.degrees(model.rotation)))
            sc      = np.atleast_1d(model.scale).astype(float)
            if rot_deg > 30.0 or sc.min() < 0.7 or sc.max() > 1.4:
                continue
            if tag == 'a':
                shear = abs(float(np.degrees(model.shear)))
                aniso = float(sc.max() / max(sc.min(), 1e-6))
                if shear > max_shear or aniso > max_aniso:
                    continue
            # many hypotheses converge to the same model — only warp/score new ones
            key = (tag, round(float(model.rotation), 4),
                   round(float(sc[0]), 4), round(float(sc[-1]), 4),
                   round(float(model.translation[0]), 1), round(float(model.translation[1]), 1))
            if key in seen:
                continue
            seen.add(key)
            warped = sk_warp(img_gray, model.inverse, output_shape=ref_gray.shape,
                             cval=0.0, preserve_range=True)
            cover  = sk_warp(np.ones_like(img_gray, dtype=np.float64), model.inverse,
                             output_shape=ref_gray.shape, cval=0.0, preserve_range=True)
            ncc = _masked_ncc(ref_gray, warped, cover > 0.5)
            if ncc <= floor:
                continue
            if tag not in best or ncc > best[tag][0]:
                best[tag] = (ncc, model, inliers)

    sim = best.get('s')
    aff = best.get('a')
    if sim is not None and aff is not None:
        chosen = aff if aff[0] > sim[0] + aff_margin else sim
    else:
        chosen = sim if sim is not None else aff
    if chosen is None:
        return None, None, None
    return chosen[1], chosen[2], chosen[0]

def process_single(_payload_json):
    payload  = json.loads(_payload_json)
    ref_b64  = payload['ref_b64']
    img_b64  = payload.get('img_b64')
    max_dim  = int(payload.get('align_size', 900))

    ref_full     = _decode_image(ref_b64)
    ref_h, ref_w = ref_full.shape[:2]

    # NOTE: images arrive already downscaled from app.js (≤ align_size). The worker
    # only computes the transform MATRIX; the full-res warp is done on a canvas in the
    # main thread. This keeps full-res pixels out of WASM entirely (the big memory win).
    # Returned matrix/keypoints are in the coordinates of the RECEIVED image; app.js
    # rescales them to the original resolution.
    if img_b64 is None:
        # Reference image: identity transform, just compute kps for display.
        ref_scale = min(max_dim / max(ref_h, ref_w), 1.0)
        ref_small = _resize_by_scale(ref_full, ref_scale)
        ref_gray  = _to_gray(ref_small)
        ref_kp, _ = _detect(ref_gray)
        if len(ref_kp) > 600:
            ref_kp = ref_kp[:600]
        kp_xy = (ref_kp[:, ::-1] / ref_scale).tolist()
        return json.dumps({
            'matrix':      [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
            'kp_ref':      kp_xy,
            'kp_all':      [],
            'n_inliers':   len(ref_kp),
            'is_reference': True,
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

    _dbg = {}
    try:
        n_hyp = int(payload.get('n_hypotheses', 6))

        img_identity = img_gray if img_gray.shape == ref_gray.shape \
                       else sk_resize(img_gray, ref_gray.shape, preserve_range=True)
        ncc_identity = _masked_ncc(ref_gray, img_identity,
                                   np.ones(ref_gray.shape, dtype=bool))
        _dbg['ncc_identity'] = ncc_identity

        # Detector escalation: ORB first (fast, binary descriptors → Hamming +
        # cross-check; nails easy pairs). If ORB yields no model that beats doing
        # nothing, fall back to SIFT (slower but far more distinctive) for hard pairs
        # where the scene changed so much that ORB's matches are essentially noise.
        model = None
        inliers = None
        best_ncc = None
        img_kp = None
        for detector in ('orb', 'sift'):
            if detector == 'orb':
                ref_kp, ref_desc = _detect(ref_gray)
                this_kp, img_desc = _detect(img_gray)
                matches = match_descriptors(ref_desc, img_desc,
                                            metric='hamming', cross_check=True)
            else:
                ref_kp, ref_desc = _detect_sift(ref_gray)
                this_kp, img_desc = _detect_sift(img_gray)
                matches = match_descriptors(ref_desc, img_desc,
                                            metric='euclidean', cross_check=True, max_ratio=0.8)
            _dbg[detector + '_matches'] = len(matches)
            if len(matches) < 6:
                continue
            # src/dst in (x=col, y=row) order — same scale, so H_full derivation is clean
            src = this_kp[matches[:, 1]][:, ::-1].astype(np.float64)
            dst = ref_kp[matches[:, 0]][:, ::-1].astype(np.float64)
            m, inl, ncc = _estimate(src, dst, ref_gray, img_gray, ncc_identity, n_hyp)
            if m is not None:
                model = m
                inliers = inl
                best_ncc = ncc
                img_kp = this_kp
                _dbg['detector'] = detector
                break

        if model is None:
            raise ValueError('No detector/model beats identity (ncc_identity=%.3f)' % ncc_identity)

        n_inliers = int(np.sum(inliers))
        _dbg['inliers']     = n_inliers
        _dbg['ncc_aligned'] = best_ncc
        _dbg['rotation']    = abs(float(np.degrees(model.rotation)))
        _dbg['model_scale'] = float(np.atleast_1d(model.scale)[0])

        # Transform that maps received-image coords → received-reference coords.
        # app.js rescales it to the original resolution and applies it on a canvas.
        H_full = _scale_homography(model.params, scale)

        # Inlier correspondences + all detected keypoints, in received-reference coords
        # (app.js rescales to full-res for the overlay).
        kp_ref      = (dst[inliers] / scale).tolist()
        all_xy      = img_kp[:, ::-1].astype(np.float64)
        all_aligned = model(all_xy) / scale
        kp_all      = _subsample(all_aligned, 600).tolist()

        return json.dumps({
            'matrix':      H_full.tolist(),
            'kp_ref':      kp_ref,
            'kp_all':      kp_all,
            'n_inliers':   n_inliers,
            'is_reference': False,
            'width':  ref_w,
            'height': ref_h,
            'debug': _dbg
        })
    except Exception as e:
        # No usable alignment → identity (image shown unwarped, never worse than nothing).
        return json.dumps({
            'matrix':      [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
            'kp_ref':      [],
            'kp_all':      [],
            'n_inliers':   0,
            'is_reference': False,
            'width':  ref_w,
            'height': ref_h,
            'error': str(e),
            'debug': _dbg
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
      "      _pyodide.globals.set('_payload_json', '');",  // drop the retained base64
      "      _pyodide.runPython('gc.collect()');",          // reclaim per-call arrays
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
