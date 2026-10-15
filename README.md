# DocSnap Web

Mobile-first, installable document scanner (PWA). Plain HTML/JS, no build step, everything runs on the device.

**Scan**
- Camera or photo upload, then auto edge detection (OpenCV.js), drag-corner adjust and perspective correction
- Filters: Original, Magic (shadow removal + contrast), B&W (adaptive threshold), Grayscale
- Multi-page docs: reorder (◀ ▶), rotate, delete page, watermark text, draw & place signature
- OCR (Tesseract.js, English/Hindi), copy, and the text becomes searchable
- Search across names, folders and OCR text; folders; rename/move/delete; share as PDF

**Tools**
- ID card: front + back at real size (85.6×54 mm) on one A4 page
- Passport photo: 35×45 mm (India), background made white with MediaPipe selfie segmentation, A4 sheet of 4–30 copies
- PDF: merge, split/extract, compress (re-renders pages as JPEG), add password (AES-256), remove password, images→PDF, PDF→images

Run locally: `python3 -m http.server` in this folder, then open http://localhost:8000.

Vendored libraries: OpenCV.js 4.9.0 (Apache-2.0), jsPDF 2.5.2 (MIT), Tesseract.js 5.1.1 (Apache-2.0),
@cantoo/pdf-lib 2.11.1 (MIT), pdf.js 3.11.174 (Apache-2.0), MediaPipe Tasks Vision 1.1.1 + selfie_segmenter model (Apache-2.0).
