import { HttpOptions, getJson } from './httpJson';

export interface PlayerClient {
  playerExists(playerId: string): Promise<boolean>;
}

/** Lab 1 mock: fixed list of known players. */
export class MockPlayerClient implements PlayerClient {
  private readonly players: Set<string>;
  constructor(players: string[] = ['player-1', 'player-2', 'player-3']) {
    this.players = new Set(players);
  }
  async playerExists(playerId: string) {
    return this.players.has(playerId);
  }
}

/** Lab 2, through the Gateway: GET {PLAYER_SERVICE_URL}/players/:id */
export class HttpPlayerClient implements PlayerClient {
  constructor(
    private readonly baseUrl: string,
    private readonly opts: HttpOptions = {}
  ) {}
  async playerExists(playerId: string) {
    return (await getJson(`${this.baseUrl}/players/${encodeURIComponent(playerId)}`, 'Player Service', this.opts)) !== null;
  }
}
