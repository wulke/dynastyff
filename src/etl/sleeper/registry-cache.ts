import fs from 'node:fs';
import path from 'node:path';

import type { FetchLike, PlayerRegistry, PlayerRegistryEntry, SyncLogger } from './types.js';

export class SleeperRegistryUnavailableError extends Error {}

export const defaultRegistryCachePath = path.resolve(
  process.cwd(),
  'data',
  'sleeper-players-cache.json',
);

const defaultRegistryTtlMs = 24 * 60 * 60 * 1000;

type CacheFile = {
  fetched_at?: unknown;
  players?: unknown;
};

function isRegistry(value: unknown): value is PlayerRegistry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every(
    (entry) =>
      !!entry &&
      typeof entry === 'object' &&
      typeof (entry as PlayerRegistryEntry).fullName === 'string' &&
      typeof (entry as PlayerRegistryEntry).position === 'string',
  );
}

function readCacheFile(cachePath: string): { registry: PlayerRegistry; fetchedAt: string } | null {
  let raw: string;

  try {
    raw = fs.readFileSync(cachePath, 'utf8');
  } catch {
    return null;
  }

  let parsed: CacheFile;

  try {
    parsed = JSON.parse(raw) as CacheFile;
  } catch {
    return null;
  }

  if (typeof parsed.fetched_at !== 'string' || !isRegistry(parsed.players)) {
    return null;
  }

  return { registry: parsed.players, fetchedAt: parsed.fetched_at };
}

// Trims the ~5 MB raw /players/nfl payload down to the fields matching needs.
function toRegistry(payload: Record<string, unknown>): PlayerRegistry {
  const registry: PlayerRegistry = {};

  for (const [id, entry] of Object.entries(payload)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }

    const { full_name, position } = entry as { full_name?: unknown; position?: unknown };

    if (typeof full_name === 'string' && typeof position === 'string') {
      registry[id] = { fullName: full_name, position };
    }
  }

  return registry;
}

// @spec DFF-SLS-034
// @spec DFF-SLS-035
// @spec DFF-SLS-036
// Loads the Sleeper NFL player registry: fresh disk cache (< 24h) wins; an
// expired cache triggers one fetch that rewrites the cache; a failed fetch
// falls back to the stale cache with a warning, or aborts when no cache exists.
export async function loadPlayerRegistry({
  cachePath = defaultRegistryCachePath,
  fetchImpl = fetch as FetchLike,
  now = () => new Date(),
  ttlMs = defaultRegistryTtlMs,
  logger,
}: {
  cachePath?: string;
  fetchImpl?: FetchLike;
  now?: () => Date;
  ttlMs?: number;
  logger?: SyncLogger;
} = {}): Promise<PlayerRegistry> {
  const cached = readCacheFile(cachePath);

  if (cached && now().getTime() - Date.parse(cached.fetchedAt) < ttlMs) {
    return cached.registry;
  }

  try {
    const response = await fetchImpl('https://api.sleeper.app/v1/players/nfl');

    if (!response.ok) {
      throw new Error(`Sleeper returned ${response.status}.`);
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const registry = toRegistry(payload);
    const fetchedAt = now().toISOString();

    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify({ fetched_at: fetchedAt, players: registry }));

    return registry;
  } catch (error) {
    if (cached) {
      logger?.warn(
        '[Sleeper] WARN: player registry fetch failed — using stale cache ' +
          `(fetched ${cached.fetchedAt}).`,
      );
      return cached.registry;
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new SleeperRegistryUnavailableError(
      `[Sleeper] ERROR: player registry unavailable and no valid cache exists at ${cachePath}: ${message}`,
    );
  }
}
