import express from 'express';

// Placeholder entry point; the WebSocket sync server lands in #4.
const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? '0.0.0.0';

const app = express();
app.get('/healthz', (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, HOST, () => console.log(`Sub50 server listening on ${HOST}:${PORT}`));
