import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: { host: "acme.lvh.me", port: 5173, proxy: { "/api": "http://acme.lvh.me:3000" } },
});
