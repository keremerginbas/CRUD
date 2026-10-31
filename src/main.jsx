import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import { SeedProvider } from "./lib/seed.jsx";
import { LenisProvider } from "./lib/lenis.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <SeedProvider>
      <LenisProvider>
        <App />
      </LenisProvider>
    </SeedProvider>
  </StrictMode>
);
