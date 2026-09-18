import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket, WebSocketServer } from 'ws';
import { RobotConnection } from '../shared/connection.mjs';
import { defaults } from '../shared/robot.mjs';

const waitFor = async (fn) => {
  const end = Date.now() + 2500;
  while (Date.now() < end) {
    if (fn()) return;
    await new Promise(r => setTimeout(r, 10));
  }
  assert.fail('Condition timed out');
};
const state = () => ({v:1, type:'state', armed:false, hardwareReady:true, fault:'', mode:'manual',
  active:[], angles:Array(16).fill(90), targets:Array(16).fill(90), rssi:0, uptime:100, configRevision:0});
async function setup(t, respond = true, timeout = 6000) {
  const server = new WebSocketServer({host:'127.0.0.1', port:0});
  await once(server, 'listening');
  const messages = [], requests = [], peers = [];
  server.on('connection', (ws, request) => {
    peers.push(ws); requests.push(request);
    ws.on('message', bytes => {
      const m = JSON.parse(bytes); messages.push(m);
      if (respond && m.type === 'getConfig') {
        ws.send(JSON.stringify({v:1,type:'config',config:defaults()}));
        ws.send(JSON.stringify(state()));
      }
    });
  });
  const client = new RobotConnection(() => {}, {WebSocketImpl:WebSocket,
    url:`ws://127.0.0.1:${server.address().port}/`, timeout});
  t.after(async () => {
    client.disconnect();
    for (const ws of server.clients) ws.terminate();
    await new Promise(r => server.close(r));
  });
  client.connect();
  return {client, messages, requests, peers};
}
test('direct connection loads config/telemetry without cookies or token, sends commands, disarms and reconnects without replay', async t => {
  const {client,messages,requests} = await setup(t);
  await waitFor(() => client.snapshot.online && !client.snapshot.connecting);
  assert.equal(requests[0].url, '/');
  assert.equal(requests[0].headers.authorization, undefined);
  assert.equal(requests[0].headers.cookie, undefined);
  assert.equal(client.snapshot.config.servos.length, 16);
  assert.equal(client.send('servo', {channel:99, angle:90}), false);
  assert.equal(client.send('servo', {channel:2, angle:115}), true);
  client.tick();
  await waitFor(() => messages.some(m => m.type === 'servo' && m.angle === 115));
  client.disconnect();
  await waitFor(() => messages.some(m => m.type === 'disarm'));
  assert.equal(client.snapshot.state, null);
  const prior = messages.length;
  client.connect();
  await waitFor(() => client.snapshot.online);
  assert.ok(messages.slice(prior).every(m => !['arm','drive','servo'].includes(m.type)));
});
test('stale telemetry clears motion state and sends disarm', async t => {
  const {client,messages} = await setup(t);
  await waitFor(() => client.snapshot.online);
  client.lastState = Date.now() - 1600;
  client.tick();
  assert.equal(client.snapshot.online, false);
  assert.equal(client.snapshot.state, null);
  await waitFor(() => messages.some(m => m.type === 'disarm'));
});
test('silent endpoint times out with actionable Wi-Fi instructions', async t => {
  const {client} = await setup(t, false, 100);
  await waitFor(() => !client.snapshot.connecting);
  assert.equal(client.snapshot.connected, false);
  assert.match(client.snapshot.message, /No response.*SpiderBot Wi-Fi/);
});
test('malformed telemetry clears the connection', async t => {
  const {client,peers} = await setup(t);
  await waitFor(() => client.snapshot.online);
  peers[0].send('{"v":1,"type":"state","angles":[999]}');
  await waitFor(() => !client.snapshot.connected);
  assert.match(client.snapshot.message, /Invalid robot response/);
});
test('another-controller rejection remains visible after close', async t => {
  const {client,peers} = await setup(t, false);
  await waitFor(() => peers.length > 0);
  peers[0].send(JSON.stringify({v:1,type:'error',message:'Robot already connected in another tab. Disconnect it first.'}));
  peers[0].close();
  await waitFor(() => !client.snapshot.connecting);
  assert.match(client.snapshot.message, /another tab/);
});
