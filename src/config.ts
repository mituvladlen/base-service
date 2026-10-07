import 'dotenv/config';

export interface Config {
  port: number;
  storage: 'memory' | 'postgres';
  databaseUrl: string;
  playerClient: 'mock' | 'http';
  worldClient: 'mock' | 'http';
  resourceClient: 'mock' | 'http';
  /** Other services are reached only through the Gateway, e.g. http://gateway:8080/resource */
  playerServiceUrl: string;
  worldServiceUrl: string;
  resourceServiceUrl: string;
  mockPlayers: string[];
  kikiCooldownSeconds: number;
  requestTimeoutMs: number;
  maxConcurrentRequests: number;
  /** Demo only: artificial delay added to every request. */
  simulatedLatencyMs: number;
  outgoingTimeoutMs: number;
  /** JWT sent as `Authorization: Bearer` on calls through the Gateway. */
  serviceToken: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT ?? 3002),
    storage: env.STORAGE === 'postgres' ? 'postgres' : 'memory',
    databaseUrl: env.DATABASE_URL ?? '',
    playerClient: env.PLAYER_CLIENT === 'http' ? 'http' : 'mock',
    worldClient: env.WORLD_CLIENT === 'http' ? 'http' : 'mock',
    resourceClient: env.RESOURCE_CLIENT === 'http' ? 'http' : 'mock',
    playerServiceUrl: env.PLAYER_SERVICE_URL ?? 'http://gateway:8080/player',
    worldServiceUrl: env.WORLD_SERVICE_URL ?? 'http://gateway:8080/world',
    resourceServiceUrl: env.RESOURCE_SERVICE_URL ?? 'http://gateway:8080/resource',
    mockPlayers: (env.MOCK_PLAYERS ?? 'player-1,player-2,player-3,player-4')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    kikiCooldownSeconds: Number(env.KIKI_COOLDOWN_SECONDS ?? 30),
    requestTimeoutMs: Number(env.REQUEST_TIMEOUT_MS ?? 5000),
    maxConcurrentRequests: Number(env.MAX_CONCURRENT_REQUESTS ?? 100),
    simulatedLatencyMs: Number(env.SIMULATED_LATENCY_MS ?? 0),
    outgoingTimeoutMs: Number(env.OUTGOING_TIMEOUT_MS ?? 3000),
    serviceToken: env.SERVICE_TOKEN ?? ''
  };
}
