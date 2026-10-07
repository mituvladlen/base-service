import express from 'express';
import request from 'supertest';
import { concurrencyLimit, requestTimeout, simulatedLatency } from '../src/middleware/limits';

describe('requestTimeout', () => {
  it('returns 408 when the handler is too slow', async () => {
    const app = express();
    app.use(requestTimeout(50));
    app.get('/slow', (_req, res) => {
      setTimeout(() => res.json({ ok: true }), 150);
    });
    const r = await request(app).get('/slow');
    expect(r.status).toBe(408);
    expect(r.body).toEqual({ error: 'REQUEST_TIMEOUT', message: expect.any(String) });
    await new Promise((done) => setTimeout(done, 150)); // late handler must not throw
  });

  it('lets fast requests through', async () => {
    const app = express();
    app.use(requestTimeout(200));
    app.get('/fast', (_req, res) => res.json({ ok: true }));
    const r = await request(app).get('/fast');
    expect(r.status).toBe(200);
  });
});

describe('concurrencyLimit', () => {
  function holdingApp(max: number) {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const app = express();
    app.use(concurrencyLimit(max));
    app.get('/hold', async (_req, res) => {
      await gate;
      res.json({ ok: true });
    });
    return { server: app.listen(0), release: () => release() };
  }

  it('rejects requests over the limit with 429', async () => {
    const { server, release } = holdingApp(1);
    const first = request(server).get('/hold').then((r) => r);
    await new Promise((r) => setTimeout(r, 30));

    const second = await request(server).get('/hold');
    expect(second.status).toBe(429);
    expect(second.body).toEqual({ error: 'TOO_MANY_REQUESTS', message: expect.any(String) });

    release();
    expect((await first).status).toBe(200);
    server.close();
  });

  it('frees the slot after a request finishes', async () => {
    const { server, release } = holdingApp(1);
    release();
    expect((await request(server).get('/hold')).status).toBe(200);
    expect((await request(server).get('/hold')).status).toBe(200);
    server.close();
  });
});

describe('simulatedLatency', () => {
  it('delays requests so the timeout can fire (demo)', async () => {
    const app = express();
    app.use(requestTimeout(30));
    app.use(simulatedLatency(80));
    app.get('/x', (_req, res) => res.json({ ok: true }));
    expect((await request(app).get('/x')).status).toBe(408);
    await new Promise((done) => setTimeout(done, 80));
  });

  it('does nothing when 0', async () => {
    const app = express();
    app.use(simulatedLatency(0));
    app.get('/x', (_req, res) => res.json({ ok: true }));
    expect((await request(app).get('/x')).status).toBe(200);
  });
});
