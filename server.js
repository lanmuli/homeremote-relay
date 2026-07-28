'use strict';

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 8787);
const controllerDir = __dirname;
const rooms = new Map();

function sendFrame(socket, payload) {
  const data = Buffer.from(payload);
  const header = data.length < 126
    ? Buffer.from([0x81, data.length])
    : data.length < 65536
      ? Buffer.from([0x81, 126, data.length >> 8, data.length & 255])
      : Buffer.from([0x81, 127, 0, 0, 0, 0, data.length / 0x1000000 & 255, data.length / 0x10000 & 255, data.length / 0x100 & 255, data.length & 255]);
  socket.write(Buffer.concat([header, data]));
}

function parseFrames(state, chunk, onText) {
  state.buffer = Buffer.concat([state.buffer, chunk]);
  while (state.buffer.length >= 2) {
    const b0 = state.buffer[0], b1 = state.buffer[1];
    const opcode = b0 & 15;
    let length = b1 & 127, offset = 2;
    if (length === 126) {
      if (state.buffer.length < 4) return;
      length = state.buffer.readUInt16BE(2); offset = 4;
    } else if (length === 127) {
      if (state.buffer.length < 10) return;
      const high = state.buffer.readUInt32BE(2);
      if (high !== 0) throw new Error('Frame too large');
      length = state.buffer.readUInt32BE(6); offset = 10;
    }
    const masked = Boolean(b1 & 128);
    const maskOffset = offset;
    if (masked) offset += 4;
    if (state.buffer.length < offset + length) return;
    const data = Buffer.from(state.buffer.subarray(offset, offset + length));
    if (masked) for (let i = 0; i < data.length; i++) data[i] ^= state.buffer[maskOffset + (i % 4)];
    state.buffer = state.buffer.subarray(offset + length);
    if (opcode === 8) return state.socket.end();
    if (opcode === 1) onText(data.toString('utf8'));
  }
}

function removePeer(peer) {
  if (!peer.room) return;
  const room = rooms.get(peer.room);
  if (!room) return;
  room.delete(peer);
  if (!room.size) rooms.delete(peer.room);
}

const server = http.createServer((req, res) => {
  const requested = req.url === '/' ? 'index.html' : req.url.slice(1).split('?')[0];
  const safe = path.normalize(requested).replace(/^(\.\.[/\\])+/, '');
  const file = path.join(controllerDir, safe);
  if (!file.startsWith(controllerDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('Not found');
  }
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});

server.on('upgrade', (req, socket) => {
  if (req.url !== '/ws') return socket.destroy();
  const key = req.headers['sec-websocket-key'];
  if (!key) return socket.destroy();
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  const peer = { socket, room: null, role: null, buffer: Buffer.alloc(0) };
  socket.on('data', chunk => {
    try {
      parseFrames(peer, chunk, text => {
        if (text.length > 8 * 1024 * 1024) return socket.destroy();
        let msg; try { msg = JSON.parse(text); } catch { return; }
        if (!peer.room) {
          if (msg.type !== 'join' || !/^[A-Za-z0-9_-]{4,64}$/.test(msg.room) || !['host', 'controller'].includes(msg.role)) return socket.destroy();
          peer.room = msg.room; peer.role = msg.role;
          if (!rooms.has(peer.room)) rooms.set(peer.room, new Set());
          rooms.get(peer.room).add(peer);
          return sendFrame(socket, JSON.stringify({ type: 'joined' }));
        }
        for (const other of rooms.get(peer.room) || []) {
          if (other !== peer && other.role !== peer.role && !other.socket.destroyed) sendFrame(other.socket, text);
        }
      });
    } catch { socket.destroy(); }
  });
  socket.on('close', () => removePeer(peer));
  socket.on('error', () => removePeer(peer));
});

server.listen(port, host, () => console.log(`HomeRemote relay listening on http://${host}:${port}`));
