/**
 * Offline: build data/met_catalog.json from highlight paintings CSV.
 * Fetches Met /objects/{id} for public-domain rows and keeps those with primaryImageSmall.
 * Resumes from an existing catalog file. Backs off hard on 403/429.
 *
 * Usage: node scripts/build-met-catalog.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const CSV_PATH = path.join(ROOT, "data", "MetObjects_highlight_paintings.csv");
const OUT_PATH = path.join(ROOT, "data", "met_catalog.json");
const MET_API = "https://collectionapi.metmuseum.org/public/collection/v1";
const DELAY_MS = 400;
const MAX_RETRIES = 8;

function parseCSV(text) {
  const lines = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      lines.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    lines.push(row);
  }
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = lines[0].map((h) => h.trim());
  const rows = lines
    .slice(1)
    .filter((r) => r.some((c) => c.trim()))
    .map((r) => {
      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = (r[i] ?? "").trim();
      });
      return obj;
    });
  return { headers, rows };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchObject(id) {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${MET_API}/objects/${id}`, {
        headers: {
          Accept: "application/json",
          "User-Agent": "photo-game-met-catalog/1.0 (local offline build)",
        },
      });
      if (res.status === 403 || res.status === 429 || res.status >= 500) {
        const wait = Math.min(60000, 1500 * Math.pow(2, attempt));
        console.warn(`\n  ${id}: HTTP ${res.status}, waiting ${wait}ms (attempt ${attempt + 1})`);
        await sleep(wait);
        continue;
      }
      if (!res.ok) return { error: res.status };
      return { obj: await res.json() };
    } catch (e) {
      const wait = Math.min(60000, 1500 * Math.pow(2, attempt));
      console.warn(`\n  ${id}: ${e.message}, waiting ${wait}ms`);
      await sleep(wait);
    }
  }
  return { error: "retries exhausted" };
}

function loadExisting() {
  if (!fs.existsSync(OUT_PATH)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(OUT_PATH, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeCatalog(catalog) {
  fs.writeFileSync(OUT_PATH, JSON.stringify(catalog, null, 2) + "\n");
}

async function main() {
  const csvText = fs.readFileSync(CSV_PATH, "utf8");
  const { rows } = parseCSV(csvText);
  const pdRows = rows.filter(
    (r) =>
      r["Is Public Domain"] === "True" &&
      r["Object ID"] &&
      r["Object ID"].trim()
  );
  console.log(`CSV rows: ${rows.length}, public domain: ${pdRows.length}`);

  const catalog = loadExisting();
  const have = new Set(catalog.map((c) => String(c.objectID)));
  console.log(`Resuming with ${catalog.length} existing entries`);

  let noImage = 0;
  let failed = 0;
  const todo = pdRows.filter((r) => !have.has(r["Object ID"].trim()));
  console.log(`Remaining to fetch: ${todo.length}`);

  for (let i = 0; i < todo.length; i++) {
    const row = todo[i];
    const id = row["Object ID"].trim();
    const result = await fetchObject(id);
    if (result.error) {
      failed++;
      console.warn(`\n  skip ${id}: ${result.error}`);
    } else {
      const obj = result.obj;
      const url = (obj.primaryImageSmall || obj.primaryImage || "").trim();
      if (!url || !url.includes("images.metmuseum.org")) {
        noImage++;
      } else {
        const tag =
          (obj.artistDisplayName && obj.artistDisplayName.trim()) ||
          (row["Artist Display Name"] && row["Artist Display Name"].trim()) ||
          (obj.title && obj.title.trim()) ||
          (row.Title && row.Title.trim()) ||
          "Unknown artist";
        const title =
          (obj.title && obj.title.trim()) ||
          (row.Title && row.Title.trim()) ||
          undefined;
        catalog.push({
          objectID: Number(obj.objectID) || Number(id),
          primaryImageSmall: url,
          tag,
          title,
        });
        have.add(String(id));
      }
    }

    if ((i + 1) % 10 === 0 || i === todo.length - 1) {
      writeCatalog(catalog);
      process.stdout.write(
        `\rProgress ${i + 1}/${todo.length}, catalog ${catalog.length}, noImage ${noImage}, failed ${failed}   `
      );
    }
    await sleep(DELAY_MS);
  }

  writeCatalog(catalog);
  console.log(`\nDone. Wrote ${catalog.length} entries to ${OUT_PATH}`);
  console.log(`no image URL: ${noImage}, failed: ${failed}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
