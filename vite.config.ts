/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  css: {
    transformer: "postcss",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          "vendor-charts": ["recharts"],
          "vendor-qrcode": ["html5-qrcode"],
          "vendor-barcode": ["jsbarcode", "html2canvas"],
          "vendor-ui": ["@radix-ui/react-avatar", "@radix-ui/react-checkbox", "@radix-ui/react-dropdown-menu", "@radix-ui/react-separator", "@radix-ui/react-tabs", "@radix-ui/react-toast", "cmdk", "lucide-react"],
          "vendor-forms": ["zod"],
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/setupTests.ts"],
    exclude: ["node_modules", "tests", "backend"],
  },
  server: {
    port: 5174,
  },
});
