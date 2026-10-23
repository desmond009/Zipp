import type { ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import type { LiveClick } from '../domain/click-event.js';
import type { LiveClickHub } from '../services/live-click-hub.js';
import type { StatsService } from '../services/stats.service.js';

const HEARTBEAT_MS = 25_000;

/*
 * Live clicks over Server-Sent Events (SSE).
 *
 * SSE rather than WebSockets: data only flows server -> browser, it's plain
 * HTTP (works through proxies, uses the session cookie as-is), and the
 * browser's EventSource reconnects automatically.
 */
export function liveRoutes(app: FastifyInstance, statsService: StatsService, hub: LiveClickHub): void {
  const openStreams = new Set<ServerResponse>();

  // An open stream never "finishes", so app.close() would wait on it forever.
  // End them all first so graceful shutdown can complete; browsers reconnect
  // to another instance on their own.
  app.addHook('preClose', async () => {
    for (const stream of openStreams) {
      stream.end();
    }
  });

  app.get<{ Params: { code: string } }>('/api/links/:code/live', async (request, reply) => {
    const { code } = request.params;
    const send = (click: LiveClick) => reply.raw.write(`data: ${JSON.stringify(click)}\n\n`);

    // Everything that can fail (access check, history, subscribe) happens
    // before we take over the response, so errors still go through the
    // normal error handler as proper 403/404/500 responses.
    const recent = await statsService.getRecentClicks(code, request.user);
    const unsubscribe = await hub.subscribe(code, send);

    // From here we write the raw HTTP response ourselves. Nothing above can
    // deliver a message before this runs: Redis messages arrive on a later
    // event-loop turn, and this code continues synchronously after the await.
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // tell nginx not to buffer the stream
    });
    reply.raw.write('retry: 5000\n\n'); // reconnect delay for EventSource
    recent.forEach(send);
    openStreams.add(reply.raw);

    // Proxies and load balancers drop connections that look idle; a comment
    // line every 25s keeps it open without the browser seeing an event.
    const heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), HEARTBEAT_MS);

    request.raw.on('close', () => {
      clearInterval(heartbeat);
      openStreams.delete(reply.raw);
      unsubscribe().catch((error: unknown) => request.log.warn({ err: error }, 'Failed to unsubscribe live stream'));
    });
  });
}
