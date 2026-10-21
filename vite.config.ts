import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

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
  preview: {
    host: true,
    port: 4173,
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1500,
  },
  plugins: [
    VitePWA({
      // New builds install in the background and take over on the next launch
      registerType: "autoUpdate",
      injectRegister: false,
      includeAssets: ["icons/apple-touch-icon.png", "icons/favicon-32.png"],
      manifest: {
        name: "Dark ARPG",
        short_name: "Dark ARPG",
        description: "Gothic dungeon-crawling action RPG",
        start_url: "./",
        scope: "./",
        display: "fullscreen",
        display_override: ["fullscreen", "standalone"],
        orientation: "any",
        background_color: "#0b0907",
        theme_color: "#0b0907",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          // The design keeps everything inside the 80% safe zone, so it doubles as maskable
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Precache everything the game needs to run offline, models included
        globPatterns: ["**/*.{js,css,html,png,glb,wasm,webmanifest}"],
        // The navmesh WASM bundle is ~730 KB unminified-size; allow it
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});
