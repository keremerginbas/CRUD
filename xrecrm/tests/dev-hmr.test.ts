import { it, expect } from "vitest";
import express from "express";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { attachDevelopmentServer } from "../server/development";

it("Preview HMR aynı HTTP sunucusunda bağlanır; erişilemeyen 24678 portu kullanılmaz", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "xre-hmr-test-"));
  await mkdir(path.join(root, "client"));
  await mkdir(path.join(root, "public"));
  await writeFile(
    path.join(root, "client/index.html"),
    "<!doctype html><h1>HMR fixture</h1>",
  );
  await writeFile(
    path.join(root, "vite.config.ts"),
    "export default {server:{allowedHosts:true}};",
  );
  const app = express();
  const http = createServer(app);
  let vite: Awaited<ReturnType<typeof attachDevelopmentServer>> | undefined;
  try {
    vite = await attachDevelopmentServer(app, http, root);
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    const address = http.address() as { port: number };
    const origin = `http://127.0.0.1:${address.port}`;
    const client = await (await fetch(`${origin}/@vite/client`)).text();
    expect(client).toContain("const hmrPort = 443;");
    expect(client).toContain("/__vite_hmr");
    expect(client).not.toContain("const hmrPort = 24678;");
    const token = client.match(/const wsToken = "([^"]+)"/)?.[1];
    expect(token).toBeTruthy();
    const connected = await new Promise<string>((resolve, reject) => {
      const socket = new WebSocket(
        `${origin.replace("http:", "ws:")}/__vite_hmr?token=${encodeURIComponent(token!)}`,
        "vite-hmr",
      );
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error("HMR zaman aşımı"));
      }, 5000);
      socket.addEventListener("message", (event) => {
        const data = JSON.parse(String(event.data));
        if (data.type === "connected") {
          clearTimeout(timer);
          socket.close();
          resolve(data.type);
        }
      });
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("HMR handshake başarısız"));
      });
    });
    expect(connected).toBe("connected");
  } finally {
    await vite?.close();
    http.closeAllConnections();
    await new Promise<void>((resolve) => http.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
}, 15000);
