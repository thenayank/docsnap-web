# DocSnap Web

Mobile-first, installable document scanner (PWA). Plain HTML/JS, no build step.

- Capture with camera or upload → auto edge detection (OpenCV.js) → drag-corner adjust → perspective correction
- Multi-page documents stored locally in IndexedDB (rename, delete, delete page)
- OCR with Tesseract.js (English / Hindi), copy to clipboard
- PDF export (jsPDF) shared via Web Share API or downloaded
- Offline-capable service worker; Add to Home Screen on iPhone (Safari → Share → Add to Home Screen)

Run locally: `python3 -m http.server` in this folder, then open http://localhost:8000.
Vendored libs: OpenCV.js 4.9.0 (Apache-2.0), jsPDF 2.5.2 (MIT), Tesseract.js 5.1.1 (Apache-2.0).
