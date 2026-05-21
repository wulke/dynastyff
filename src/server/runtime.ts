// @spec DFF-ENGINE-001
// @spec DFF-ENGINE-003
export const defaultApiPort = 3001;

export function resolveApiPort(environment = process.env): number {
  const rawPort = environment.DYNASTYFF_API_PORT ?? environment.PORT;

  if (!rawPort) {
    return defaultApiPort;
  }

  const parsedPort = Number.parseInt(rawPort, 10);

  return Number.isNaN(parsedPort) ? defaultApiPort : parsedPort;
}

export function resolveApiBaseUrl(environment = process.env): string {
  return `http://localhost:${resolveApiPort(environment)}`;
}
