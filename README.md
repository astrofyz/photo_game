# Photo Puzzle

A small web game: upload N images with tags, each image is split into N pieces, and a composite puzzle is built from one random piece per image. Match each piece to its tag by clicking the piece then the correct tag.

## How to play

1. **Setup**: Choose 2–25 images and enter one tag per line (same order as the file list). Tags can be separated by newlines or commas.
2. **Start puzzle**: Each image is split into N squares; one random piece from each image is placed in the puzzle grid in random order.
3. **Match**: Click a puzzle piece (it highlights), then click the tag you think it belongs to.
   - **Correct**: The piece disappears from the puzzle and appears in the “Reconstructed” area under that tag. You can keep guessing.
   - **Wrong**: A message appears; you can try another tag for the same piece or select a different piece.

Win by matching all pieces to their tags.

## “Load from Met” (local)

Met Museum images are on a domain that doesn’t allow cross-origin use in the browser, so **“Load from Met”** only works when the app is served with the image proxy (local server or Cloudflare Pages):

```bash
npm start
```

Then open **http://localhost:3000**. On Cloudflare Pages, the same proxy lives at `/api/proxy` via a Pages Function.

### Deploy to Cloudflare Pages

```bash
npm install
npm run pages:deploy
```

Or connect this repo in the Cloudflare dashboard (no build command; output directory `.`). Do not publish `data/MetObjects.csv` — the app uses `data/MetObjects_highlight_paintings.csv`.
