const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;

const MIME = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
};

// ── Static file server ────────────────────────────────────
const server = http.createServer((req, res) => {
  let filePath = req.url === '/' ? '/index.html' : req.url;
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

wss.on('connection', (ws) => {
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
