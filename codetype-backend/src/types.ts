// Firestore document interfaces

export interface UserDocument {
  uid: string;
  email: string;
  displayName: string;
  username: string;
  photoURL?: string;
  createdAt: number;
  lastLoginAt: number;
  totalGamesPlayed: number;
  totalWpm: number;
  bestWpm: number;
  avgWpm: number;
  totalCharacters: number;
  totalErrors: number;
  currentStreak: number;
  longestStreak: number;
  lastPlayedDate: string; // YYYY-MM-DD
}

export interface GameDocument {
  id: string;
  userId: string;
  wpm: number;
  accuracy: number;
  time: number;
  characters: number;
  errors: number;
  language?: string;
  playedAt: number;
  date: string; // YYYY-MM-DD
}

export interface ActivityDocument {
  userId: string;
  date: string; // YYYY-MM-DD
  gamesPlayed: number;
  totalWpm: number;
  bestWpm: number;
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
  characters: number;
  errors: number;
  language?: string;
}

export interface SubmitGameResponse {
  success: boolean;
  gameId: string;
  updatedStats: {
    totalGamesPlayed: number;
    avgWpm: number;
    bestWpm: number;
    currentStreak: number;
  };
}

export interface UserStatsResponse {
  user: UserDocument;
  recentGames: GameDocument[];
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
  FIREBASE_PROJECT_ID: string;
  FIREBASE_API_KEY: string;
  FIREBASE_CONFIG: string; // JSON string of FirebaseConfig
  FIREBASE_JWT_CERTS?: string; // JSON map of key id to PEM
  ALLOWED_ORIGINS?: string; // Comma-separated allowlist for CORS
  RATE_LIMIT_PER_MINUTE?: string;
}
