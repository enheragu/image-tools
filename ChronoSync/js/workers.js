(function () {
  if (window.ChronoSyncWorker) return;

  var PYODIDE_CDN = 'https://cdn.jsdelivr.net/pyodide/v0.27.0/full/pyodide.js';

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

def _detect(gray, n_keypoints=400):
    det = ORB(n_keypoints=n_keypoints, fast_threshold=0.05)
    det.detect_and_extract(gray)
    return det.keypoints, det.descriptors

def _align_to_ref(ref_gray, ref_kp, ref_desc, img, img_gray, output_shape):
    try:
        img_kp, img_desc = _detect(img_gray)
        matches = match_descriptors(ref_desc, img_desc, cross_check=True, max_ratio=0.85)
        if len(matches) < 8:
            return None, [], [], 0

        src = img_kp[matches[:, 1]][:, ::-1].astype(np.float64)
        dst = ref_kp[matches[:, 0]][:, ::-1].astype(np.float64)

        model, inliers = ransac(
            (src, dst), ProjectiveTransform,
            min_samples=4, residual_threshold=5, max_trials=500
        )
        n_inliers = int(np.sum(inliers))
        if n_inliers < 4 or model is None:
            return None, [], [], 0

        warped = sk_warp(
            img.astype(np.float32) / 255.0,
            model.inverse,
            output_shape=output_shape[:2],
            preserve_range=True,
            cval=0.0
        )
        warped = np.clip(warped * 255, 0, 255).astype(np.uint8)
        if warped.shape[2] == 3:
            alpha = np.full((*warped.shape[:2], 1), 255, dtype=np.uint8)
            warped = np.concatenate([warped, alpha], axis=2)

        return (
            warped,
            dst[inliers].tolist(),
            src[inliers].tolist(),
            n_inliers
        )
    except Exception as e:
        return None, [], [], 0

def process(_payload_json):
    payload = json.loads(_payload_json)
    ref_idx = int(payload['ref_idx'])
    images_b64 = payload['images']

    images = [_decode_image(b) for b in images_b64]
    grays  = [_to_gray(img) for img in images]

    ref     = images[ref_idx]
    ref_h, ref_w = ref.shape[:2]
    ref_kp, ref_desc = _detect(grays[ref_idx])

    results = []
    for i, (img, gray) in enumerate(zip(images, grays)):
        if i == ref_idx:
            kp_xy = ref_kp[:, ::-1].tolist()
            results.append({
                'aligned_b64': _encode_image(ref),
                'kp_ref': kp_xy,
                'kp_img': kp_xy,
                'n_inliers': len(ref_kp),
                'is_reference': True,
                'width': ref_w,
                'height': ref_h
            })
            continue

        warped, kp_ref, kp_img, n_inliers = _align_to_ref(
            grays[ref_idx], ref_kp, ref_desc,
            img, gray,
            ref.shape
        )
        if warped is None:
            warped = img
            kp_ref, kp_img = [], []

        results.append({
            'aligned_b64': _encode_image(warped),
            'kp_ref': kp_ref,
            'kp_img': kp_img,
            'n_inliers': n_inliers,
            'is_reference': False,
            'width': warped.shape[1],
            'height': warped.shape[0]
        })

    return json.dumps(results)
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
      "      var result = _pyodide.runPython('process(_payload_json)');",
      "      postMessage({ type: 'result', id: d.id, result: result });",
      '    } catch (err) {',
      "      postMessage({ type: 'error', id: d.id, error: String(err) });",
      '    }',
      '  }',
      '};'
    ].join('\n');
  }

  var _worker = null;
  var _initPromise = null;
  var _callbacks = {};
  var _callId = 0;
  var _ready = false;

  function getWorker() {
    if (_initPromise) return _initPromise;

    _initPromise = new Promise(function (resolve, reject) {
      var src = makeWorkerSrc();
      var blob = new Blob([src], { type: 'application/javascript' });
      var url = URL.createObjectURL(blob);
      var w = new Worker(url);
      URL.revokeObjectURL(url);

      var timer = setTimeout(function () { reject(new Error('Worker init timeout')); }, 120000);

      w.addEventListener('message', function (e) {
        var d = e.data;
        if (d.type === 'ready') {
          clearTimeout(timer);
          _ready = true;
          _worker = w;
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
        _initPromise = null;
        _ready = false;
        _worker = null;
        reject(new Error(String(err.message || err)));
      };
      w.postMessage({ type: 'init', code: PYTHON_CODE });
    });

    _initPromise.catch(function () {
      _initPromise = null;
      _ready = false;
      _worker = null;
    });

    return _initPromise;
  }

  function run(payload) {
    return getWorker().then(function (w) {
      return new Promise(function (resolve, reject) {
        var id = ++_callId;
        _callbacks[id] = { resolve: resolve, reject: reject };
        w.postMessage({ type: 'run', id: id, payload: JSON.stringify(payload) });
      });
    });
  }

  function isReady() { return _ready; }

  function preload() { getWorker().catch(function () {}); }

  window.ChronoSyncWorker = { run: run, preload: preload, isReady: isReady };
})();
