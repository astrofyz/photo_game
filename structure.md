# Photo Game — Code Structure & Scenarios

## Code structure

- **Single IIFE** (`app.js`): All logic runs inside an IIFE; no globals except DOM refs and `state`.
- **State**: One `state` object holds `images`, `N`, `puzzle`, `selectedCell`, `reconstructed`, `galleryIndex`, `galleryCanvases`, `score`, `wrongGuesses`.
- **DOM refs**: Setup/game containers, file/tag inputs, puzzle grid, tags list, reconstructed grid, feedback, fullscreen overlay, gallery UI, score display.
- **Helpers**: Grid size, shuffle, image load/resize/split, tag parsing (text + JSON), CSV parsing, Met API/CSV helpers.
- **Game flow**: Setup → load/choose images → `startGameWithImages` → `renderGame`; during play: cell click → tag click → correct/wrong handling → optional flash → `renderGame` again.
- **Gallery**: After all solved, gallery shows full images; prev/next and fullscreen use cached canvases built from pieces.

---

## Scenarios and function call order

### 1. Start game from local files (Start puzzle)

1. **`enableStart`** — Enables/disables Start based on file count and tags (textarea or JSON).
2. User picks files, optionally tags or tags JSON; **`parseTags`** / **`parseTagsJson`** — Parse tags from text or JSON; **`getFileKey`** — Filename key for JSON lookup.
3. User clicks Start → **`loadImage`** (per file) — Load image from file.
4. **`resizeToFit`** — Resize image to max dimensions.
5. **`splitImageIntoPieces`** — Split into N pieces; inside it **`getGridSize`** — Choose rows/cols from N (and optional image size).
6. **`startGameWithImages`** — Init state, shuffle assignment, **`shuffle`** (for image order and puzzle order), show game UI.
7. **`renderGame`** — **`updateScoreDisplay`**; build grid cells (with **`onPuzzleCellClick`**), tag buttons (with **`onTagClick`**), **`buildReconstructedFullImage`** per image; show puzzle or gallery.

### 2. Start game from demo photos

1. User clicks "Load demo" → **fetch** `demo_photos/list.json`.
2. For each filename: **`loadImageFromUrl`** — Load image from URL.
3. **`resizeToFit`** — Resize; **`splitImageIntoPieces`** (uses **`getGridSize`**) — Split into pieces.
4. **`startGameWithImages`** — Same as above.
5. **`renderGame`** — Same as scenario 1.

### 3. Start game from Met (CSV or API)

1. User clicks "Load from Met" → **fetch** default CSV (`MET_CSV_DEFAULT`).
2. If CSV OK: **`parseCSV`** — Parse CSV; **`pickMetRowsFromCSV`** — Pick N rows (with optional **`shuffle`**); if rows have object IDs but no image URL: **`fetchMetObjectsById`** — Get object details and image URL from Met API.
3. If CSV not OK: **`fetchMetPaintings`** — Search Met for paintings, fetch in batches, filter by `objectName === "Painting"` and **`shuffle`** IDs.
4. **`getMetImageUrl`** — Resolve image URL (local proxy or CORS proxy).
5. **`loadImageFromUrl`** (per item) — Load image.
6. **`resizeToFit`** — Resize; **`splitImageIntoPieces`** — Split.
7. **`startGameWithImages`** → **`renderGame`** — Same as scenario 1.

### 4. Playing the puzzle (click piece → click tag)

1. **`onPuzzleCellClick(index)`** — Select puzzle cell (toggle off previous selection and **`.selected`** on tag buttons if any), set **`state.selectedCell`**, add **`.selected`** to cell.
2. **`onTagClick(imageIndex)`** — If no cell selected, return.
3. **If correct** (tag matches piece's image): **`pointsForAttempt`** — Score for attempt count; update **`state.score`**, **`state.reconstructed`**, mark piece **`solved`**, clear selection; **`updateScoreDisplay`**; show "Correct!" feedback; after 400 ms **`showFullscreenFlash`** → **`buildFullImageCanvas`** — Build full image from pieces; show overlay; after **`FLASH_DURATION_MS`** close overlay and call **`thenRender`** = **`renderGame`**.
4. **If wrong**: Bump **`state.wrongGuesses[cellIndex]`**, show "Wrong tag" feedback, hide after 1.5 s.

### 5. Gallery (all pieces solved)

1. **`renderGame`** sees all solved → hide puzzle grid, show **`puzzleGallery`**, set instruction, **`formatGalleryCaption`** — Format caption (title + tag); **`renderGalleryImage`** — **`formatGalleryCaption`** again; **`buildFullImageCanvas`** (or use **`state.galleryCanvases`** cache); put canvas in **`galleryImageWrap`**, attach **`showFullscreenImage`** on click/Enter/Space.
2. **Gallery prev/next**: Update **`state.galleryIndex`**, then **`renderGalleryImage`** (caption + canvas from cache or **`buildFullImageCanvas`**).

### 6. Fullscreen image

1. **`showFullscreenImage(imageIndex)`** — **`buildFullImageCanvas`** (max size from window) → draw on **`fullscreenCanvas`**, show overlay, set **`dataset.mode = "view"`**; click closes overlay.
2. **`showFullscreenFlash`** — Same build/draw/show, **`dataset.mode = "flash"`**, auto-close after **`FLASH_DURATION_MS`** and call **`thenRender`** (e.g. **`renderGame`**).

### 7. Tags from JSON file

1. User selects JSON file → **FileReader** loads it; **`parseTagsJson`** — Build `filename → tag` map; **`getFileKey`** used inside; fill **`tagsInput`** from that map; **`enableStart`** — Re-check if Start can be enabled.

---

## One-line function summary

| Function | One-sentence role |
|----------|-------------------|
| **getGridSize** | Picks rows/cols for N pieces, optionally matching image aspect. |
| **shuffle** | Randomly shuffles an array. |
| **loadImage** | Loads an image from a File object (object URL). |
| **loadImageFromUrl** | Loads an image from a URL (with CORS). |
| **resizeToFit** | Draws image to a canvas scaled to fit max width/height. |
| **splitImageIntoPieces** | Splits a canvas into N piece data URLs using getGridSize. |
| **parseTags** | Splits tag text by newlines/commas and trims. |
| **enableStart** | Enables Start button only if enough files and tags (or JSON tags). |
| **getFileKey** | Returns filename without path for JSON lookup. |
| **parseTagsJson** | Parses JSON into a filename→tag map (object or array form). |
| **startGameWithImages** | Initializes state, shuffles assignment, shows game and calls renderGame. |
| **parseCSV** | Parses CSV text into headers and row objects. |
| **pickMetRowsFromCSV** | Picks N rows from CSV (with optional unique-artist filter). |
| **fetchMetObjectsById** | Fetches Met object JSON by ID to get primaryImage. |
| **fetchMetPaintings** | Searches Met for paintings and fetches until enough with images. |
| **getMetImageUrl** | Returns Met image URL (local proxy or CORS proxy). |
| **pointsForAttempt** | Returns score for attempt number (100/50/25/10). |
| **updateScoreDisplay** | Writes current score into the score DOM element. |
| **renderGame** | Updates score, shows puzzle or gallery, (re)builds grid, tags, reconstructed strips, and gallery image. |
| **formatGalleryCaption** | Returns "title — tag" or just tag for gallery. |
| **renderGalleryImage** | Updates caption, prev/next visibility, and current image canvas (cache or buildFullImageCanvas). |
| **buildFullImageCanvas** | Builds one canvas with the full image from an image's pieces. |
| **showFullscreenFlash** | Shows full image in overlay briefly then closes and calls thenRender. |
| **showFullscreenImage** | Shows full image in overlay until user closes it. |
| **buildReconstructedFullImage** | Fills a container with reconstructed image or empty placeholder. |
| **onPuzzleCellClick** | Selects a puzzle cell (and deselects previous). |
| **onTagClick** | Checks selected tag vs selected cell: correct → score, reconstruct, flash, renderGame; wrong → wrong feedback. |
