/**
 * Local dev server: serves the app and proxies Met Museum images to avoid CORS.
 * Run: node server.js   (or npm start)
 * Open: http://localhost:3000
 *
 * "Load from Met" will work because images are fetched via same-origin /api/proxy.
 */

const http = require("http");
const https = require("https");
const url = require("url");
const path = require("path");
const fs = require("fs");

const PORT = process.env.PORT || 3000;
const MET_IMAGE_HOST = "images.metmuseum.org";

function serveStatic(filePath, res) {
  const ext = path.extname(filePath);
  const types = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
  };
  const contentType = types[ext] || "application/octet-stream";
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
}

function proxyMetImage(targetUrl, res) {
  const parsed = url.parse(targetUrl);
  if (parsed.hostname !== MET_IMAGE_HOST) {
    res.writeHead(403);
    res.end("Proxy only allows images.metmuseum.org");
    return;
  }
  const opts = {
    hostname: parsed.hostname,
    path: parsed.path,
    method: "GET",
  };
  const client = (parsed.protocol || "https:").startsWith("https") ? https : http;
  const req = client.request(opts, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, {
      "Content-Type": proxyRes.headers["content-type"] || "image/jpeg",
      "Cache-Control": proxyRes.headers["cache-control"] || "public, max-age=86400",
    });
    proxyRes.pipe(res);
  });
  req.on("error", () => {
    res.writeHead(502);
    res.end("Proxy error");
  });
  req.end();
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  if (pathname === "/api/proxy" && req.method === "GET") {
    const imageUrl = parsed.query.url;
    if (!imageUrl) {
      res.writeHead(400);
      res.end("Missing url query");
      return;
    }
    proxyMetImage(imageUrl, res);
    return;
  }

  let filePath = path.join(__dirname, pathname === "/" ? "index.html" : pathname);
  if (!pathname.includes("..") && !path.isAbsolute(pathname)) {
    if (!path.extname(filePath)) {
      try {
        const withIndex = path.join(filePath, "index.html");
        if (fs.existsSync(withIndex)) filePath = withIndex;
        else filePath = path.join(__dirname, pathname, "index.html");
      } catch (_) {}
    }
    if (!fs.existsSync(filePath) && !path.extname(pathname))
      filePath = path.join(__dirname, "index.html");
  }
  serveStatic(filePath, res);
});

server.listen(PORT, () => {
  console.log(`Photo Puzzle server: http://localhost:${PORT}`);
  console.log("Use this URL so \"Load from Met\" works (avoids CORS).");
});
