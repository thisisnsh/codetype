module.exports = function() {
  // FIREBASE_PUBLIC_CONFIG is a JSON string set during build via GitHub Actions
  const configJson = process.env.FIREBASE_PUBLIC_CONFIG || '{}';
  let config = {};

  try {
    config = JSON.parse(configJson);
  } catch (e) {
    console.warn('Failed to parse FIREBASE_PUBLIC_CONFIG:', e.message);
  }

  return {
    apiKey: config.apiKey || '',
    authDomain: config.authDomain || '',
    projectId: config.projectId || '',
    appId: config.appId || '',
    apiBase: 'https://codetype-api.thisisnsh.workers.dev'
  };
};
