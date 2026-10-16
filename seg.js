// Isolated context for MediaPipe (used by the Passport Photo tool).
import { FilesetResolver, ImageSegmenter } from './vendor/mediapipe/vision_bundle.mjs';
let seg = null;
window.segment = async (imageData) => {
  if (!seg) {
    const fs = await FilesetResolver.forVisionTasks(new URL('vendor/mediapipe/wasm', location.href).href);
    seg = await ImageSegmenter.createFromOptions(fs, {
      baseOptions: { modelAssetPath: new URL('vendor/mediapipe/selfie_segmenter.tflite', location.href).href, delegate: 'CPU' },
      runningMode: 'IMAGE', outputCategoryMask: false, outputConfidenceMasks: true,
    });
  }
  const res = seg.segment(imageData);
  const m = res.confidenceMasks[0];
  const out = { width: m.width, height: m.height, data: new Float32Array(m.getAsFloat32Array()) };
  res.close();
  return out;
};
window.segReady = true;
