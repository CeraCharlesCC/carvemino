import { createQrMatrix } from "./qr-code-generator.js";

const QUIET_ZONE_MODULES = 4;
const TARGET_CANVAS_PIXELS = 420;

export function renderQrCode(canvas, text) {
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error("QR target must be a canvas");
  const value = String(text || "").trim();
  if (!value) {
    canvas.width = 1;
    canvas.height = 1;
    canvas.dataset.qrReady = "false";
    return;
  }

  const modules = createQrMatrix(value);
  const moduleCount = modules.length;
  const totalModules = moduleCount + QUIET_ZONE_MODULES * 2;
  const scale = Math.max(2, Math.floor(TARGET_CANVAS_PIXELS / totalModules));
  const size = totalModules * scale;
  const context = canvas.getContext("2d", { alpha: false });
  canvas.width = size;
  canvas.height = size;
  context.imageSmoothingEnabled = false;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, size, size);
  context.fillStyle = "#000";

  for (let row = 0; row < moduleCount; row += 1) {
    for (let column = 0; column < moduleCount; column += 1) {
      if (!modules[row][column]) continue;
      context.fillRect(
        (column + QUIET_ZONE_MODULES) * scale,
        (row + QUIET_ZONE_MODULES) * scale,
        scale,
        scale
      );
    }
  }
  canvas.dataset.qrReady = "true";
}

export function cameraQrScanSupport() {
  if (!globalThis.isSecureContext) {
    return { supported: false, reason: "CAMERA SCAN REQUIRES HTTPS OR LOCALHOST." };
  }
  if (!globalThis.navigator?.mediaDevices?.getUserMedia) {
    return { supported: false, reason: "CAMERA ACCESS IS NOT AVAILABLE IN THIS BROWSER." };
  }
  if (typeof globalThis.BarcodeDetector !== "function") {
    return { supported: false, reason: "QR CAMERA SCANNING IS NOT SUPPORTED HERE — PASTE THE CODE INSTEAD." };
  }
  return { supported: true, reason: "" };
}

export async function startCameraQrScanner(video, { onResult, onError = () => {} } = {}) {
  if (!(video instanceof HTMLVideoElement)) throw new Error("QR scanner target must be a video element");
  if (typeof onResult !== "function") throw new Error("QR scanner result handler is required");

  const support = cameraQrScanSupport();
  if (!support.supported) throw new Error(support.reason);

  let detector;
  try {
    if (typeof globalThis.BarcodeDetector.getSupportedFormats === "function") {
      const formats = await globalThis.BarcodeDetector.getSupportedFormats();
      if (!formats.includes("qr_code")) throw new Error("QR CAMERA SCANNING IS NOT SUPPORTED HERE — PASTE THE CODE INSTEAD.");
    }
    detector = new globalThis.BarcodeDetector({ formats: ["qr_code"] });
  } catch (error) {
    throw error instanceof Error ? error : new Error("QR camera scanner could not start");
  }

  const stream = await globalThis.navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: "environment" } }
  });
  let active = true;
  let frameHandle = 0;
  let detecting = false;

  function stop() {
    if (!active) return;
    active = false;
    if (frameHandle) cancelAnimationFrame(frameHandle);
    frameHandle = 0;
    for (const track of stream.getTracks()) track.stop();
    video.pause();
    video.srcObject = null;
  }

  async function detectFrame() {
    if (!active) return;
    if (!detecting && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      detecting = true;
      try {
        const results = await detector.detect(video);
        const value = results.find((result) => String(result?.rawValue || "").trim())?.rawValue;
        if (value) {
          stop();
          onResult(String(value).trim());
          return;
        }
      } catch (error) {
        stop();
        onError(error instanceof Error ? error : new Error("QR camera scan failed"));
        return;
      } finally {
        detecting = false;
      }
    }
    if (active) frameHandle = requestAnimationFrame(detectFrame);
  }

  video.srcObject = stream;
  video.setAttribute("playsinline", "");
  video.muted = true;
  try {
    await video.play();
  } catch (error) {
    stop();
    throw error;
  }
  frameHandle = requestAnimationFrame(detectFrame);
  return stop;
}
