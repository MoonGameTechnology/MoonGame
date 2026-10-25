import https from 'node:https';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const seen = new Map();
const server = https.createServer(
  { key: readFileSync('/probe/backend.key'), cert: readFileSync('/probe/backend.crt') },
  async (req, res) => {
    const id = req.headers['x-probe-id'];
    if (typeof id === 'string') seen.set(id, (seen.get(id) ?? 0) + 1);
    if (req.url === '/stats') {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify(Object.fromEntries(seen)));
    }
    let bytes = 0;
    for await (const part of req) {
      bytes += part.length;
      if (bytes > 2 * 1024 * 1024) return res.writeHead(413).end();
    }
    if (req.url === '/large') {
      res.setHeader('Content-Type', 'application/octet-stream');
      for (let i = 0; i < 128; i++) res.write(Buffer.alloc(16384, 65));
      return res.end();
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, bytes }));
  },
);
server.on('upgrade', (req, socket) => {
  if (req.url !== '/ws' || !req.headers['sec-websocket-key']) return socket.destroy();
  const accept = createHash('sha1')
    .update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' +
      accept +
      '\r\n\r\n',
  );
  let input = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    input = Buffer.concat([input, chunk]);
    if (input.length > 65536) return socket.destroy();
    while (input.length >= 6) {
      const opcode = input[0] & 15;
      let n = input[1] & 127;
      let offset = 2;
      if (!(input[1] & 128) || n === 127) return socket.destroy();
      if (n === 126) {
        if (input.length < 8) return;
        n = input.readUInt16BE(2);
        offset = 4;
      }
      if (input.length < offset + 4 + n) return;
      const mask = input.subarray(offset, offset + 4);
      const data = Buffer.from(input.subarray(offset + 4, offset + 4 + n));
      for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4];
      input = input.subarray(offset + 4 + n);
      if (opcode === 8) return socket.end(Buffer.from([0x88, 0]));
      const header =
        data.length < 126
          ? Buffer.from([opcode === 9 ? 0x8a : 0x81, data.length])
          : Buffer.from([0x81, 126, data.length >> 8, data.length & 255]);
      socket.write(Buffer.concat([header, data]));
    }
  });
  socket.on('error', () => {});
});
server.listen(8081, '0.0.0.0');
