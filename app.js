(function () {
  const MAX_IMAGES = 25;
  const MIN_IMAGES = 2;

  const setupEl = document.getElementById("setup");
  const gameEl = document.getElementById("game");
  const filesInput = document.getElementById("files");
  const tagsInput = document.getElementById("tags");
  const startBtn = document.getElementById("startBtn");
  const puzzleGrid = document.getElementById("puzzleGrid");
  const tagsList = document.getElementById("tagsList");
  const reconstructedGrid = document.getElementById("reconstructedGrid");
  const feedbackEl = document.getElementById("feedback");

  const MAX_LOAD_WIDTH = 600;
  const MAX_LOAD_HEIGHT = 800;

  let state = {
    images: [],       // [{ tag, pieces, width, height }]
    N: 0,
    puzzle: [],       // [{ imageIndex, pieceIndex, element, solved }]
    selectedCell: null,
    reconstructed: [], // [imageIndex][] -> piece dataURL or null
  };

  function getGridSize(n) {
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    return { rows, cols };
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
    const { rows, cols } = getGridSize(n);
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
    const files = filesInput.files;
    const tags = parseTags(tagsInput.value);
    const n = Math.min(files.length, tags.length, MAX_IMAGES);
    startBtn.disabled = n < MIN_IMAGES || tags.length < MIN_IMAGES;
  }

  filesInput.addEventListener("change", enableStart);
  tagsInput.addEventListener("input", enableStart);

  startBtn.addEventListener("click", async () => {
    const files = Array.from(filesInput.files);
    const tags = parseTags(tagsInput.value);
    const n = Math.min(files.length, tags.length, MAX_IMAGES);
    if (n < MIN_IMAGES) {
      alert(`Use at least ${MIN_IMAGES} images and ${MIN_IMAGES} tags.`);
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
          tag: tags[i] || `Image ${i + 1}`,
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

    state.images = images;
    state.N = n;
    state.reconstructed = images.map(() => Array(n).fill(null));

    // Build puzzle: N positions, each gets one piece from each image (each image used once)
    const imageIndices = shuffle(images.map((_, i) => i));
    const assignment = imageIndices.map((imageIndex) => ({
      imageIndex,
      pieceIndex: Math.floor(Math.random() * n),
    }));
    state.puzzle = shuffle(assignment);

    setupEl.classList.add("hidden");
    gameEl.classList.remove("hidden");
    renderGame();
    startBtn.disabled = false;
    startBtn.textContent = "Start puzzle";
  });

  function renderGame() {
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
    const { rows, cols } = getGridSize(state.N);
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

    if (item.imageIndex === imageIndex) {
      item.solved = true;
      state.reconstructed[imageIndex][item.pieceIndex] =
        state.images[imageIndex].pieces[item.pieceIndex];
      state.selectedCell = null;
      item.element.classList.remove("selected");
      feedbackEl.textContent = "Correct!";
      feedbackEl.className = "feedback correct";
      feedbackEl.classList.remove("hidden");
      setTimeout(() => {
        feedbackEl.classList.add("hidden");
        renderGame();
      }, 600);
    } else {
      feedbackEl.textContent = "Wrong tag. Try again.";
      feedbackEl.className = "feedback wrong";
      feedbackEl.classList.remove("hidden");
      setTimeout(() => feedbackEl.classList.add("hidden"), 1500);
    }
  }

  enableStart();
})();
