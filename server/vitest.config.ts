import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The container runs as an unprivileged user that cannot write node_modules, so the caches live in the OS temp dir
  cacheDir: join(tmpdir(), 'musicbox-server-vite'),
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 20_000,
    fsModuleCachePath: join(tmpdir(), 'musicbox-server-vitest'),
  },
});
