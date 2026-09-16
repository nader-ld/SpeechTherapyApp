/* Firebase adapter. SDKs are injected so auth/sync behavior can be tested without a network. */
export function createCloudClient({ store, appSDK, authSDK, fsSDK, config, allowedEmail, readyTimeoutMs = 4000 }) {
  const { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
    sendEmailVerification, sendPasswordResetEmail, reload, getIdToken, signOut: fbSignOut } = authSDK;
  const { initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
    collection, doc, setDoc, deleteDoc, writeBatch, onSnapshot, getDoc } = fsSDK;
  let auth, db, user = null, generation = 0;
  let unsubs = [];
  let handlers = { onUser() {}, onChange() {}, onError() {} };

  function stopSync() {
    generation++;
    unsubs.forEach((fn) => { try { fn(); } catch { /* already stopped */ } });
    unsubs = [];
    store.setBackend(null);
  }

  function reportError(err, epoch = generation) {
    if (epoch !== generation) return;
    const denied = err?.code === 'permission-denied';
    if (denied) stopSync();
    handlers.onError(denied ? 'This account is not allowed to use this app.' : err?.message || 'Sync failed.', { denied });
  }

  async function applyUser(u) {
    stopSync();
    const epoch = generation;
    user = u;
    store.clearLibrary();
    if (!u) {
      try { store.clearLocal(); } catch (err) { reportError(err, epoch); }
      handlers.onUser(null);
      return;
    }
    if (u.email?.toLowerCase() !== allowedEmail.toLowerCase()) {
      handlers.onUser(u, { denied: true });
      return;
    }
    if (!u.emailVerified) { handlers.onUser(u); return; }
    try { await startSync(u, epoch); }
    catch (err) { reportError(err, epoch); }
    // An old first-snapshot wait must never reopen the app after sign-out.
    if (epoch === generation) handlers.onUser(u);
  }

  function init(h) {
    handlers = { ...handlers, ...h };
    const app = appSDK.initializeApp(config);
    auth = getAuth(app);
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
    onAuthStateChanged(auth, applyUser, (err) => reportError(err));
  }

  function checkEmail(email) {
    const value = String(email || '').trim().toLowerCase();
    if (value !== allowedEmail.toLowerCase()) throw new Error('This email address is not allowed to use this app.');
    return value;
  }

  async function signIn(email, password) {
    try { await signInWithEmailAndPassword(auth, checkEmail(email), password); }
    catch (err) { throw new Error(authMessage(err)); }
  }

  async function createAccount(email, password) {
    try { await createUserWithEmailAndPassword(auth, checkEmail(email), password); }
    catch (err) { throw new Error(authMessage(err)); }
  }

  async function sendVerification() {
    if (!user || user.email?.toLowerCase() !== allowedEmail.toLowerCase()) throw new Error('Sign in first.');
    try { await sendEmailVerification(user); }
    catch (err) { throw new Error(authMessage(err)); }
  }

  async function checkVerification() {
    const u = user;
    const epoch = generation;
    if (!u) throw new Error('Sign in first.');
    try {
      await reload(u);
      if (epoch !== generation) return;
      if (!u.emailVerified) throw new Error('Your email is not verified yet. Open the link in your email, then try again.');
      await getIdToken(u, true); // Firestore rules must see the refreshed email_verified claim.
      if (epoch === generation) await applyUser(u);
    } catch (err) { throw new Error(authMessage(err)); }
  }

  async function resetPassword(email) {
    try { await sendPasswordResetEmail(auth, checkEmail(email)); }
    catch (err) { throw new Error(authMessage(err)); }
  }

  async function signOut() {
    stopSync();
    try { await fbSignOut(auth); }
    catch (err) { await applyUser(auth.currentUser); throw new Error(authMessage(err)); }
  }

  function applyLibrary(snap) {
    if (!snap.exists()) throw new Error('No exercise library has been published yet.');
    const value = snap.data();
    store.loadData(JSON.parse(value.json), value.sourceDocumentUrl);
    handlers.onChange('library');
  }

  async function reloadLibrary() {
    if (!user?.emailVerified || user.email?.toLowerCase() !== allowedEmail.toLowerCase()) throw new Error('Sign in first.');
    const epoch = generation;
    const snap = await getDoc(doc(db, 'private', 'library'));
    if (epoch === generation) applyLibrary(snap);
  }

  async function startSync(u, epoch) {
    // Bind every operation to this user, never to mutable global auth state.
    const col = (name) => collection(db, 'users', u.uid, name);
    const prefs = doc(db, 'users', u.uid, 'meta', 'prefs');
    const report = (promise) => { promise.catch((err) => reportError(err, epoch)); };
    const batched = (ops) => {
      const commits = [];
      // Enqueue every batch immediately. Awaiting a server ack between batches loses
      // the remainder if the app is closed while offline.
      for (let i = 0; i < ops.length; i += 400) {
        const batch = writeBatch(db);
        ops.slice(i, i + 400).forEach((op) => op(batch));
        commits.push(batch.commit());
      }
      return Promise.all(commits);
    };
    const backend = {
      putSession: (s) => report(setDoc(doc(col('sessions'), s.id), s)),
      deleteSession: (id) => report(deleteDoc(doc(col('sessions'), id))),
      deleteSessions: (ids) => report(batched(ids.map((id) => (b) => b.delete(doc(col('sessions'), id))))),
      putPrompt: (exerciseId, text) => report(promptId(exerciseId, text).then((id) => setDoc(doc(col('prompts'), id), {
        exerciseId, text, createdAt: new Date().toISOString(),
      }))),
      removePrompt: (exerciseId, text) => report(promptId(exerciseId, text).then((id) => deleteDoc(doc(col('prompts'), id)))),
      putPrefs: (p) => report(setDoc(prefs, p, { merge: true })),
    };
    const subscribe = (ref, handler) => new Promise((resolve) => {
      unsubs.push(onSnapshot(ref, (snap) => {
        if (epoch !== generation) { resolve(); return; }
        try { handler(snap); }
        catch (err) { reportError(err, epoch); }
        resolve();
      }, (err) => { reportError(err, epoch); resolve(); }));
    });
    const ready = Promise.all([
      subscribe(col('sessions'), (snap) => {
        store.replaceLog(snap.docs.map((d) => d.data()));
        handlers.onChange('log');
      }),
      subscribe(col('prompts'), (snap) => {
        const rows = snap.docs.map((d) => d.data()).filter((r) => typeof r.exerciseId === 'string' && typeof r.text === 'string');
        rows.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
        const items = Object.create(null);
        for (const r of rows) (items[r.exerciseId] ||= []).push(r.text);
        store.replaceCustomItems(items);
        handlers.onChange('prompts');
      }),
      subscribe(doc(db, 'private', 'library'), applyLibrary),
      subscribe(prefs, (snap) => {
        store.replacePrefs(snap.exists() ? snap.data() : { shuffle: false });
        handlers.onChange('prefs');
      }),
    ]);
    let timer;
    await Promise.race([ready, new Promise((resolve) => { timer = setTimeout(resolve, readyTimeoutMs); })]);
    clearTimeout(timer);
    if (epoch === generation) store.setBackend(backend);
    // No legacy migration: this app starts with the signed-in user's Firestore data.
  }

  return { init, currentUser: () => user, signIn, createAccount, sendVerification, checkVerification, resetPassword, signOut, reloadLibrary };
}

/** SHA-256 keeps Firestore IDs bounded without the old 32-bit prompt collisions. */
export async function promptId(exerciseId, text) {
  const bytes = new TextEncoder().encode(JSON.stringify([exerciseId, text]));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}

function authMessage(err) {
  switch (err?.code) {
    case 'auth/operation-not-allowed': return 'Email/password sign-in is not enabled for this app yet.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found': return 'The email or password is incorrect. If this is your first visit, create your account.';
    case 'auth/email-already-in-use': return 'This account already exists. Sign in or reset your password.';
    case 'auth/invalid-email': return 'Enter a valid email address.';
    case 'auth/weak-password': return 'Choose a password with at least 6 characters.';
    case 'auth/user-disabled': return 'This account has been disabled.';
    case 'auth/too-many-requests': return 'Too many attempts. Please wait a little and try again.';
    case 'auth/network-request-failed': return 'No connection. Signing in needs an internet connection.';
    default: return err?.message || 'Sign-in failed.';
  }
}
