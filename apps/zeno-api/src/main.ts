import { z } from "zod";
import { createApp } from "./app";
import { dirname, join } from "node:path";
import { createOperatorResolver, setOperatorFeature } from "./operator";

const env = z.object({ ZENO_DATABASE_PATH: z.string().min(1), ZENO_MEDIA_ROOT: z.string().min(1), ZENO_PUBLIC_ORIGIN: z.url(), ZENO_AUTH_SECRET: z.string().min(32), ZENO_API_PORT: z.coerce.number().int().min(1).max(65535).default(8790) }).parse(process.env);
const operatorPath = process.env.ZENO_OPERATOR_PROFILE ?? join(dirname(env.ZENO_DATABASE_PATH), "operator-profile.json");
const app = createApp({ databasePath: env.ZENO_DATABASE_PATH, mediaRoot: env.ZENO_MEDIA_ROOT, origin: env.ZENO_PUBLIC_ORIGIN, authSecret: env.ZENO_AUTH_SECRET, featureEnabled: createOperatorResolver(operatorPath), setFeature: (key, enabled) => { setOperatorFeature(operatorPath, key, String(enabled)); } });
const server = Bun.serve({ hostname: "127.0.0.1", port: env.ZENO_API_PORT, maxRequestBodySize: 52 * 1024 * 1024, fetch(request, server) {
  // Bound to loopback. Nginx MUST overwrite this header, never append it.
  const peer = request.headers.get("x-real-ip") ?? server.requestIP(request)?.address ?? "local";
  return app.fetch(request, peer);
} });
console.info(`Zeno data API listening on loopback port ${server.port}; AI execution is local only.`);
let stopped = false;
const stop = async () => { if (stopped) return; stopped = true; await server.stop(); app.close(); };
process.on("SIGINT", () => void stop()); process.on("SIGTERM", () => void stop());
