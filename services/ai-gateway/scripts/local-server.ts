/**
 * Runs the AI routes on this machine so the extension can be tried from
 * `npx vite` without deploying the AiHandler Lambda. It calls the same
 * `handler` the Lambda exports, so Bedrock, Polly, and Transcribe are real and
 * use your local AWS credentials:
 *
 *   CAPABILITY_SECRET=<relay's signing secret> AWS_PROFILE=hackathon \
 *     npx tsx services/ai-gateway/scripts/local-server.ts [port]
 *
 * The secret must be the deployed relay's, from Secrets Manager, so that the
 * capabilities the relay issues verify here. Then set
 * VITE_ACCESSLENS_AI_URL=http://localhost:8787 in .env.local.
 *
 * Listens on 127.0.0.1 only and logs nothing beyond the handler's own
 * allowlisted fields. For local testing, not for serving a class.
 */
import { createServer } from 'node:http';
import { buildChatHandler } from '../src/chatHandler.js';
import { handler } from '../src/handler.js';

const port = Number(process.argv[2] ?? 8787);
/** Large enough for a Whisper clip; each route enforces its own, smaller limit. */
const MAX_REQUEST_BYTES = 600_000;
let chat: ReturnType<typeof buildChatHandler> | undefined;

if (!process.env.CAPABILITY_SECRET) {
  console.error('CAPABILITY_SECRET is not set. Use the deployed relay\'s secret so its capabilities verify.');
  process.exit(2);
}

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

createServer((request, response) => {
  if (request.method === 'OPTIONS') {
    response.writeHead(204, cors).end();
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  request.on('data', (chunk: Buffer) => {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) {
      response.writeHead(413, { ...cors, 'content-type': 'application/json' }).end('{"error":"too-large"}');
      request.destroy();
      return;
    }
    chunks.push(chunk);
  });
  request.on('end', () => {
    if (response.headersSent) return;
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    const body = Buffer.concat(chunks).toString('utf8');
    if (path === '/chat') {
      // The study chat streams: the same handler the Function URL runs, writing
      // each JSON line as it is produced.
      chat ??= buildChatHandler();
      chat.then(handle => handle({ body, requestContext: { http: { method: request.method } } }, {
        start: status => { response.writeHead(status, { ...cors, 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' }); },
        write: line => { response.write(line); },
        end: () => { response.end(); },
      })).catch(() => {
        if (!response.headersSent) response.writeHead(500, { ...cors, 'content-type': 'application/json' });
        response.end('{"type":"error","reason":"chat-unavailable"}\n');
      });
      return;
    }
    handler({
      rawPath: path,
      requestContext: { http: { method: request.method, path } },
      body,
    }).then(
      (result) => response.writeHead(result.statusCode, { ...result.headers, ...cors }).end(result.body),
      () => response.writeHead(500, { ...cors, 'content-type': 'application/json' }).end('{"error":"internal"}'),
    );
  });
}).listen(port, '127.0.0.1', () => {
  console.log(`AI routes on http://localhost:${port} (POST /ask, /speak, /transcribe-url, /transcribe-chunk, /chat)`);
});
