import path from "node:path";
import type { Server } from "node:http";
import type { Express } from "express";

/** Preview terminates TLS; WebSocket upgrades must use the same HTTP listener. */
export async function attachDevelopmentServer(
  app: Express,
  httpServer: Server,
  projectRoot: string,
) {
  const { createServer } = await import("vite");
  const vite = await createServer({
    root: path.join(projectRoot, "client"),
    publicDir: path.join(projectRoot, "public"),
    configFile: path.join(projectRoot, "vite.config.ts"),
    server: {
      middlewareMode: true,
      hmr: {
        server: httpServer,
        // HTTPS Preview uses the browser origin's public TLS port, not 24678.
        clientPort: 443,
        path: "/__vite_hmr",
      },
    },
    appType: "spa",
  });
  app.use(vite.middlewares);
  return vite;
}
