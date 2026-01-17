import type {
  DecodedToken,
  UserDocument,
  SoloSession,
  TeamSession,
  RoomDocument,
  FirebaseConfig,
  Env,
  CalculatedStats,
  RecentSession,
} from './types';

import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  initializeFirestore,
  type Firestore,
  collection,
  doc,
  getDoc,
  setDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit as queryLimit,
  type QueryConstraint,
} from 'firebase/firestore/lite';
import {
  initializeAuth,
  inMemoryPersistence,
  signInWithCustomToken,
  type Auth,
} from 'firebase/auth';

let cachedFirebaseApp: FirebaseApp | null = null;
let cachedFirestore: Firestore | null = null;
let cachedAuth: Auth | null = null;
let serviceAuthPromise: Promise<void> | null = null;


/**
 * Parse Firebase config from environment
 */
export function getFirebaseConfig(env: Env): FirebaseConfig {
  return JSON.parse(env.FIREBASE_CONFIG);
}

function getFirebaseApp(env: Env): FirebaseApp {
  if (!cachedFirebaseApp) {
    const config = getFirebaseConfig(env);
    cachedFirebaseApp = initializeApp({
      apiKey: config.apiKey,
      authDomain: config.authDomain,
      projectId: config.projectId,
      appId: config.appId,
    });
  }
  return cachedFirebaseApp;
}

function getFirebaseAuth(env: Env): Auth {
  if (!cachedAuth) {
    cachedAuth = initializeAuth(getFirebaseApp(env), {
      persistence: inMemoryPersistence,
    });
  }
  return cachedAuth;
}

async function ensureServiceAuth(env: Env): Promise<void> {
  if (serviceAuthPromise) {
    return serviceAuthPromise;
  }

  const config = getFirebaseConfig(env);
  if (!config.serviceAccount) {
    throw new Error('Missing Firebase service account config');
  }

  const token = await createCustomToken(
    config.serviceAccount,
    'codetype-worker',
    { role: 'service' }
  );

  const auth = getFirebaseAuth(env);
  serviceAuthPromise = signInWithCustomToken(auth, token)
    .then(() => {})
    .catch((error) => {
      serviceAuthPromise = null;
      throw error;
    });
  return serviceAuthPromise;
}

function getFirestoreClient(env: Env): Firestore {
  if (!cachedFirestore) {
    cachedFirestore = initializeFirestore(getFirebaseApp(env), {
      ignoreUndefinedProperties: true,
    });
  }
  return cachedFirestore;
}

const FIREBASE_JWK_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

interface JWK {
  kid: string;
  kty: string;
  alg: string;
  use: string;
  n: string;
  e: string;
}

let cachedJwks: JWK[] | null = null;
let jwksCacheExpiry: number = 0;

/**
 * Fetch Firebase public keys in JWK format from Google
 * Keys are cached for 1 hour
 */
async function getJwks(): Promise<JWK[]> {
  const now = Date.now();
  if (cachedJwks && now < jwksCacheExpiry) {
    return cachedJwks;
  }

  const response = await fetch(FIREBASE_JWK_URL);
  if (!response.ok) {
    if (cachedJwks) {
      return cachedJwks;
    }
    throw new Error('Failed to fetch Firebase public keys');
  }

  const data = (await response.json()) as { keys: JWK[] };
  cachedJwks = data.keys;
  jwksCacheExpiry = now + 3600 * 1000; // Cache for 1 hour
  return cachedJwks;
}

function base64UrlEncode(data: string | Uint8Array): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str: string): string {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4 ? '='.repeat(4 - (base64.length % 4)) : '';
  return atob(base64 + pad);
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const cleaned = pem.replace(/\\n/g, '\n').replace(/\r/g, '');
  const pemContents = cleaned
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');
  const binaryDer = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

  return crypto.subtle.importKey(
    'pkcs8',
    binaryDer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

async function createCustomToken(
  serviceAccount: { client_email: string; private_key: string },
  uid: string,
  claims?: Record<string, unknown>
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: 'RS256',
    typ: 'JWT',
  };
  const payload: Record<string, unknown> = {
    iss: serviceAccount.client_email,
    sub: serviceAccount.client_email,
    aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    iat: now,
    exp: now + 60 * 60,
    uid,
  };

  if (claims && Object.keys(claims).length > 0) {
    payload.claims = claims;
  }

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const key = await importPrivateKey(serviceAccount.private_key);
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput)
  );

  const encodedSignature = base64UrlEncode(new Uint8Array(signature));
  return `${signingInput}.${encodedSignature}`;
}

/**
 * Verify Firebase ID token (JWT) using public keys fetched from Google
 */
export async function verifyIdToken(
  idToken: string,
  projectId: string
): Promise<DecodedToken> {
  const parts = idToken.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid token format');
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  const header = JSON.parse(base64UrlDecode(headerB64));
  const payload = JSON.parse(base64UrlDecode(payloadB64));

  if (header.alg !== 'RS256') {
    throw new Error('Invalid token algorithm');
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) {
    throw new Error('Token has expired');
  }

  if (payload.iat > now + 300) {
    throw new Error('Token issued in the future');
  }

  if (payload.aud !== projectId) {
    throw new Error('Invalid token audience');
  }

  if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
    throw new Error('Invalid token issuer');
  }

  const jwks = await getJwks();
  const jwk = jwks.find((k) => k.kid === header.kid);

  if (!jwk) {
    throw new Error('Public key not found');
  }

  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );

  const signedContent = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = Uint8Array.from(base64UrlDecode(signatureB64), (c) =>
    c.charCodeAt(0)
  );

  const isValid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    signature,
    signedContent
  );

  if (!isValid) {
    throw new Error('Invalid token signature');
  }

  return {
    uid: payload.sub || payload.user_id,
    email: payload.email,
    name: payload.name,
    picture: payload.picture,
    email_verified: payload.email_verified,
    exp: payload.exp,
    iat: payload.iat,
  };
}

/**
 * Firestore helpers (Firebase SDK)
 */
export async function firestoreGet<T>(
  env: Env,
  collectionName: string,
  docId: string
): Promise<T | null> {
  await ensureServiceAuth(env);
  const db = getFirestoreClient(env);
  const snapshot = await getDoc(doc(db, collectionName, docId));
  if (!snapshot.exists()) {
    return null;
  }
  return snapshot.data() as T;
}

export async function firestoreSet(
  env: Env,
  collectionName: string,
  docId: string,
  data: Record<string, any>
): Promise<void> {
  await ensureServiceAuth(env);
  const db = getFirestoreClient(env);
  await setDoc(doc(db, collectionName, docId), data);
}

export async function firestoreQuery<T>(
  env: Env,
  collectionName: string,
  filters: Array<{
    field: string;
    op: 'EQUAL' | 'LESS_THAN' | 'LESS_THAN_OR_EQUAL' | 'GREATER_THAN' | 'GREATER_THAN_OR_EQUAL';
    value: any;
  }>,
  order?: { field: string; direction: 'ASCENDING' | 'DESCENDING' },
  max?: number
): Promise<T[]> {
  await ensureServiceAuth(env);
  const db = getFirestoreClient(env);

  const constraints: QueryConstraint[] = [];
  for (const filter of filters) {
    const op = mapFirestoreOp(filter.op);
    constraints.push(where(filter.field, op, filter.value));
  }

  if (order) {
    constraints.push(orderBy(order.field, order.direction === 'DESCENDING' ? 'desc' : 'asc'));
  }

  if (max) {
    constraints.push(queryLimit(max));
  }

  const q = query(collection(db, collectionName), ...constraints);
  const snapshot = await getDocs(q);
  return snapshot.docs.map((docSnap) => ({
    ...(docSnap.data() as T),
    id: docSnap.id,
  }));
}

function mapFirestoreOp(
  op: 'EQUAL' | 'LESS_THAN' | 'LESS_THAN_OR_EQUAL' | 'GREATER_THAN' | 'GREATER_THAN_OR_EQUAL'
) {
  switch (op) {
    case 'EQUAL':
      return '==';
    case 'LESS_THAN':
      return '<';
    case 'LESS_THAN_OR_EQUAL':
      return '<=';
    case 'GREATER_THAN':
      return '>';
    case 'GREATER_THAN_OR_EQUAL':
      return '>=';
  }
}

/**
 * Generate a session key (epoch ms as string)
 */
export function generateSessionKey(): string {
  return Date.now().toString();
}

/**
 * Add a solo session to a user's document
 */
export async function addSoloSession(
  env: Env,
  userId: string,
  session: SoloSession
): Promise<string> {
  const user = await firestoreGet<UserDocument>(env, 'users', userId);
  if (!user) {
    throw new Error('User not found');
  }

  const sessionKey = generateSessionKey();
  const updatedUser: UserDocument = {
    ...user,
    lastPlayedAt: session.createdAt,
    sessions: {
      ...user.sessions,
      solo: {
        ...user.sessions.solo,
        [sessionKey]: session,
      },
    },
  };

  await firestoreSet(env, 'users', userId, updatedUser);
  return sessionKey;
}

/**
 * Add a team session to each participant's document
 */
export async function addTeamSession(
  env: Env,
  roomCode: string,
  participantIds: string[],
  session: TeamSession
): Promise<string> {
  const sessionKey = `${Date.now()}_${roomCode}`;

  for (const participantId of participantIds) {
    const user = await firestoreGet<UserDocument>(env, 'users', participantId);
    if (!user) {
      continue; // Skip if user not found
    }

    const updatedUser: UserDocument = {
      ...user,
      lastPlayedAt: session.createdAt,
      sessions: {
        ...user.sessions,
        team: {
          ...user.sessions.team,
          [sessionKey]: session,
        },
      },
    };

    await firestoreSet(env, 'users', participantId, updatedUser);
  }

  return sessionKey;
}

/**
 * Calculate stats from a user's sessions
 */
export function calculateStatsFromSessions(user: UserDocument): CalculatedStats {
  const soloSessions = Object.values(user.sessions?.solo || {});

  if (soloSessions.length === 0) {
    return {
      totalGamesPlayed: 0,
      avgWpm: 0,
      bestWpm: 0,
      totalCharsTyped: 0,
      currentStreak: 0,
      longestStreak: 0,
    };
  }

  const totalGamesPlayed = soloSessions.length;
  const totalWpm = soloSessions.reduce((sum, s) => sum + s.wpm, 0);
  const avgWpm = Math.round(totalWpm / totalGamesPlayed);
  const bestWpm = Math.max(...soloSessions.map(s => s.wpm));
  const totalCharsTyped = soloSessions.reduce((sum, s) => sum + s.charsTyped, 0);

  const streaks = calculateStreaks(user);

  return {
    totalGamesPlayed,
    avgWpm,
    bestWpm,
    totalCharsTyped,
    currentStreak: streaks.currentStreak,
    longestStreak: streaks.longestStreak,
  };
}

/**
 * Calculate streaks from session keys
 * Converts epoch keys to dates, finds consecutive days
 */
export function calculateStreaks(user: UserDocument): { currentStreak: number; longestStreak: number } {
  const soloSessions = user.sessions?.solo || {};
  const epochKeys = Object.keys(soloSessions);

  if (epochKeys.length === 0) {
    return { currentStreak: 0, longestStreak: 0 };
  }

  // Convert epoch keys to unique dates (YYYY-MM-DD)
  const uniqueDates = new Set<string>();
  for (const epochKey of epochKeys) {
    const epochMs = parseInt(epochKey, 10);
    if (!isNaN(epochMs)) {
      const date = new Date(epochMs);
      uniqueDates.add(date.toISOString().split('T')[0]);
    }
  }

  // Sort dates
  const sortedDates = Array.from(uniqueDates).sort();

  if (sortedDates.length === 0) {
    return { currentStreak: 0, longestStreak: 0 };
  }

  let longestStreak = 1;
  let currentStreakCount = 1;
  let tempStreak = 1;

  // Calculate longest streak
  for (let i = 1; i < sortedDates.length; i++) {
    const prevDate = new Date(sortedDates[i - 1]);
    const currDate = new Date(sortedDates[i]);
    const diffTime = currDate.getTime() - prevDate.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 1) {
      tempStreak++;
    } else {
      tempStreak = 1;
    }

    longestStreak = Math.max(longestStreak, tempStreak);
  }

  // Calculate current streak (from today backwards)
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

  // Check if played today or yesterday
  const lastPlayedDate = sortedDates[sortedDates.length - 1];
  if (lastPlayedDate !== today && lastPlayedDate !== yesterday) {
    // Streak is broken
    currentStreakCount = 0;
  } else {
    // Count backwards from last played date
    currentStreakCount = 1;
    for (let i = sortedDates.length - 2; i >= 0; i--) {
      const prevDate = new Date(sortedDates[i]);
      const currDate = new Date(sortedDates[i + 1]);
      const diffTime = currDate.getTime() - prevDate.getTime();
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays === 1) {
        currentStreakCount++;
      } else {
        break;
      }
    }
  }

  return { currentStreak: currentStreakCount, longestStreak };
}

/**
 * Get recent sessions sorted by epoch key (most recent first)
 */
export function getRecentSessions(user: UserDocument, limit: number = 20): RecentSession[] {
  const soloSessions = user.sessions?.solo || {};
  const epochKeys = Object.keys(soloSessions).sort((a, b) => parseInt(b, 10) - parseInt(a, 10));

  return epochKeys.slice(0, limit).map(epochKey => {
    const session = soloSessions[epochKey];
    return {
      epochKey,
      wpm: session.wpm,
      accuracy: session.accuracy,
      charsTyped: session.charsTyped,
      totalChars: session.totalChars,
      createdAt: session.createdAt,
    };
  });
}

/**
 * Get year activity from sessions (for streak heatmap)
 * Groups sessions by date and counts games per day
 */
export function getYearActivityFromSessions(
  user: UserDocument,
  year: number
): Record<string, { gamesPlayed: number; totalWpm: number; bestWpm: number }> {
  const soloSessions = user.sessions?.solo || {};
  const result: Record<string, { gamesPlayed: number; totalWpm: number; bestWpm: number }> = {};

  const startOfYear = new Date(year, 0, 1).getTime();
  const endOfYear = new Date(year, 11, 31, 23, 59, 59, 999).getTime();

  for (const [epochKey, session] of Object.entries(soloSessions)) {
    const epochMs = parseInt(epochKey, 10);
    if (isNaN(epochMs) || epochMs < startOfYear || epochMs > endOfYear) {
      continue;
    }

    const date = new Date(epochMs).toISOString().split('T')[0];

    if (!result[date]) {
      result[date] = { gamesPlayed: 0, totalWpm: 0, bestWpm: 0 };
    }

    result[date].gamesPlayed++;
    result[date].totalWpm += session.wpm;
    result[date].bestWpm = Math.max(result[date].bestWpm, session.wpm);
  }

  return result;
}

/**
 * Check if username is available
 */
export async function isUsernameAvailable(
  env: Env,
  username: string
): Promise<boolean> {
  const users = await firestoreQuery<UserDocument>(
    env,
    'users',
    [{ field: 'username', op: 'EQUAL', value: username.toLowerCase() }],
    undefined,
    1
  );

  return users.length === 0;
}

export async function getUser(
  env: Env,
  uid: string
): Promise<UserDocument | null> {
  return firestoreGet<UserDocument>(env, 'users', uid);
}

export async function setUser(
  env: Env,
  uid: string,
  data: UserDocument
): Promise<void> {
  await firestoreSet(env, 'users', uid, data);
}

/**
 * Create a new room in Firestore
 */
export async function createRoom(
  env: Env,
  roomData: RoomDocument
): Promise<void> {
  await firestoreSet(env, 'rooms', roomData.code, roomData);
}

/**
 * Get a room by code from Firestore
 */
export async function getRoom(
  env: Env,
  code: string
): Promise<RoomDocument | null> {
  const room = await firestoreGet<RoomDocument>(env, 'rooms', code);
  if (!room) {
    return null;
  }
  // Check if room has expired
  if (room.expiresAt < Date.now()) {
    return null;
  }
  return room;
}

/**
 * Check if a room code exists and is not expired
 */
export async function isRoomCodeTaken(
  env: Env,
  code: string
): Promise<boolean> {
  const room = await getRoom(env, code);
  return room !== null;
}
