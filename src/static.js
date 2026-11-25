'use strict';

/**
 * Static asset server: files are read and gzip-compressed once at start-up and
 * served from memory with strong ETags. Only files that exist in the
 * pre-built map can ever be served, which rules out path traversal entirely.
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const MIME_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
});

const NO_CACHE = new Set(['/index.html', '/sw.js']);

function loadStaticFiles(rootDir) {
  const files = new Map();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const type = MIME_TYPES[path.extname(entry.name).toLowerCase()];
      if (!type) continue;
      const body = fs.readFileSync(full);
      const urlPath = `/${path.relative(rootDir, full).split(path.sep).join('/')}`;
      files.set(urlPath, {
        body,
        gzip: zlib.gzipSync(body, { level: 9 }),
        type,
        etag: `"${crypto.createHash('sha1').update(body).digest('base64url').slice(0, 16)}"`,
        cacheControl: NO_CACHE.has(urlPath) ? 'no-cache' : 'public, max-age=3600',
      });
    }
  };
  walk(rootDir);
  return files;
}

function serveStatic(req, res, pathname, files) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD', 'content-type': 'text/plain; charset=utf-8' });
    res.end('Method not allowed');
    return;
  }
  const file = files.get(pathname === '/' ? '/index.html' : pathname);
  if (!file) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  const headers = { 'content-type': file.type, etag: file.etag, 'cache-control': file.cacheControl, vary: 'Accept-Encoding' };
  if (req.headers['if-none-match'] === file.etag) {
    res.writeHead(304, headers);
    res.end();
    return;
  }
  const useGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '') && file.gzip.length < file.body.length;
  const body = useGzip ? file.gzip : file.body;
  if (useGzip) headers['content-encoding'] = 'gzip';
  headers['content-length'] = body.length;
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}

module.exports = { loadStaticFiles, serveStatic, MIME_TYPES };
