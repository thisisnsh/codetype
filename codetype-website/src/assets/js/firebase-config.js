// Firebase Configuration for CodeType
// These values should be replaced with your actual Firebase config
// or loaded from environment variables at build time

window.FIREBASE_CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// API Base URL - update this to your Cloudflare Worker URL
window.API_BASE = "https://codetype-api.your-subdomain.workers.dev";
