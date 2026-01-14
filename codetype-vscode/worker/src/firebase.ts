import type {
  DecodedToken,
  UserDocument,
  GameDocument,
  ActivityDocument,
  FirebaseConfig,
  Env,
} from './types';

// Cache for Firebase public keys (for JWT verification)
let cachedPublicKeys: Record<string, string> | null = null;
let keyCacheExpiry: number = 0;

/**
 * Parse Firebase config from environment
 */
export function getFirebaseConfig(env: Env): FirebaseConfig {
  try {
    return JSON.parse(env.FIREBASE_CONFIG);
  } catch {
    return {
      projectId: env.FIREBASE_PROJECT_ID,
      apiKey: env.FIREBASE_API_KEY,
    };
  }
}

/**
 * Fetch Firebase public keys for JWT verification
 */
async function getPublicKeys(): Promise<Record<string, string>> {
  if (cachedPublicKeys && Date.now() < keyCacheExpiry) {
    return cachedPublicKeys;
  }

  const response = await fetch(
    'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'
  );

  if (!response.ok) {
    throw new Error('Failed to fetch Firebase public keys');
  }

  // Parse cache control header for expiry
  const cacheControl = response.headers.get('cache-control');
  const maxAgeMatch = cacheControl?.match(/max-age=(\d+)/);
  const maxAge = maxAgeMatch ? parseInt(maxAgeMatch[1], 10) : 3600;

  cachedPublicKeys = await response.json();
  keyCacheExpiry = Date.now() + maxAge * 1000;

  return cachedPublicKeys!;
}

/**
 * Base64URL decode
 */
function base64UrlDecode(str: string): string {
  // Replace URL-safe characters
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  // Pad with '=' if necessary
  const pad = str.length % 4;
  if (pad) {
    str += '='.repeat(4 - pad);
  }
  return atob(str);
}

/**
 * Verify Firebase ID token
 * Uses Google's public keys to verify the JWT signature
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

  // Decode header and payload
  const header = JSON.parse(base64UrlDecode(headerB64));
  const payload = JSON.parse(base64UrlDecode(payloadB64));

  // Verify algorithm
  if (header.alg !== 'RS256') {
    throw new Error('Invalid token algorithm');
  }

  // Verify expiration
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) {
    throw new Error('Token has expired');
  }

  // Verify issued at
  if (payload.iat > now + 300) {
    // 5 min tolerance
    throw new Error('Token issued in the future');
  }

  // Verify audience
  if (payload.aud !== projectId) {
    throw new Error('Invalid token audience');
  }

  // Verify issuer
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
    throw new Error('Invalid token issuer');
  }

  // Get public keys and verify signature
  const publicKeys = await getPublicKeys();
  const publicKey = publicKeys[header.kid];

  if (!publicKey) {
    throw new Error('Public key not found');
  }

  // Import the public key
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

  // Verify signature
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
 * Firestore REST API helpers
 */
const FIRESTORE_BASE_URL = 'https://firestore.googleapis.com/v1';

function getFirestoreUrl(projectId: string, path: string): string {
  return `${FIRESTORE_BASE_URL}/projects/${projectId}/databases/(default)/documents/${path}`;
}

/**
 * Convert Firestore document to plain object
 */
function fromFirestoreValue(value: any): any {
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.integerValue !== undefined) return parseInt(value.integerValue, 10);
  if (value.doubleValue !== undefined) return value.doubleValue;
  if (value.booleanValue !== undefined) return value.booleanValue;
  if (value.nullValue !== undefined) return null;
  if (value.timestampValue !== undefined) return new Date(value.timestampValue).getTime();
  if (value.arrayValue !== undefined) {
    return (value.arrayValue.values || []).map(fromFirestoreValue);
  }
  if (value.mapValue !== undefined) {
    return fromFirestoreFields(value.mapValue.fields || {});
  }
  return null;
}

function fromFirestoreFields(fields: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(fields)) {
    result[key] = fromFirestoreValue(value);
  }
  return result;
}

/**
 * Convert plain object to Firestore format
 */
function toFirestoreValue(value: any): any {
  if (value === null || value === undefined) {
    return { nullValue: null };
  }
  if (typeof value === 'string') {
    return { stringValue: value };
  }
  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      return { integerValue: value.toString() };
    }
    return { doubleValue: value };
  }
  if (typeof value === 'boolean') {
    return { booleanValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(toFirestoreValue) } };
  }
  if (typeof value === 'object') {
    return { mapValue: { fields: toFirestoreFields(value) } };
  }
  return { nullValue: null };
}

function toFirestoreFields(obj: Record<string, any>): Record<string, any> {
  const fields: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    fields[key] = toFirestoreValue(value);
  }
  return fields;
}

/**
 * Get a document from Firestore
 */
export async function firestoreGet<T>(
  projectId: string,
  apiKey: string,
  collection: string,
  docId: string
): Promise<T | null> {
  const url = `${getFirestoreUrl(projectId, `${collection}/${docId}`)}?key=${apiKey}`;

  const response = await fetch(url);

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Firestore get failed: ${error}`);
  }

  const doc = await response.json();
  return fromFirestoreFields(doc.fields || {}) as T;
}

/**
 * Set a document in Firestore
 */
export async function firestoreSet(
  projectId: string,
  apiKey: string,
  collection: string,
  docId: string,
  data: Record<string, any>
): Promise<void> {
  const url = `${getFirestoreUrl(projectId, `${collection}/${docId}`)}?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: toFirestoreFields(data) }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Firestore set failed: ${error}`);
  }
}

/**
 * Query documents from Firestore
 */
export async function firestoreQuery<T>(
  projectId: string,
  apiKey: string,
  collection: string,
  filters: Array<{
    field: string;
    op: 'EQUAL' | 'LESS_THAN' | 'LESS_THAN_OR_EQUAL' | 'GREATER_THAN' | 'GREATER_THAN_OR_EQUAL';
    value: any;
  }>,
  orderBy?: { field: string; direction: 'ASCENDING' | 'DESCENDING' },
  limit?: number
): Promise<T[]> {
  const url = `${FIRESTORE_BASE_URL}/projects/${projectId}/databases/(default)/documents:runQuery?key=${apiKey}`;

  const structuredQuery: any = {
    from: [{ collectionId: collection }],
  };

  if (filters.length > 0) {
    if (filters.length === 1) {
      structuredQuery.where = {
        fieldFilter: {
          field: { fieldPath: filters[0].field },
          op: filters[0].op,
          value: toFirestoreValue(filters[0].value),
        },
      };
    } else {
      structuredQuery.where = {
        compositeFilter: {
          op: 'AND',
          filters: filters.map((f) => ({
            fieldFilter: {
              field: { fieldPath: f.field },
              op: f.op,
              value: toFirestoreValue(f.value),
            },
          })),
        },
      };
    }
  }

  if (orderBy) {
    structuredQuery.orderBy = [
      {
        field: { fieldPath: orderBy.field },
        direction: orderBy.direction,
      },
    ];
  }

  if (limit) {
    structuredQuery.limit = limit;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Firestore query failed: ${error}`);
  }

  const results = await response.json();
  return results
    .filter((r: any) => r.document)
    .map((r: any) => {
      const doc = fromFirestoreFields(r.document.fields || {}) as T;
      // Extract document ID from name
      const name = r.document.name;
      const id = name.split('/').pop();
      return { ...doc, id };
    });
}

/**
 * Add a new document with auto-generated ID
 */
export async function firestoreAdd(
  projectId: string,
  apiKey: string,
  collection: string,
  data: Record<string, any>
): Promise<string> {
  const url = `${getFirestoreUrl(projectId, collection)}?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: toFirestoreFields(data) }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Firestore add failed: ${error}`);
  }

  const doc = await response.json();
  // Extract document ID from name
  const name = doc.name;
  return name.split('/').pop();
}

/**
 * Calculate and update streak for a user
 */
export async function updateStreak(
  projectId: string,
  apiKey: string,
  userId: string,
  gameDate: string // YYYY-MM-DD
): Promise<{ currentStreak: number; longestStreak: number }> {
  // Get existing user document
  const user = await firestoreGet<UserDocument>(projectId, apiKey, 'users', userId);

  if (!user) {
    throw new Error('User not found');
  }

  const lastPlayedDate = user.lastPlayedDate;
  let currentStreak = user.currentStreak || 0;
  let longestStreak = user.longestStreak || 0;

  if (!lastPlayedDate) {
    // First time playing
    currentStreak = 1;
  } else if (lastPlayedDate === gameDate) {
    // Already played today, no streak change
  } else {
    // Check if consecutive day
    const lastDate = new Date(lastPlayedDate);
    const currentDate = new Date(gameDate);
    const diffTime = currentDate.getTime() - lastDate.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 1) {
      // Consecutive day - increment streak
      currentStreak++;
    } else if (diffDays > 1) {
      // Streak broken - reset
      currentStreak = 1;
    }
    // diffDays < 0 should not happen, but handle gracefully
  }

  // Update longest streak
  longestStreak = Math.max(longestStreak, currentStreak);

  // Update user document
  await firestoreSet(projectId, apiKey, 'users', userId, {
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
  projectId: string,
  apiKey: string,
  userId: string,
  gameDate: string,
  wpm: number
): Promise<ActivityDocument> {
  const activityId = `${userId}_${gameDate}`;

  // Get existing activity
  let activity = await firestoreGet<ActivityDocument>(
    projectId,
    apiKey,
    'activity',
    activityId
  );

  if (activity) {
    // Update existing activity
    activity = {
      ...activity,
      gamesPlayed: activity.gamesPlayed + 1,
      totalWpm: activity.totalWpm + wpm,
      bestWpm: Math.max(activity.bestWpm, wpm),
    };
  } else {
    // Create new activity
    activity = {
      userId,
      date: gameDate,
      gamesPlayed: 1,
      totalWpm: wpm,
      bestWpm: wpm,
    };
  }

  await firestoreSet(projectId, apiKey, 'activity', activityId, activity);

  return activity;
}

/**
 * Get activity data for a year (for streak heatmap)
 */
export async function getYearActivity(
  projectId: string,
  apiKey: string,
  userId: string,
  year: number
): Promise<Record<string, ActivityDocument>> {
  const startDate = `${year}-01-01`;
  const endDate = `${year}-12-31`;

  const activities = await firestoreQuery<ActivityDocument>(
    projectId,
    apiKey,
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
  projectId: string,
  apiKey: string,
  username: string
): Promise<boolean> {
  const users = await firestoreQuery<UserDocument>(
    projectId,
    apiKey,
    'users',
    [{ field: 'username', op: 'EQUAL', value: username.toLowerCase() }],
    undefined,
    1
  );

  return users.length === 0;
}
