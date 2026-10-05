'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { io: createClient } = require('socket.io-client');
const { server, resetCeremony } = require('../server');

let port;
test.before(async () => { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); port = server.address().port; });
test.after(async () => { await new Promise(resolve => server.close(resolve)); });
test.beforeEach(() => resetCeremony());

function connect(role) { return new Promise(resolve => { const socket = createClient(`http://127.0.0.1:${port}`, { transports: ['websocket'] }); socket.on('connect', () => { socket.emit('role:register', role); resolve(socket); }); }); }

test('simultaneous guest holds launch one synchronized timeline for all devices', async () => {
  const sockets = await Promise.all(['guest-1','guest-2','guest-3','guest-4','display'].map(connect));
  const launches = sockets.map(socket => new Promise(resolve => socket.once('launch:countdown', resolve)));
  sockets[0].emit('hand:ready', { slot: '1' });
  sockets[1].emit('hand:ready', { slot: '2' });
  sockets[2].emit('hand:ready', { slot: '3' });
  sockets[3].emit('hand:ready', { slot: '4' });
  const states = await Promise.all(launches);
  assert.equal(new Set(states.map(s => s.countdownAt)).size, 1);
  assert.equal(new Set(states.map(s => s.revealAt)).size, 1);
  assert.ok(states.every(s => Object.values(s.ready).every(Boolean)));
  sockets.forEach(socket => socket.close());
});

test('a disconnected guest is reported without losing its ready state', async () => {
  const guest = await connect('guest-1'); const display = await connect('display');
  guest.emit('hand:ready', { slot: '1' });
  await new Promise(resolve => setTimeout(resolve, 30));
  const update = new Promise(resolve => display.on('ceremony:state', s => { if (s.ready['1'] && !s.connected['1']) resolve(s); }));
  guest.close(); const state = await update;
  assert.equal(state.ready['1'], true); assert.equal(state.connected['1'], false);
  display.close();
});

test('live hold progress is relayed to the main display', async () => {
  const guest = await connect('guest-2'); const display = await connect('display');
  const update = new Promise(resolve => display.once('hand:progress', resolve));
  guest.emit('hand:progress', { slot: '2', progress: 0.48 });
  const progress = await update;
  assert.equal(progress.slot, '2'); assert.equal(progress.progress, 0.48);
  guest.close(); display.close();
});

test('a continuous two-second hold is authoritatively verified by the server', async () => {
  const guest = await connect('guest-1'); const display = await connect('display');
  const verified = new Promise(resolve => display.on('ceremony:state', state => { if (state.ready['1']) resolve(state); }));
  guest.emit('hand:hold-start', { slot: '1' });
  const state = await verified;
  assert.equal(state.ready['1'], true);
  guest.close(); display.close();
});
