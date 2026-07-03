import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  server: {
    host: "127.0.0.1",
    port: 58888,
    // Explicit HMR config — Firefox sometimes fails to connect when
    // the browser accesses via "localhost" but Vite binds to "127.0.0.1".
    hmr: {
      protocol: "ws",
      host: "127.0.0.1",
      port: 58888,
    },
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
        configure: (proxy) => {
          proxy.on("error", (err) => {
            // Suppress ECONNREFUSED noise during API startup — the frontend
            // polls every 8-15s and will retry when the API is ready.
            if ((err as any).code === "ECONNREFUSED") return;
            console.log("[vite] proxy error:", (err as any).message);
          });
        },
      },
      "/ws": {
        target: "ws://127.0.0.1:8000",
        ws: true,
        changeOrigin: true,
      },
    },
  },
  base: "./", // Electron file:// 协议需要相对路径
  build: {
    outDir: "dist",
  },
});
