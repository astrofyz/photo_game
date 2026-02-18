(function () {
  const MAX_IMAGES = 25;
  const MIN_IMAGES = 2;

  const setupEl = document.getElementById("setup");
  const gameEl = document.getElementById("game");
  const filesInput = document.getElementById("files");
  const tagsInput = document.getElementById("tags");
  const tagsJsonInput = document.getElementById("tagsJson");
  const startBtn = document.getElementById("startBtn");

  /** Tags loaded from JSON: filename (or path) -> tag. Null if using textarea only. */
  let tagsFromJson = null;
  const puzzleGrid = document.getElementById("puzzleGrid");
  const tagsList = document.getElementById("tagsList");
  const reconstructedGrid = document.getElementById("reconstructedGrid");
  const feedbackEl = document.getElementById("feedback");
  const fullscreenOverlay = document.getElementById("fullscreenOverlay");
  const fullscreenCanvas = document.getElementById("fullscreenCanvas");
  const puzzleWrap = document.querySelector(".puzzle-wrap");
  const puzzleGallery = document.getElementById("puzzleGallery");
  const galleryImageWrap = document.getElementById("galleryImageWrap");
  const galleryCaption = document.getElementById("galleryCaption");
  const galleryPrevBtn = document.getElementById("galleryPrev");
  const galleryNextBtn = document.getElementById("galleryNext");
  const instructionEl = document.getElementById("instruction");
  const scoreDisplayEl = document.getElementById("scoreDisplay");

  const MAX_LOAD_WIDTH = 600;
  const FLASH_DURATION_MS = 2000;
  const MAX_LOAD_HEIGHT = 800;

  const DEMO_PHOTOS_BASE = "demo_photos";
  const MET_CSV_DEFAULT = "data/MetObjects_highlight_paintings.csv";
  const MET_API_BASE = "https://collectionapi.metmuseum.org/public/collection/v1";
  const MET_IMAGE_HOST = "images.metmuseum.org";
  const CORS_PROXY = "https://api.cors.lol/?url=";

  function getMetImageUrl(primaryImageUrl) {
    if (!primaryImageUrl || !primaryImageUrl.includes(MET_IMAGE_HOST))
      return primaryImageUrl;
    const useDeployedPath =
      new URLSearchParams(window.location.search).get("proxy") === "1";
    const origin = window.location.origin;
    if (
      !useDeployedPath &&
      origin &&
      (origin.startsWith("http://localhost") || origin.startsWith("http://127.0.0.1"))
    )
      return origin + "/api/proxy?url=" + encodeURIComponent(primaryImageUrl);
    return CORS_PROXY + encodeURIComponent(primaryImageUrl);
  }

  /** Points per attempt: 1st = 100, 2nd = 50, 3rd = 25, 4th+ = 10 */
  function pointsForAttempt(attemptNumber) {
    if (attemptNumber <= 1) return 100;
    if (attemptNumber === 2) return 50;
    if (attemptNumber === 3) return 25;
    return 10;
  }

  let state = {
    images: [],       // [{ tag, pieces, width, height }]
    N: 0,
    puzzle: [],       // [{ imageIndex, pieceIndex, element, solved }]
    selectedCell: null,
    reconstructed: [], // [imageIndex][] -> piece dataURL or null
    galleryIndex: 0,
    galleryCanvases: {}, // cache full image canvases for gallery
    score: 0,
    wrongGuesses: [], // wrongGuesses[puzzleIndex] = count of wrong tag clicks for that piece
  };

  /**
   * Get grid rows × cols = n. Optional (imageWidth, imageHeight) picks a factorization
   * that matches image aspect (portrait → more rows; landscape → more cols).
   * Without dimensions, picks a factorization closest to square.
   * Only iterates up to sqrt(n), then adds both (r, n/r) and (n/r, r).
   */
  function getGridSize(n, imageWidth, imageHeight) {
    if (n <= 0) return { rows: 1, cols: 1 };
    const pairs = [];
    const limit = Math.floor(Math.sqrt(n));
    for (let r = 1; r <= limit; r++) {
      if (n % r !== 0) continue;
      const c = n / r;
      pairs.push({ rows: r, cols: c });
      if (r !== c) pairs.push({ rows: c, cols: r });
    }
    if (pairs.length === 0) return { rows: 1, cols: n };

    if (imageWidth != null && imageHeight != null && imageWidth > 0 && imageHeight > 0) {
      const imageAspect = imageHeight / imageWidth;
      let best = pairs[0];
      let bestDiff = Infinity;
      for (const p of pairs) {
        const gridAspect = p.rows / p.cols;
        const diff = Math.abs(gridAspect - imageAspect);
        if (diff < bestDiff) {
          bestDiff = diff;
          best = p;
        }
      }
      return best;
    }

    let best = pairs[0];
    let bestDiff = Infinity;
    const sqrt = Math.sqrt(n);
    for (const p of pairs) {
      const gridAspect = p.rows / p.cols;
      const diff = Math.abs(gridAspect - 1);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = p;
      }
    }
    return best;
  }

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Failed to load image"));
      };
      img.src = url;
    });
  }

  function loadImageFromUrl(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Failed to load image"));
      img.src = url;
    });
  }

  function resizeToFit(img, maxW, maxH) {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    let outW = w;
    let outH = h;
    if (w > maxW || h > maxH) {
      const r = Math.min(maxW / w, maxH / h);
      outW = Math.round(w * r);
      outH = Math.round(h * r);
    }
    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, outW, outH);
    return canvas;
  }

  function splitImageIntoPieces(source, n) {
    const w = source.width;
    const h = source.height;
    const { rows, cols } = getGridSize(n, w, h);
    const pieceW = w / cols;
    const pieceH = h / rows;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const pieces = [];

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (pieces.length >= n) break;
        const sx = col * pieceW;
        const sy = row * pieceH;
        canvas.width = pieceW;
        canvas.height = pieceH;
        ctx.drawImage(source, sx, sy, pieceW, pieceH, 0, 0, pieceW, pieceH);
        pieces.push(canvas.toDataURL("image/png"));
      }
    }
    return pieces;
  }

  function parseTags(text) {
    return text
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function enableStart() {
    const files = Array.from(filesInput.files);
    const n = Math.min(files.length, MAX_IMAGES);
    if (n < MIN_IMAGES) {
      startBtn.disabled = true;
      return;
    }
    if (tagsFromJson) {
      const matched = files.slice(0, n).filter((f) => tagsFromJson[getFileKey(f.name)]);
      startBtn.disabled = matched.length < n;
    } else {
      const tags = parseTags(tagsInput.value);
      startBtn.disabled = tags.length < MIN_IMAGES;
    }
  }

  /** Key for JSON lookup: use filename only (no path) so "photo.jpg" and "folder/photo.jpg" both match. */
  function getFileKey(name) {
    return name.split(/[/\\]/).pop() || name;
  }

  /** Parse JSON tags file into { filename: tag }. Supports object or array of { file/filename, tag }. */
  function parseTagsJson(json) {
    const data = typeof json === "string" ? JSON.parse(json) : json;
    const out = {};
    if (Array.isArray(data)) {
      data.forEach((item) => {
        const file = item.file ?? item.filename ?? item.name;
        const tag = item.tag ?? item.title ?? item.label;
        if (file != null && tag != null) out[getFileKey(String(file))] = String(tag).trim();
      });
    } else if (data && typeof data === "object") {
      Object.entries(data).forEach(([key, val]) => {
        if (val != null) out[getFileKey(key)] = String(val).trim();
      });
    }
    return out;
  }

  tagsJsonInput.addEventListener("change", () => {
    const file = tagsJsonInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        tagsFromJson = parseTagsJson(reader.result);
        const files = Array.from(filesInput.files);
        if (files.length > 0) {
          const lines = files.slice(0, MAX_IMAGES).map((f) => tagsFromJson[getFileKey(f.name)] ?? "");
          tagsInput.value = lines.join("\n");
        }
        enableStart();
      } catch (e) {
        alert("Invalid JSON. Use { \"filename.jpg\": \"Tag\" } or [ { \"file\": \"x.jpg\", \"tag\": \"Tag\" } ]");
        tagsFromJson = null;
      }
    };
    reader.readAsText(file);
    tagsJsonInput.value = "";
  });

  filesInput.addEventListener("change", enableStart);
  tagsInput.addEventListener("input", () => {
    tagsFromJson = null;
    enableStart();
  });

  function startGameWithImages(images) {
    const n = images.length;
    state.images = images;
    state.N = n;
    state.reconstructed = images.map(() => Array(n).fill(null));
    state.score = 0;
    state.wrongGuesses = [];

    const imageIndices = shuffle(images.map((_, i) => i));
    const assignment = imageIndices.map((imageIndex) => ({
      imageIndex,
      pieceIndex: Math.floor(Math.random() * n),
    }));
    state.puzzle = shuffle(assignment);

    setupEl.classList.add("hidden");
    gameEl.classList.remove("hidden");
    renderGame();
  }

  startBtn.addEventListener("click", async () => {
    const files = Array.from(filesInput.files);
    const n = Math.min(files.length, MAX_IMAGES);
    if (n < MIN_IMAGES) {
      alert(`Use at least ${MIN_IMAGES} images.`);
      return;
    }

    const tags = tagsFromJson
      ? files.slice(0, n).map((f, i) => tagsFromJson[getFileKey(f.name)] ?? `Image ${i + 1}`)
      : parseTags(tagsInput.value);
    if (tags.length < n) {
      alert(`Provide at least ${n} tags (one per image) in the text field, or load a JSON file with tags for each filename.`);
      return;
    }

    startBtn.disabled = true;
    startBtn.textContent = "Loading…";

    const images = [];
    for (let i = 0; i < n; i++) {
      try {
        const img = await loadImage(files[i]);
        const resized = resizeToFit(img, MAX_LOAD_WIDTH, MAX_LOAD_HEIGHT);
        const pieces = splitImageIntoPieces(resized, n);
        images.push({
          tag: tags[i] ?? `Image ${i + 1}`,
          pieces,
          width: resized.width,
          height: resized.height,
        });
      } catch (e) {
        alert(`Failed to load image ${i + 1}.`);
        startBtn.disabled = false;
        startBtn.textContent = "Start puzzle";
        return;
      }
    }

    startGameWithImages(images);
    startBtn.disabled = false;
    startBtn.textContent = "Start puzzle";
  });

  document.getElementById("demoBtn").addEventListener("click", async () => {
    const demoBtn = document.getElementById("demoBtn");
    demoBtn.disabled = true;
    demoBtn.textContent = "Loading demo…";

    try {
      const listRes = await fetch(`${DEMO_PHOTOS_BASE}/list.json`);
      if (!listRes.ok) throw new Error("list.json not found");
      const filenames = await listRes.json();
      if (!Array.isArray(filenames) || filenames.length < MIN_IMAGES) {
        throw new Error("list.json must be an array of at least " + MIN_IMAGES + " image filenames");
      }
      const n = Math.min(filenames.length, MAX_IMAGES);
      const images = [];
      for (let i = 0; i < n; i++) {
        const filename = filenames[i];
        const url = `${DEMO_PHOTOS_BASE}/${encodeURIComponent(filename)}`;
        const img = await loadImageFromUrl(url);
        const resized = resizeToFit(img, MAX_LOAD_WIDTH, MAX_LOAD_HEIGHT);
        const pieces = splitImageIntoPieces(resized, n);
        const tag = filename.replace(/\.[^.]+$/, "") || filename;
        images.push({
          tag,
          pieces,
          width: resized.width,
          height: resized.height,
        });
      }
      startGameWithImages(images);
    } catch (e) {
      alert("Demo failed to load. Add demo_photos/list.json and image files (see README in demo_photos).");
    }
    demoBtn.disabled = false;
    demoBtn.textContent = "Load demo";
  });

  const MET_OBJECT_BATCH = 15;

  function parseCSV(text) {
    const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
    if (lines.length === 0) return { headers: [], rows: [] };
    const parseRow = (line) => {
      const out = [];
      let i = 0;
      while (i < line.length) {
        if (line[i] === '"') {
          let end = i + 1;
          while (end < line.length) {
            const next = line.indexOf('"', end);
            if (next === -1) break;
            if (line[next + 1] === '"') {
              end = next + 2;
              continue;
            }
            end = next;
            break;
          }
          out.push(line.slice(i + 1, end).replace(/""/g, '"'));
          i = end + 1;
          if (line[i] === ",") i++;
          continue;
        }
        const comma = line.indexOf(",", i);
        if (comma === -1) {
          out.push(line.slice(i).trim());
          break;
        }
        out.push(line.slice(i, comma).trim());
        i = comma + 1;
      }
      return out;
    };
    const headers = parseRow(lines[0]).map((h) =>
      h
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "_")
    );
    const rows = lines.slice(1).map((line) => {
      const values = parseRow(line);
      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = values[i] !== undefined ? values[i].trim() : "";
      });
      return obj;
    });
    return { headers, rows };
  }

  function pickMetRowsFromCSV(csvText, count, options = {}) {
    const { uniqueArtists: wantUnique, overfetch = 0 } = options;
    const { headers, rows } = parseCSV(csvText);
    const imageKey = headers.find(
      (h) => h.includes("primary") && h.includes("image")
    );
    const objectIdKey = headers.find(
      (h) => h === "object_id" || h === "objectid" || h.replace(/_/g, "") === "objectid"
    );
    const artistKey = headers.find(
      (h) =>
        h.includes("artist") && (h.includes("display") || h.includes("name"))
    ) || headers.find((h) => h === "artist");
    const titleKey = headers.find((h) => h === "title");

    const tagFor = (r) =>
      (artistKey && r[artistKey] && r[artistKey].trim()) ||
      (titleKey && r[titleKey] && r[titleKey].trim()) ||
      "Unknown artist";

    const uniqueByTag = (list) => {
      if (!wantUnique) return list;
      const seen = new Set();
      return list.filter((r) => {
        const tag = tagFor(r);
        if (seen.has(tag)) return false;
        seen.add(tag);
        return true;
      });
    };

    if (imageKey) {
      const withUrl = rows.filter((r) => r[imageKey] && r[imageKey].includes("images.metmuseum.org"));
      if (withUrl.length < MIN_IMAGES)
        throw new Error("CSV has too few rows with image URLs (need at least " + MIN_IMAGES + ")");
      const pool = wantUnique ? uniqueByTag(withUrl) : withUrl;
      const shuffled = shuffle(pool);
      const take = Math.min(count, shuffled.length);
      return shuffled.slice(0, take).map((r) => ({
        primaryImage: r[imageKey],
        tag: tagFor(r),
        title: titleKey && r[titleKey] ? r[titleKey].trim() : undefined,
      }));
    }
    if (!objectIdKey) throw new Error("CSV must have primary_image or object_id column");
    const withId = rows.filter((r) => r[objectIdKey] && r[objectIdKey].trim());
    if (withId.length < MIN_IMAGES)
      throw new Error("CSV has too few rows with object IDs (need at least " + MIN_IMAGES + ")");
    const pool = wantUnique ? uniqueByTag(withId) : withId;
    const shuffled = shuffle(pool);
    const take = Math.min(count + overfetch, shuffled.length);
    return shuffled.slice(0, take).map((r) => ({
      objectID: r[objectIdKey].trim(),
      tag: tagFor(r),
      title: titleKey && r[titleKey] ? r[titleKey].trim() : undefined,
    }));
  }

  async function fetchMetObjectsById(items) {
    const results = await Promise.all(
      items.map((item) =>
        fetch(`${MET_API_BASE}/objects/${item.objectID}`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null)
          .then((obj) =>
            obj && obj.primaryImage
              ? {
                  ...item,
                  primaryImage: obj.primaryImage,
                  title: (obj.title && obj.title.trim()) || item.title,
                }
              : null
          )
      )
    );
    return results.filter(Boolean);
  }

  async function fetchMetPaintings(count) {
    const res = await fetch(
      `${MET_API_BASE}/search?isHighlight=true&hasImages=true&q=painting`
    );
    if (!res.ok) throw new Error("Met search failed");
    const data = await res.json();
    if (!data.objectIDs || data.objectIDs.length === 0) throw new Error("No Met results");
    const shuffled = shuffle(data.objectIDs);
    const paintings = [];
    let offset = 0;
    while (paintings.length < count && offset < shuffled.length) {
      const batchIds = shuffled.slice(offset, offset + MET_OBJECT_BATCH);
      offset += MET_OBJECT_BATCH;
      const batch = await Promise.all(
        batchIds.map((id) =>
          fetch(`${MET_API_BASE}/objects/${id}`)
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null)
        )
      );
      for (const obj of batch) {
        if (!obj || obj.objectName !== "Painting" || !obj.primaryImage) continue;
        const tag =
          (obj.artistDisplayName && obj.artistDisplayName.trim()) ||
          obj.title ||
          "Unknown artist";
        if (paintings.some((p) => p.tag === tag)) continue;
        paintings.push({
          objectID: obj.objectID,
          primaryImage: obj.primaryImage,
          tag,
          title: obj.title ? obj.title.trim() : undefined,
        });
        if (paintings.length >= count) break;
      }
    }
    if (paintings.length < MIN_IMAGES) {
      throw new Error(
        "Could not find enough highlight paintings. Try again."
      );
    }
    return paintings.slice(0, Math.min(paintings.length, MAX_IMAGES));
  }

  document.getElementById("metBtn").addEventListener("click", async () => {
    const metBtn = document.getElementById("metBtn");
    const countInput = document.getElementById("metCount");
    let count = parseInt(countInput.value, 10);
    if (Number.isNaN(count) || count < MIN_IMAGES) count = MIN_IMAGES;
    if (count > MAX_IMAGES) count = MAX_IMAGES;
    countInput.value = count;

    metBtn.disabled = true;
    metBtn.textContent = "Loading from Met…";

    try {
      let metItems;
      const csvRes = await fetch(MET_CSV_DEFAULT);
      if (csvRes.ok) {
        const csvText = await csvRes.text();
        const overfetch = 20;
        metItems = pickMetRowsFromCSV(csvText, count, {
          uniqueArtists: true,
          overfetch,
        });
        if (metItems[0] && metItems[0].objectID && !metItems[0].primaryImage) {
          metItems = await fetchMetObjectsById(metItems);
          metItems = metItems.slice(0, count);
        }
      } else {
        metItems = await fetchMetPaintings(count);
      }
      const n = metItems.length;
      const loadedImgs = await Promise.all(
        metItems.map((item) => loadImageFromUrl(getMetImageUrl(item.primaryImage)))
      );
      const images = loadedImgs.map((img, i) => {
        const resized = resizeToFit(img, MAX_LOAD_WIDTH, MAX_LOAD_HEIGHT);
        const pieces = splitImageIntoPieces(resized, n);
        return {
          tag: metItems[i].tag,
          title: metItems[i].title,
          pieces,
          width: resized.width,
          height: resized.height,
        };
      });
      startGameWithImages(images);
    } catch (e) {
      alert(
        "Failed to load from Met: " +
          (e.message || "network or CORS error. Try again.")
      );
    }
    metBtn.disabled = false;
    metBtn.textContent = "Load from Met";
  });

  function updateScoreDisplay() {
    if (scoreDisplayEl) scoreDisplayEl.textContent = "Score: " + state.score;
  }

  function renderGame() {
    const allSolved = state.puzzle.every((item) => item.solved);
    updateScoreDisplay();

    if (allSolved) {
      puzzleGrid.classList.add("hidden");
      puzzleGallery.classList.remove("hidden");
      puzzleGallery.setAttribute("aria-hidden", "false");
      if (instructionEl) instructionEl.textContent = "Gallery — click through photos or click image for full screen. Final score: " + state.score;
      galleryCaption.textContent = formatGalleryCaption(state.images[state.galleryIndex]);
      renderGalleryImage();
      galleryPrevBtn.disabled = false;
      galleryNextBtn.disabled = false;
    } else {
      if (instructionEl) instructionEl.textContent = "Click a puzzle piece, then click the correct tag.";
      puzzleGallery.classList.add("hidden");
      puzzleGallery.setAttribute("aria-hidden", "true");
      puzzleGrid.classList.remove("hidden");
      const { rows, cols } = getGridSize(state.N);
      puzzleGrid.innerHTML = "";
      puzzleGrid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
      puzzleGrid.style.gridTemplateRows = `repeat(${rows}, 1fr)`;


      state.puzzle.forEach((item, index) => {
        const cell = document.createElement("div");
        cell.className = "cell" + (item.solved ? " solved" : "");
        cell.dataset.index = String(index);
        if (!item.solved) {
          cell.style.backgroundImage = `url(${state.images[item.imageIndex].pieces[item.pieceIndex]})`;
        }
        cell.addEventListener("click", () => onPuzzleCellClick(index));
        state.puzzle[index].element = cell;
        puzzleGrid.appendChild(cell);
      });
    }

    tagsList.innerHTML = "";
    state.images.forEach((img, i) => {
      // One piece per image is in the puzzle, so "solved" = at least one piece matched
      const solved = state.reconstructed[i].some(Boolean);
      if (solved) return; // hide tag when this image's piece was matched
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tag-btn";
      btn.textContent = img.tag;
      btn.dataset.imageIndex = String(i);
      btn.addEventListener("click", () => onTagClick(i));
      tagsList.appendChild(btn);
    });

    reconstructedGrid.innerHTML = "";
    state.images.forEach((img, imageIndex) => {
      const wrap = document.createElement("div");
      wrap.className = "reconstructed-item";
      wrap.innerHTML = `<h4>${img.tag}</h4><div class="reconstructed-full"></div>`;
      const container = wrap.querySelector(".reconstructed-full");
      reconstructedGrid.appendChild(wrap);
      buildReconstructedFullImage(imageIndex, container);
    });

    feedbackEl.classList.add("hidden");
  }

  const GALLERY_IMAGE_MAX = 500;

  function formatGalleryCaption(img) {
    return img.title ? img.title + " — " + img.tag : img.tag;
  }

  function renderGalleryImage() {
    const i = state.galleryIndex;
    galleryCaption.textContent = formatGalleryCaption(state.images[i]);
    galleryPrevBtn.disabled = state.N <= 1;
    galleryNextBtn.disabled = state.N <= 1;
    if (state.N > 1) {
      galleryPrevBtn.style.visibility = "visible";
      galleryNextBtn.style.visibility = "visible";
    } else {
      galleryPrevBtn.style.visibility = "hidden";
      galleryNextBtn.style.visibility = "hidden";
    }

    const useCache = state.galleryCanvases[i];
    const build = () =>
      buildFullImageCanvas(i, GALLERY_IMAGE_MAX, GALLERY_IMAGE_MAX).then((canvas) => {
        state.galleryCanvases[i] = canvas;
        return canvas;
      });

    const promise = useCache ? Promise.resolve(useCache) : build();
    promise.then((canvas) => {
      galleryImageWrap.innerHTML = "";
      // cloneNode() does not copy canvas bitmap; draw onto a new canvas instead
      const display = document.createElement("canvas");
      display.width = canvas.width;
      display.height = canvas.height;
      display.getContext("2d").drawImage(canvas, 0, 0);
      display.classList.add("gallery-current");
      display.setAttribute("role", "button");
      display.setAttribute("tabindex", "0");
      display.setAttribute("aria-label", "View full size");
      display.addEventListener("click", () => showFullscreenImage(i));
      display.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          showFullscreenImage(i);
        }
      });
      galleryImageWrap.appendChild(display);
    });
  }

  function buildFullImageCanvas(imageIndex, maxW, maxH) {
    const img = state.images[imageIndex];
    const pieces = img.pieces;
    const { rows, cols } = getGridSize(state.N, img.width, img.height);
    const pieceW = img.width / cols;
    const pieceH = img.height / rows;
    const scale = Math.min(maxW / img.width, maxH / img.height, 1);
    const outW = Math.round(img.width * scale);
    const outH = Math.round(img.height * scale);
    const drawW = outW / cols;
    const drawH = outH / rows;

    const loadPiece = (dataUrl) =>
      new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = reject;
        im.src = dataUrl;
      });

    return Promise.all(pieces.map((dataUrl, k) => loadPiece(dataUrl).then((im) => ({ im, k })))).then(
      (loaded) => {
        const canvas = document.createElement("canvas");
        canvas.width = outW;
        canvas.height = outH;
        const ctx = canvas.getContext("2d");
        loaded.forEach(({ im, k }) => {
          const row = Math.floor(k / cols);
          const col = k % cols;
          ctx.drawImage(im, 0, 0, pieceW, pieceH, col * drawW, row * drawH, drawW, drawH);
        });
        return canvas;
      }
    );
  }

  function showFullscreenFlash(imageIndex, thenRender) {
    const maxW = Math.min(window.innerWidth * 0.9, 1200);
    const maxH = Math.min(window.innerHeight * 0.9, 1200);
    buildFullImageCanvas(imageIndex, maxW, maxH).then((canvas) => {
      fullscreenCanvas.width = canvas.width;
      fullscreenCanvas.height = canvas.height;
      const ctx = fullscreenCanvas.getContext("2d");
      ctx.drawImage(canvas, 0, 0);
      fullscreenOverlay.classList.remove("hidden");
      fullscreenOverlay.setAttribute("aria-hidden", "false");
      fullscreenOverlay.dataset.mode = "flash";
      const close = () => {
        fullscreenOverlay.classList.add("hidden");
        fullscreenOverlay.setAttribute("aria-hidden", "true");
        fullscreenOverlay.removeEventListener("click", close);
        if (thenRender) thenRender();
      };
      fullscreenOverlay.addEventListener("click", close);
      setTimeout(close, FLASH_DURATION_MS);
    });
  }

  function showFullscreenImage(imageIndex) {
    const maxW = Math.min(window.innerWidth * 0.95, 1400);
    const maxH = Math.min(window.innerHeight * 0.95, 1400);
    buildFullImageCanvas(imageIndex, maxW, maxH).then((canvas) => {
      fullscreenCanvas.width = canvas.width;
      fullscreenCanvas.height = canvas.height;
      const ctx = fullscreenCanvas.getContext("2d");
      ctx.drawImage(canvas, 0, 0);
      fullscreenOverlay.classList.remove("hidden");
      fullscreenOverlay.setAttribute("aria-hidden", "false");
      fullscreenOverlay.dataset.mode = "view";
      const close = () => {
        fullscreenOverlay.classList.add("hidden");
        fullscreenOverlay.setAttribute("aria-hidden", "true");
        fullscreenOverlay.removeEventListener("click", close);
      };
      fullscreenOverlay.addEventListener("click", close);
    });
  }

  function buildReconstructedFullImage(imageIndex, container) {
    const img = state.images[imageIndex];
    const solved = state.reconstructed[imageIndex].some(Boolean);

    const maxDisplay = 280;
    const scale = img.width > img.height ? maxDisplay / img.width : maxDisplay / img.height;
    const outW = Math.round(img.width * scale);
    const outH = Math.round(img.height * scale);

    if (!solved) {
      const empty = document.createElement("div");
      empty.className = "reconstructed-empty";
      empty.style.width = outW + "px";
      empty.style.height = outH + "px";
      container.appendChild(empty);
      return;
    }

    const pieces = img.pieces;
    const { rows, cols } = getGridSize(state.N, img.width, img.height);
    const pieceW = img.width / cols;
    const pieceH = img.height / rows;
    const drawW = outW / cols;
    const drawH = outH / rows;

    const loadPiece = (dataUrl) =>
      new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = reject;
        im.src = dataUrl;
      });

    const toLoad = pieces.map((dataUrl, k) => loadPiece(dataUrl).then((im) => ({ im, k })));
    const allSolved = state.puzzle.every((item) => item.solved);

    Promise.all(toLoad).then((loaded) => {
      const canvas = document.createElement("canvas");
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext("2d");
      loaded.forEach(({ im, k }) => {
        const row = Math.floor(k / cols);
        const col = k % cols;
        ctx.drawImage(im, 0, 0, pieceW, pieceH, col * drawW, row * drawH, drawW, drawH);
      });
      container.innerHTML = "";
      container.appendChild(canvas);
      if (allSolved) {
        canvas.classList.add("reconstructed-clickable");
        canvas.setAttribute("role", "button");
        canvas.setAttribute("tabindex", "0");
        canvas.setAttribute("aria-label", "View full size");
        const openFullscreen = () => showFullscreenImage(imageIndex);
        canvas.addEventListener("click", (e) => {
          e.stopPropagation();
          openFullscreen();
        });
        canvas.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openFullscreen();
          }
        });
      }
    });
  }

  function onPuzzleCellClick(index) {
    const item = state.puzzle[index];
    if (item.solved) return;

    if (state.selectedCell !== null) {
      state.puzzle[state.selectedCell].element.classList.remove("selected");
      document.querySelectorAll(".tag-btn.selected").forEach((b) => b.classList.remove("selected"));
    }
    state.selectedCell = index;
    item.element.classList.add("selected");
  }

  function onTagClick(imageIndex) {
    if (state.selectedCell === null) return;
    const item = state.puzzle[state.selectedCell];
    const cellIndex = state.selectedCell;

    if (item.imageIndex === imageIndex) {
      const attempts = (state.wrongGuesses[cellIndex] || 0) + 1;
      const points = pointsForAttempt(attempts);
      state.score += points;

      item.solved = true;
      state.reconstructed[imageIndex][item.pieceIndex] =
        state.images[imageIndex].pieces[item.pieceIndex];
      state.selectedCell = null;
      item.element.classList.remove("selected");
      feedbackEl.textContent = attempts === 1 ? `Correct! +${points} pts` : `Correct! +${points} pts (attempt ${attempts})`;
      feedbackEl.className = "feedback correct";
      feedbackEl.classList.remove("hidden");
      updateScoreDisplay();
      setTimeout(() => {
        feedbackEl.classList.add("hidden");
        showFullscreenFlash(imageIndex, renderGame);
      }, 400);
    } else {
      state.wrongGuesses[cellIndex] = (state.wrongGuesses[cellIndex] || 0) + 1;
      const wrongTagBtn = tagsList.querySelector(`[data-image-index="${imageIndex}"]`);
      if (wrongTagBtn) {
        wrongTagBtn.classList.add("wrong-glow");
        setTimeout(() => wrongTagBtn.classList.remove("wrong-glow"), 500);
      }
      feedbackEl.textContent = "Wrong tag. Try again.";
      feedbackEl.className = "feedback wrong";
      feedbackEl.classList.remove("hidden");
      setTimeout(() => feedbackEl.classList.add("hidden"), 1000);
    }
  }

  galleryPrevBtn.addEventListener("click", () => {
    if (state.N <= 1) return;
    state.galleryIndex = (state.galleryIndex - 1 + state.N) % state.N;
    renderGalleryImage();
  });

  galleryNextBtn.addEventListener("click", () => {
    if (state.N <= 1) return;
    state.galleryIndex = (state.galleryIndex + 1) % state.N;
    renderGalleryImage();
  });

  enableStart();
})();
