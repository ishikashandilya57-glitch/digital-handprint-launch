'use strict';

const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { serveClient: true });

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const HOLD_DURATION_MS = 750;
const COUNTDOWN_LEAD_MS = 1800;
const COUNTDOWN_DURATION_MS = 5000;
const validSlots = new Set(['1', '2', '3', '4']);

let ceremony = freshCeremony();

function freshCeremony() {
  return {
    phase: 'waiting',
    ready: { '1': false, '2': false, '3': false, '4': false },
    progress: { '1': 0, '2': 0, '3': 0, '4': 0 },
    connected: { '1': false, '2': false, '3': false, '4': false },
    countdownAt: null,
    revealAt: null
  };
}

function publicState() {
  return { ...ceremony, serverNow: Date.now() };
}

function updateConnections() {
  for (const slot of validSlots) {
    ceremony.connected[slot] = [...io.sockets.sockets.values()].some(
      (socket) => socket.data.role === `guest-${slot}`
    );
  }
}

function broadcastState() {
  updateConnections();
  io.emit('ceremony:state', publicState());
}

function resetCeremony() {
  for (const socket of io.sockets.sockets.values()) {
    clearTimeout(socket.data.holdTimer);
    socket.data.holdTimer = null;
    socket.data.holdSlot = null;
  }
  ceremony = freshCeremony();
  io.emit('ceremony:reset', publicState());
  broadcastState();
}

app.use(express.json());
app.use((req, res, next) => {
  if (req.path === '/' || req.path.endsWith('.html') || req.path.endsWith('.js')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true, phase: ceremony.phase }));
app.all('/reset', (_req, res) => {
  resetCeremony();
  res.json({ ok: true, message: 'Ceremony reset on every connected device.' });
});

io.on('connection', (socket) => {
  socket.emit('ceremony:state', publicState());

  function markHandReady(slot) {
    const normalizedSlot = String(slot);
    if (!validSlots.has(normalizedSlot) || socket.data.role !== `guest-${normalizedSlot}`) return;
    if (ceremony.phase !== 'waiting' || ceremony.ready[normalizedSlot]) return;

    ceremony.ready[normalizedSlot] = true;
    ceremony.progress[normalizedSlot] = 1;
    io.emit('hand:ready', { slot: normalizedSlot });
    io.emit('hand:progress', { slot: normalizedSlot, progress: 1 });
    broadcastState();

    if (Object.values(ceremony.ready).every(Boolean)) {
      const now = Date.now();
      ceremony.phase = 'countdown';
      ceremony.countdownAt = now + COUNTDOWN_LEAD_MS;
      ceremony.revealAt = ceremony.countdownAt + COUNTDOWN_DURATION_MS;
      io.emit('launch:countdown', publicState());
      broadcastState();
    }
  }

  socket.on('role:register', (role) => {
    if (!['guest-1', 'guest-2', 'guest-3', 'guest-4', 'display'].includes(role)) return;
    socket.data.role = role;
    // Preserve a completed scan across a transient Wi-Fi reconnect/refresh.
    // Only clear incomplete progress when this slot registers again.
    if (role.startsWith('guest-') && ceremony.phase === 'waiting') {
      const slot = role.slice(-1);
      if (!ceremony.ready[slot]) ceremony.progress[slot] = 0;
      clearTimeout(socket.data.holdTimer);
      socket.data.holdTimer = null;
      socket.data.holdSlot = null;
      socket.data.holdStartedAt = 0;
    }
    broadcastState();
  });

  socket.on('hand:ready', ({ slot } = {}) => {
    markHandReady(slot);
  });

  socket.on('hand:hold-start', ({ slot } = {}) => {
    const normalizedSlot = String(slot);
    if (!validSlots.has(normalizedSlot) || socket.data.role !== `guest-${normalizedSlot}`) return;
    if (ceremony.phase !== 'waiting' || ceremony.ready[normalizedSlot]) return;
    clearTimeout(socket.data.holdTimer);
    socket.data.holdSlot = normalizedSlot;
    socket.data.holdStartedAt = Date.now();
    ceremony.progress[normalizedSlot] = 0.01;
    broadcastState();
    socket.data.holdTimer = setTimeout(() => {
      socket.data.holdTimer = null;
      markHandReady(normalizedSlot);
    }, HOLD_DURATION_MS);
  });

  socket.on('hand:hold-stop', ({ slot } = {}) => {
    if (String(slot) !== socket.data.holdSlot) return;
    const elapsed = Date.now() - (socket.data.holdStartedAt || 0);
    // A lift right at the completion edge can arrive before the timer callback.
    // Treat a nearly-complete hold as successful instead of cancelling it.
    if (elapsed >= HOLD_DURATION_MS - 120 || ceremony.progress[String(slot)] >= 0.9) {
      clearTimeout(socket.data.holdTimer);
      socket.data.holdTimer = null;
      socket.data.holdSlot = null;
      socket.data.holdStartedAt = 0;
      markHandReady(String(slot));
      return;
    }
    clearTimeout(socket.data.holdTimer);
    socket.data.holdTimer = null;
    socket.data.holdSlot = null;
    socket.data.holdStartedAt = 0;
    ceremony.progress[String(slot)] = 0;
    broadcastState();
  });

  socket.on('admin:emergency-start', () => {
    if (socket.data.role !== 'display' || ceremony.phase !== 'waiting') return;
    ceremony.ready = { '1': true, '2': true, '3': true, '4': true };
    ceremony.progress = { '1': 1, '2': 1, '3': 1, '4': 1 };
    io.emit('hand:progress', { slot: '1', progress: 1 });
    io.emit('hand:progress', { slot: '2', progress: 1 });
    io.emit('hand:progress', { slot: '3', progress: 1 });
    io.emit('hand:progress', { slot: '4', progress: 1 });
    broadcastState();
    const now = Date.now();
    ceremony.phase = 'countdown';
    ceremony.countdownAt = now + COUNTDOWN_LEAD_MS;
    ceremony.revealAt = ceremony.countdownAt + COUNTDOWN_DURATION_MS;
    io.emit('launch:countdown', publicState());
    broadcastState();
  });

  socket.on('hand:progress', ({ slot, progress } = {}) => {
    const normalizedSlot = String(slot);
    const normalizedProgress = Math.max(0, Math.min(1, Number(progress) || 0));
    if (!validSlots.has(normalizedSlot) || socket.data.role !== `guest-${normalizedSlot}`) return;
    if (ceremony.phase !== 'waiting' || ceremony.ready[normalizedSlot]) return;
    ceremony.progress[normalizedSlot] = normalizedProgress;
    socket.broadcast.emit('hand:progress', { slot: normalizedSlot, progress: normalizedProgress });
    broadcastState();
  });

  socket.on('admin:reset', () => {
    if (socket.data.role === 'display') resetCeremony();
  });

  socket.on('disconnect', () => {
    clearTimeout(socket.data.holdTimer);
    const disconnectedSlot = socket.data.role?.startsWith('guest-') ? socket.data.role.slice(-1) : null;
    if (disconnectedSlot && !ceremony.ready[disconnectedSlot]) ceremony.progress[disconnectedSlot] = 0;
    broadcastState();
  });
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`Digital Handprint Launch running at http://localhost:${PORT}`);
  });
}

module.exports = { app, server, io, resetCeremony };
