# React UI redesign: warm minimal

Branch `codex/ui-warm-redesign`, decision [ADR-128](DECISIONS.md). This redesign replaces the visual baseline recorded in the earlier React UI documents. Routes, APIs, the controllers, the CSP and the Go embed are unchanged. No dependencies are added.

## Why

User feedback was that dragging images to upload was unreliable, and that the chat and image pages felt unnatural:

- On the chat page, a dropped file opened in the browser and navigated away. Paste kept only the first file. Uploads showed no preview or progress.
- On the image page, drop only worked over the composer form and gave no feedback. Limits were invisible, and the parameters were hidden behind a popover.

## Design tokens

Every existing token name is kept, so the admin pages pick up the new look without structural edits.

**Colors**

| Token                                | Light                             | Dark                              |
| ------------------------------------ | --------------------------------- | --------------------------------- |
| background / card / sidebar          | `#faf9f7` / `#ffffff` / `#f4f2ee` | `#1b1a18` / `#232220` / `#171614` |
| foreground / muted-foreground        | `#1f1e1c` / `#6b655c`             | `#ecebe7` / `#a6a199`             |
| muted / border / input               | `#efece6` / `#e5e1d9` / `#d9d4ca` | `#2c2a27` / `#383530` / `#45413b` |
| primary / primary-foreground         | `#a64a29` / `#ffffff`             | `#e48b67` / `#1b1a18`             |
| accent / bubble                      | `#f7ebe4` / `#f1eee8`             | `#3b2a22` / `#2a2825`             |
| destructive / destructive-foreground | `#b42318` / `#ffffff`             | `#f29a8e` / `#1b1a18`             |
| success / warning                    | `#2f6f3e` / `#8a5a00`             | `#7fc28f` / `#e0b25c`             |

- Every text pairing reaches at least 4.5:1 contrast. That includes primary and muted text on the muted and accent surfaces.
- Input borders stay decorative, at about 1.5:1. Fields are identified by their label, the card fill and a focus ring of 4.5:1 or more.

**Other tokens**

| Group      | Values                                                                                                    |
| ---------- | --------------------------------------------------------------------------------------------------------- |
| Fonts      | System sans stack with CJK fallbacks; system mono                                                         |
| Text sizes | `text-2xs` (11/16) and `text-message` (15/28)                                                             |
| Radii      | `sm` 6px, `md` 8px, `lg` 10px, `xl` 14px, `2xl` 18px, `3xl` 24px                                          |
| Shadows    | `shadow-xs`, `shadow-sm`, `shadow-md`, `shadow-lg`, built on a theme-aware shadow color                   |
| Motion     | `fade-in`, `rise-in`, `sheet-in`, `drawer-in`, `shimmer`, `typing`, all static keyframes with `ease-soft` |

The reduced-motion reset turns all of these animations off.

**Supporting rules and assets**

- **Utilities.** `lumi-select` draws the select chevron as a data-URI SVG, which `img-src data:` permits. `lumi-shimmer` is the loading shimmer. `reveal-on-hover` hides controls only when `(hover: hover)` matches, so they stay visible on touch devices.
- **Theme before first paint.** `public/theme-init.js` is a same-origin script that applies the stored theme before the first paint. The browser `theme-color` follows the theme chosen in the app.

## Interaction spec

### Reference uploads (chat and image)

**Upload queue** (`features/files/reference-uploads.ts`)

- **Instant preview.** Each picked, pasted or dropped file gets a local `blob:` preview straight away.
- **Pre-checks.** Files are screened by MIME type (PNG, JPEG or WebP), by size (`max_upload_bytes`), and by free slots. Uploads still in flight count as used slots.
- **Skipped files.** A polite notice, which is not an alert, explains what was skipped and why.
- **Concurrency.** Two uploads run at a time. Each item can show "uploading" with a cancel button, or "failed" with retry and cancel. Only a committed reference shows the "remove reference" button.
- **Aborting.** Uploads are aborted only by an explicit cancel or an identity change, never on unmount. A finished upload still commits to the draft store after the user switches mode.
- **Cleanup.** Object URLs are revoked when a reference is removed or sent, on unmount, and on session change.

**Window-level drop and paste** (`features/files/drop.ts`, `DropLayer`)

- **Scope.** It reacts only to drags that carry `Files`.
- **Nothing escapes.** `dragover` and `drop` always call `preventDefault`, so a dropped file never opens in the browser.
- **Overlay.** A lazily loaded overlay reads "Drop to add images", or explains why images can't be added (vision model required, still submitting, or limit reached).
- **Paste outside a text field.** It is routed to the active composer, unless a dialog is open.

**Chat composer**

- The image picker accepts multiple files.
- An `n/4` slot counter is shown.
- For models without vision, the composer explains why images are unavailable.

**Validation of existing images.** Adding a stored image (a result, a gallery item or a library pick) now goes through a single helper, `features/images/references.ts`. The checks run in the same order as before.

### Chat

- **New conversations.** They open on a centered welcome with a larger composer and four suggestion chips.
- **Messages.**
  - The user's messages appear in a soft bubble. Assistant messages appear as a plain column with a small accent mark.
  - Typing dots show while waiting for a reply.
  - Message actions appear on hover or focus. They stay visible on the latest answer and on touch devices. They are hidden with opacity, so they remain clickable.
- **Composer and scrolling.** The composer grows with its content, and a centered pill jumps back to the latest message.
- **Editing.** The edit dialog autofocuses at the end of the text, and Ctrl/Cmd+Enter submits it.

### Image studio

- **At 1024px and wider.** A left panel holds the model, a labelled prompt card with a reference dropzone and library access, and the parameters, which are always visible. Cost, balance and the generate button are pinned below.
- **Below 1024px.** A docked composer opens the parameters in a bottom sheet.
- **One composer at a time.** Only one composer, and therefore only one file input, is ever rendered.
- **Parameter controls.**
  - Quality and count are segmented radios.
  - Ratio is a set of chips with proportional previews.
  - Size stays a native select.
- **Results.**
  - They are listed newest first; only the view is reversed. A submission in flight shows a shimmering placeholder, and new results scroll back into view.
  - Tiles follow the stored or requested aspect ratio.
  - The status pill shows live elapsed time. One clock is shared across the page, and it sits outside live regions.
  - Result actions float over the image.
- **Preview.** It is a full-screen lightbox. At 100% the image fits the screen, and arrow keys move between images.

## Test contract changes

The assertions still check the same outcomes; only locators and interaction steps changed.

All changes are in `tests/react/images.spec.ts`:

- **Parameter controls.** On desktop the parameters are found as the `region` named 生图参数. On mobile, the test first clicks the 生图参数 button, then uses the `dialog`.
- **Same checks, now via radios.**
  - Quality 精细 is checked and is the only priced option.
  - Choosing 3:2 sets the size to `1536x1024`.
  - Choosing a size checks 按尺寸.
  - The count options are 2 张 and 1 张.
- **Bounds check.** The viewport bounds check still applies to the parameter container.
- **Ordering.** `.image-task` `.last()` becomes `.first()`, because results are now newest first.
- **New assertions.** A file dropped on `main` shows 松开以添加图片 and adds one reference. A paste on `document.body` also adds one reference.

All other specs, CSS hooks, accessible names, test IDs and performance thresholds are unchanged.

## Performance

- The authenticated `/chat` static first-load closure was measured from the production build, using the same entry seeds on `main` and on this branch:
  - `main`: 251,071 B gzip.
  - This branch: 245,143 B gzip.
- The new chat composer code is paid for by moving the English catalog into an on-demand chunk; zh-CN stays bundled.
- Image-only code, such as the studio, parameters, lightbox and task cards, stays in lazy route chunks.
- The drop overlay loads only while a file is being dragged.

## Acceptance checklist

- [x] Frozen install, strict typecheck, ESLint with zero warnings, Prettier, 99 unit tests and the production build all pass.
- [x] No new dependency, API, OpenAPI or SQL change; CSP-compatible.
- [x] i18n keys exist in zh-CN and English, enforced by the parity test, which now also covers the React namespace.
- [x] Real Go-embedded Chrome E2E: chat, chat recovery, auth shell and images on desktop, 390 and 320.
- [x] Full suite on a fresh database, including the Lighthouse ≥ 90 and initial-script gzip ≤ 250000 gates: 57/57 passed in 10.4 minutes (desktop, 390, 320). Lighthouse 100, initial script 244,193 B gzip, SSE p95 29/37/27 ms, browser long tasks 0, CLS 0.0001.
- [ ] Manual check at 1440, 768, 390 and 320 px in both themes:
  - real OS drag-and-drop, including a drop outside the composer and onto a non-vision model;
  - clipboard paste;
  - keyboard-only use;
  - reduced motion;
  - spot checks of admin pages;
  - no CSP console violations.
- [ ] Docker embed smoke run (`scripts/react-embed-smoke.mjs`).
