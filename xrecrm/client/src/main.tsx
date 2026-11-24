import "./workspace/preview-setup";
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./workspace/App";
// Sunucu güncellendikten sonra açık kalan sekme eski sayfa dosyalarını ister ve sayfa açılmaz.
// Böyle bir yükleme hatasında arayüz bir kez kendini yeniler (10 saniyede en çok bir kez).
const reloadForNewVersion = () => {
  try {
    const last = Number(sessionStorage.getItem("xre-reloaded-at") || 0);
    if (Date.now() - last < 10_000) return;
    sessionStorage.setItem("xre-reloaded-at", String(Date.now()));
  } catch {
    return;
  }
  location.reload();
};
window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault();
  reloadForNewVersion();
});
window.addEventListener("unhandledrejection", (event) => {
  const message = String((event.reason as Error)?.message || event.reason || "");
  if (/dynamically imported module|Importing a module script failed|error loading dynamically imported/i.test(message)) reloadForNewVersion();
});
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
