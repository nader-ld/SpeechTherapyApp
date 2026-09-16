/* Email/password sign-in + Firestore sync. Versioned CDN modules are cached offline. */
import * as store from './store.js';
import { firebaseConfig, FIREBASE_SDK, ALLOWED_EMAIL } from './firebase-config.js';
import { createCloudClient } from './cloud-client.js';

const CDN = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK}`;
const [appSDK, authSDK, fsSDK] = await Promise.all([
  import(`${CDN}/firebase-app.js`),
  import(`${CDN}/firebase-auth.js`),
  import(`${CDN}/firebase-firestore.js`),
]);
const client = createCloudClient({ store, appSDK, authSDK, fsSDK, config: firebaseConfig, allowedEmail: ALLOWED_EMAIL });
export const { init, currentUser, signIn, createAccount, sendVerification, checkVerification, resetPassword, signOut, reloadLibrary } = client;
export { ALLOWED_EMAIL };
