const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');

const PORT = process.env.PORT || 8080;

// ── Auth config ──────────────────────────────────────────
const AUTH_USERNAME = process.env.AUTH_USERNAME || 'admin';
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || 'changeme';

// In-memory session store: token → { createdAt }
const sessions = new Map();
const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { createdAt: Date.now() });
  return token;
}

function isValidSession(token) {
  if (!token) return false;
  const session = sessions.get(token);
  if (!session) return false;
  if (Date.now() - session.createdAt > SESSION_MAX_AGE) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  for (const pair of cookieHeader.split(';')) {
    const [key, ...rest] = pair.trim().split('=');
    if (key) cookies[key] = rest.join('=');
  }
  return cookies;
}

function getSessionToken(req) {
  return parseCookies(req.headers.cookie).flow_session || null;
}

// ── S3 config ────────────────────────────────────────────
// Railway bucket variable references: ACCESS_KEY_ID, SECRET_ACCESS_KEY,
// REGION, ENDPOINT, RAILWAY_BUCKET_NAME
const s3 = new S3Client({
  region: process.env.REGION,
  endpoint: process.env.ENDPOINT,
  credentials: {
    accessKeyId: process.env.ACCESS_KEY_ID,
    secretAccessKey: process.env.SECRET_ACCESS_KEY,
  },
});

const S3_BUCKET = process.env.RAILWAY_BUCKET_NAME;
const S3_PREFIX = 'scenarios/';

// ── S3 helpers ───────────────────────────────────────────
async function s3ListScenarios() {
  const result = await s3.send(new ListObjectsV2Command({
    Bucket: S3_BUCKET,
    Prefix: S3_PREFIX,
  }));
  if (!result.Contents) return [];
  return result.Contents
    .map(obj => obj.Key.replace(S3_PREFIX, '').replace(/\.json$/, ''))
    .filter(name => name.length > 0)
    .sort();
}

async function s3GetScenario(name) {
  try {
    const result = await s3.send(new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: `${S3_PREFIX}${name}.json`,
    }));
    const body = await result.Body.transformToString();
    return JSON.parse(body);
  } catch (err) {
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) return null;
    throw err;
  }
}

async function s3PutScenario(name, data) {
  await s3.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: `${S3_PREFIX}${name}.json`,
    Body: JSON.stringify(data),
    ContentType: 'application/json',
  }));
}

async function s3DeleteScenario(name) {
  await s3.send(new DeleteObjectCommand({
    Bucket: S3_BUCKET,
    Key: `${S3_PREFIX}${name}.json`,
  }));
}

// ── MIME types ────────────────────────────────────────────
const MIME = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
};

// ── Helpers ──────────────────────────────────────────────
function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

// ── HTTP server ──────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // ── Login API (no auth required) ───────────────────────
  if (pathname === '/api/login' && req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req));
      if (body.username === AUTH_USERNAME && body.password === AUTH_PASSWORD) {
        const token = createSession();
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Set-Cookie': `flow_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MAX_AGE / 1000}`,
        });
        res.end(JSON.stringify({ ok: true }));
      } else {
        sendJSON(res, 401, { error: 'Invalid username or password' });
      }
    } catch {
      sendJSON(res, 400, { error: 'Invalid request' });
    }
    return;
  }

  // ── Login page (no auth required) ──────────────────────
  if (pathname === '/login.html' || pathname === '/login') {
    const filePath = path.join(__dirname, 'login.html');
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(500); res.end('Error'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
    return;
  }

  // ── Auth check for everything else ─────────────────────
  const token = getSessionToken(req);
  if (!isValidSession(token)) {
    // Redirect browsers to login, return 401 for API calls
    if (pathname.startsWith('/api/')) {
      sendJSON(res, 401, { error: 'Not authenticated' });
    } else {
      res.writeHead(302, { Location: '/login.html' });
      res.end();
    }
    return;
  }

  // ── Logout ─────────────────────────────────────────────
  if (pathname === '/api/logout' && req.method === 'POST') {
    sessions.delete(token);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': 'flow_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0',
    });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // ── Scenario API ───────────────────────────────────────
  if (pathname === '/api/scenarios' && req.method === 'GET') {
    try {
      const names = await s3ListScenarios();
      sendJSON(res, 200, names);
    } catch (err) {
      console.error('S3 list error:', err.message);
      sendJSON(res, 500, { error: 'Failed to list scenarios' });
    }
    return;
  }

  if (pathname.startsWith('/api/scenarios/') && pathname.split('/').length === 4) {
    const name = decodeURIComponent(pathname.split('/')[3]);
    if (!name || name.includes('..') || name.includes('/')) {
      sendJSON(res, 400, { error: 'Invalid scenario name' });
      return;
    }

    if (req.method === 'GET') {
      try {
        const data = await s3GetScenario(name);
        if (!data) { sendJSON(res, 404, { error: 'Scenario not found' }); return; }
        sendJSON(res, 200, data);
      } catch (err) {
        console.error('S3 get error:', err.message);
        sendJSON(res, 500, { error: 'Failed to load scenario' });
      }
      return;
    }

    if (req.method === 'PUT') {
      try {
        const body = JSON.parse(await readBody(req));
        body.savedAt = Date.now();
        await s3PutScenario(name, body);
        sendJSON(res, 200, { ok: true });
      } catch (err) {
        console.error('S3 put error:', err.message);
        sendJSON(res, 500, { error: 'Failed to save scenario' });
      }
      return;
    }

    if (req.method === 'DELETE') {
      try {
        await s3DeleteScenario(name);
        sendJSON(res, 200, { ok: true });
      } catch (err) {
        console.error('S3 delete error:', err.message);
        sendJSON(res, 500, { error: 'Failed to delete scenario' });
      }
      return;
    }
  }

  // ── Static file server ─────────────────────────────────
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.join(__dirname, filePath);

  const ext = path.extname(filePath);
  const contentType = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

// ── WebSocket relay ───────────────────────────────────────
const wss = new WebSocketServer({ server });

const controllers = new Set();
const viewers = new Set();

wss.on('connection', (ws, req) => {
  // Check auth for WebSocket connections too
  const token = parseCookies(req.headers.cookie).flow_session;
  if (!isValidSession(token)) {
    ws.close(4001, 'Not authenticated');
    return;
  }

  let role = null;

  ws.on('message', (data, isBinary) => {
    // First JSON message should be registration
    if (!role && !isBinary) {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'register') {
          role = msg.role;
          if (role === 'controller') controllers.add(ws);
          else viewers.add(ws);
          console.log(`${role} connected (${viewers.size} viewers, ${controllers.size} controllers)`);
          return;
        }
      } catch (e) { /* not JSON, fall through */ }
    }

    // Controller messages → broadcast to all viewers
    if (role === 'controller') {
      for (const viewer of viewers) {
        if (viewer.readyState === 1) {
          viewer.send(data, { binary: isBinary });
        }
      }
    }

    // Viewer messages → relay to all controllers (e.g. water spray)
    if (role === 'viewer' && !isBinary) {
      for (const ctrl of controllers) {
        if (ctrl.readyState === 1) {
          ctrl.send(data, { binary: false });
        }
      }
    }
  });

  ws.on('close', () => {
    controllers.delete(ws);
    viewers.delete(ws);
    if (role) {
      console.log(`${role} disconnected (${viewers.size} viewers, ${controllers.size} controllers)`);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`  Controller: http://localhost:${PORT}/`);
  console.log(`  Simulator:  http://localhost:${PORT}/viewer.html`);
});
