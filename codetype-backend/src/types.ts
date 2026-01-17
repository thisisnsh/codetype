// Firestore document interfaces

export interface SoloSession {
  wpm: number;
  accuracy: number;
  charsTyped: number;    // Characters actually typed
  totalChars: number;    // Total chars in snippet (for completion %)
  createdAt: number;     // Firebase Timestamp or epoch ms
}

export interface TeamSession {
  wpm: Record<string, number>;       // {uid: wpm}
  accuracy: Record<string, number>;  // {uid: accuracy}
  charsTyped: Record<string, number>;   // {uid: charsTyped}
  totalChars: number;                // Same snippet for all
  createdAt: number;     // Firebase Timestamp or epoch ms
}

export interface UserDocument {
  uid: string;
  email: string;
  displayName: string;
  username: string;
  photoURL?: string;
  createdAt: number;     // Firebase Timestamp or epoch ms
  lastPlayedAt: number;  // Firebase Timestamp or epoch ms
  sessions: {
    solo: {
      // Key: epoch ms as string (e.g., "1705500000000") - sortable
      [epochKey: string]: SoloSession;
    };
    team: {
      // Key: "epochMs_ROOMCODE" (e.g., "1705500000000_ABC123")
      // Stored in EACH participant's document
      [epochKey: string]: TeamSession;
    };
  };
}

export interface RoomDocument {
  code: string;
  hostId: string;
  hostUsername: string;
  createdAt: number;
  expiresAt: number;
}

// API request/response types

export interface DecodedToken {
  uid: string;
  email: string;
  name?: string;
  picture?: string;
  email_verified: boolean;
  exp: number;
  iat: number;
}

export interface VerifyTokenRequest {
  idToken: string;
}

export interface VerifyTokenResponse {
  valid: boolean;
  user?: UserDocument;
  needsUsername?: boolean;
}

export interface RegisterRequest {
  username: string;
}

export interface SubmitGameRequest {
  wpm: number;
  accuracy: number;
  time: number;
  charsTyped: number;
  totalChars: number;
  language?: string;
}

export interface SubmitGameResponse {
  success: boolean;
  sessionKey: string;
  updatedStats: {
    totalGamesPlayed: number;
    avgWpm: number;
    bestWpm: number;
    currentStreak: number;
  };
}

// Calculated stats derived from sessions
export interface CalculatedStats {
  totalGamesPlayed: number;
  avgWpm: number;
  bestWpm: number;
  totalCharsTyped: number;
  currentStreak: number;
  longestStreak: number;
}

// Recent session with epoch key for display
export interface RecentSession {
  epochKey: string;
  wpm: number;
  accuracy: number;
  charsTyped: number;
  totalChars: number;
  createdAt: number;
}

export interface UserStatsResponse {
  stats: CalculatedStats;
  recentSessions: RecentSession[];
}

export interface StreaksResponse {
  activities: Record<string, { gamesPlayed: number; totalWpm: number; bestWpm: number }>;
  currentStreak: number;
  longestStreak: number;
  totalActiveDays: number;
}

// Firebase config type
export interface FirebaseConfig {
  projectId: string;
  apiKey: string;
  authDomain?: string;
  appId?: string;
  serviceAccount?: {
    client_email: string;
    private_key: string;
  };
}

// Env interface extension
export interface Env {
  ROOMS: DurableObjectNamespace;
  FIREBASE_CONFIG: string; // JSON string of FirebaseConfig (includes all Firebase settings)
  ALLOWED_ORIGINS?: string; // Comma-separated allowlist for CORS
  RATE_LIMIT_PER_MINUTE?: string;
}
