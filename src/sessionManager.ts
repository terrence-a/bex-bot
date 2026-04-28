import * as fs from 'fs';
import * as path from 'path';

export interface RoomState {
  activeSlug: string;
  telepathy: boolean;
}

export interface PersistentData {
  sessions: { [slug: string]: string }; // slug -> sessionId
  rooms: { [roomId: string]: RoomState };
}

class SessionManager {
  private data: PersistentData;
  private readonly filePath = path.join(process.cwd(), '.opencode-sessions.json');
  private activePermissionIds = new Map<string, string | null>();

  constructor() {
    this.data = this.loadData();
  }

  private loadData(): PersistentData {
    if (fs.existsSync(this.filePath)) {
      try {
        const fileContent = fs.readFileSync(this.filePath, 'utf-8');
        return JSON.parse(fileContent);
      } catch (e) {
        console.error("Failed to parse sessions file, starting fresh", e);
      }
    }
    return { sessions: {}, rooms: {} };
  }

  private saveData(): void {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (e) {
      console.error("Failed to save sessions file", e);
    }
  }

  async init(createSessionFn: () => Promise<string>): Promise<void> {
    if (Object.keys(this.data.sessions).length === 0) {
      console.log("No OpenCode sessions found in cache. Creating initial session...");
      const sessionId = await createSessionFn();
      this.data.sessions['s1'] = sessionId;
      this.saveData();
      console.log("Initial session 's1' created and saved.");
    }
  }

  addSession(sessionId: string): string {
    // Find highest slug number
    let maxNumber = 0;
    for (const slug of Object.keys(this.data.sessions)) {
      const num = parseInt(slug.slice(1), 10);
      if (!isNaN(num) && num > maxNumber) {
        maxNumber = num;
      }
    }
    const newSlug = `s${maxNumber + 1}`;
    this.data.sessions[newSlug] = sessionId;
    this.saveData();
    return newSlug;
  }

  getSessions(): { [slug: string]: string } {
    return this.data.sessions;
  }

  getSessionIdBySlug(slug: string): string | undefined {
    return this.data.sessions[slug];
  }

  getSlugBySessionId(sessionId: string): string | undefined {
    for (const [slug, id] of Object.entries(this.data.sessions)) {
      if (id === sessionId) return slug;
    }
    return undefined;
  }

  getRoomState(roomId: string): RoomState {
    if (!this.data.rooms[roomId]) {
      this.data.rooms[roomId] = {
        activeSlug: 's1',
        telepathy: false
      };
      this.saveData();
    }
    return this.data.rooms[roomId];
  }

  updateRoomState(roomId: string, partialState: Partial<RoomState>): void {
    const currentState = this.getRoomState(roomId);
    this.data.rooms[roomId] = { ...currentState, ...partialState };
    this.saveData();
  }

  setActivePermissionId(roomId: string, permissionId: string | null): void {
    this.activePermissionIds.set(roomId, permissionId);
  }

  getActivePermissionId(roomId: string): string | undefined | null {
    return this.activePermissionIds.get(roomId);
  }
}

export const sessionManager = new SessionManager();
