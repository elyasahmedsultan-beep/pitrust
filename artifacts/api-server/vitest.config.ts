import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/routes/pi-payment-flow.mock.test.ts"],
    clearMocks: true,
    restoreMocks: true,
  },
});