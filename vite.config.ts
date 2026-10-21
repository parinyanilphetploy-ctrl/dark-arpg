import { defineConfig } from "vite";

export default defineConfig({
  // ./ so the build works from any static host sub-path (GitHub Pages etc.)
  base: "./",
  server: {
    // Expose on the LAN so phones on the same Wi-Fi can open the dev server
    host: true,
    port: 5173,
    watch: {
      // Reference art isn't part of the build; watching big files mid-copy crashed the server (EBUSY)
      ignored: ["**/character sheet/**"],
    },
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1500,
  },
});
