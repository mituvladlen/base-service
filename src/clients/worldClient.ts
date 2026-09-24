import { getJson } from './httpJson';

export interface WorldClient {
  /** Barricades can only be placed in rooms that exist on the campus map. */
  roomExists(roomId: string): Promise<boolean>;
}

export const MOCK_ROOMS = ['FAF_CAB', 'room-3-01', 'room-3-02', 'corridor-3', 'staircase-b', 'library-hall'];

export class MockWorldClient implements WorldClient {
  private readonly rooms: Set<string>;
  constructor(rooms: string[] = MOCK_ROOMS) {
    this.rooms = new Set(rooms);
  }
  async roomExists(roomId: string) {
    return this.rooms.has(roomId);
  }
}

/** Lab 2: GET {WORLD_SERVICE_URL}/rooms/:id */
export class HttpWorldClient implements WorldClient {
  constructor(private readonly baseUrl: string) {}
  async roomExists(roomId: string) {
    return (await getJson(`${this.baseUrl}/rooms/${encodeURIComponent(roomId)}`, 'World Service')) !== null;
  }
}
