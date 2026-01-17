import type {
  DecodedToken,
  UserDocument,
  GameDocument,
  ActivityDocument,
  RoomDocument,
  FirebaseConfig,
  Env,
} from './types';

import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  initializeFirestore,
  type Firestore,
  collection,
  doc,
  getDoc,
  setDoc,
  addDoc,
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

let cachedPublicKeys: Record<string, string> | null = null;
let publicKeysCacheExpiry: number = 0;

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

const FIREBASE_PUBLIC_KEYS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

/**
 * Fetch Firebase public keys for JWT verification from Google
 * Keys are cached based on cache-control headers
 */
async function getPublicKeys(): Promise<Record<string, string>> {
  const now = Date.now();
  if (cachedPublicKeys && now < publicKeysCacheExpiry) {
    return cachedPublicKeys;
  }

  const response = await fetch(FIREBASE_PUBLIC_KEYS_URL);
  if (!response.ok) {
    if (cachedPublicKeys) {
      return cachedPublicKeys;
    }
    throw new Error('Failed to fetch Firebase public keys');
  }

  const cacheControl = response.headers.get('cache-control');
  let maxAge = 3600;
  if (cacheControl) {
    const match = cacheControl.match(/max-age=(\d+)/);
    if (match) {
      maxAge = parseInt(match[1], 10);
    }
  }

  cachedPublicKeys = await response.json();
  publicKeysCacheExpiry = now + maxAge * 1000;
  return cachedPublicKeys!;
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

  const publicKeys = await getPublicKeys();
  const publicKey = publicKeys[header.kid];

  if (!publicKey) {
    throw new Error('Public key not found');
  }

  const pemContents = publicKey
    .replace('-----BEGIN CERTIFICATE-----', '')
    .replace('-----END CERTIFICATE-----', '')
    .replace(/\s/g, '');

  const binaryDer = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    'spki',
    binaryDer,
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

export async function firestoreAdd(
  env: Env,
  collectionName: string,
  data: Record<string, any>
): Promise<string> {
  await ensureServiceAuth(env);
  const db = getFirestoreClient(env);
  const ref = await addDoc(collection(db, collectionName), data);
  return ref.id;
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
 * Calculate and update streak for a user
 */
export async function updateStreak(
  env: Env,
  userId: string,
  gameDate: string // YYYY-MM-DD
): Promise<{ currentStreak: number; longestStreak: number }> {
  const user = await firestoreGet<UserDocument>(env, 'users', userId);

  if (!user) {
    throw new Error('User not found');
  }

  const lastPlayedDate = user.lastPlayedDate;
  let currentStreak = user.currentStreak || 0;
  let longestStreak = user.longestStreak || 0;

  if (!lastPlayedDate) {
    currentStreak = 1;
  } else if (lastPlayedDate === gameDate) {
    // Already played today, no streak change
  } else {
    const lastDate = new Date(lastPlayedDate);
    const currentDate = new Date(gameDate);
    const diffTime = currentDate.getTime() - lastDate.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 1) {
      currentStreak++;
    } else if (diffDays > 1) {
      currentStreak = 1;
    }
  }

  longestStreak = Math.max(longestStreak, currentStreak);

  await firestoreSet(env, 'users', userId, {
    ...user,
    lastPlayedDate: gameDate,
    currentStreak,
    longestStreak,
  });

  return { currentStreak, longestStreak };
}

/**
 * Update or create activity document for heatmap
 */
export async function updateActivity(
  env: Env,
  userId: string,
  gameDate: string,
  wpm: number
): Promise<ActivityDocument> {
  const activityId = `${userId}_${gameDate}`;

  let activity = await firestoreGet<ActivityDocument>(env, 'activity', activityId);

  if (activity) {
    activity = {
      ...activity,
      gamesPlayed: activity.gamesPlayed + 1,
      totalWpm: activity.totalWpm + wpm,
      bestWpm: Math.max(activity.bestWpm, wpm),
    };
  } else {
    activity = {
      userId,
      date: gameDate,
      gamesPlayed: 1,
      totalWpm: wpm,
      bestWpm: wpm,
    };
  }

  await firestoreSet(env, 'activity', activityId, activity);
  return activity;
}

/**
 * Get activity data for a year (for streak heatmap)
 */
export async function getYearActivity(
  env: Env,
  userId: string,
  year: number
): Promise<Record<string, ActivityDocument>> {
  const startDate = `${year}-01-01`;
  const endDate = `${year}-12-31`;

  const activities = await firestoreQuery<ActivityDocument>(
    env,
    'activity',
    [
      { field: 'userId', op: 'EQUAL', value: userId },
      { field: 'date', op: 'GREATER_THAN_OR_EQUAL', value: startDate },
      { field: 'date', op: 'LESS_THAN_OR_EQUAL', value: endDate },
    ]
  );

  const result: Record<string, ActivityDocument> = {};
  for (const activity of activities) {
    result[activity.date] = activity;
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

export async function getRecentGames(
  env: Env,
  uid: string
): Promise<GameDocument[]> {
  return firestoreQuery<GameDocument>(
    env,
    'games',
    [{ field: 'userId', op: 'EQUAL', value: uid }],
    { field: 'playedAt', direction: 'DESCENDING' },
    20
  );
}

export async function addGame(
  env: Env,
  data: Omit<GameDocument, 'id'>
): Promise<string> {
  return firestoreAdd(env, 'games', data);
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
