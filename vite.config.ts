import { defineConfig } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";

// HTTPS is required for DeviceOrientation (gyro) on mobile browsers.
export default defineConfig({
  base: "./",
  plugins: [basicSsl()],
  server: { host: true },
  preview: { host: true },
  build: { target: "es2022", chunkSizeWarningLimit: 4096 },
});
