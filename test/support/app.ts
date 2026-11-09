import { buildApp, type App } from '../../src/app.js';
import { createContainer, type Container } from '../../src/container.js';
import { loadConfig, type AppConfig } from '../../src/shared/config.js';

export const TEST_WEBHOOK_SECRET = 'test-webhook-secret-000001';
export const TEST_ADMIN = { email: 'admin@test.local', password: 'admin-password-01' };

export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  return loadConfig({
    DATA_SOURCE: 'memory',
    WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
    ADMIN_EMAIL: TEST_ADMIN.email,
    ADMIN_PASSWORD: TEST_ADMIN.password,
    DEBUG_HEADERS: 'true',
    ...overrides,
  });
}

export interface TestApp {
  app: App;
  container: Container;
  close(): Promise<void>;
}

/** Full application (all hooks, global error handler) on the chosen data source. */
export async function createTestApp(overrides: Record<string, string> = {}): Promise<TestApp> {
  const container = await createContainer(testConfig(overrides));
  const app = buildApp(container);
  await app.ready();
  return {
    app,
    container,
    close: async (): Promise<void> => {
      await app.close();
      await container.close();
    },
  };
}
