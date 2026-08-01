/**
 * HAMKKE Firebase Sync Module
 * - Firestore 離線持久化 + 即時同步
 * - 匿名登入
 * - 旅程分享（共編）
 * 
 * 使用前請先到 Firebase Console 建立專案並填入下方 config。
 */

// ============================================================
// 🔧 Firebase 設定 — 請替換為你自己的 Firebase 專案資訊
// ============================================================
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyB2zfoFLh-OTe4ERxZx8wPftHHORIINwfk",
  authDomain: "sivanchenkorea2026.firebaseapp.com",
  projectId: "sivanchenkorea2026",
  storageBucket: "sivanchenkorea2026.firebasestorage.app",
  messagingSenderId: "229410400172",
  appId: "1:229410400172:web:e28bab6e7f317c5210fc09"
};

// ============================================================
// 初始化
// ============================================================
let db = null;
let auth = null;
let currentUser = null;
let _initialized = false;
let _onlineMode = false;

/**
 * 初始化 Firebase（含離線持久化）
 * @returns {Promise<boolean>} 是否初始化成功
 */
async function initFirebase() {
  if (_initialized) return _onlineMode;

  // 檢查 Firebase SDK 是否已載入
  if (typeof firebase === 'undefined') {
    console.warn('[Firebase] SDK 未載入，使用離線模式');
    _initialized = true;
    _onlineMode = false;
    return false;
  }

  // 檢查是否已填入真實 config
  if (FIREBASE_CONFIG.apiKey === 'YOUR_API_KEY') {
    console.warn('[Firebase] 尚未設定 Firebase config，使用離線模式');
    _initialized = true;
    _onlineMode = false;
    return false;
  }

  try {
    // 初始化 Firebase App
    if (!firebase.apps.length) {
      firebase.initializeApp(FIREBASE_CONFIG);
    }

    // 初始化 Auth
    auth = firebase.auth();

    // 初始化 Firestore
    db = firebase.firestore();

    // 啟用離線持久化（IndexedDB）
    // 注意：這必須在任何 Firestore 讀寫之前呼叫
    try {
      await db.enablePersistence({ synchronizeTabs: true });
      console.log('[Firebase] 離線持久化已啟用');
    } catch (err) {
      if (err.code === 'failed-precondition') {
        // 多個分頁同時開啟時，只有一個能啟用持久化
        console.warn('[Firebase] 持久化失敗：多分頁開啟中，僅第一個分頁支援離線快取');
      } else if (err.code === 'unimplemented') {
        console.warn('[Firebase] 此瀏覽器不支援離線持久化');
      }
    }

    // 匿名登入
    await signInAnonymously();

    _initialized = true;
    _onlineMode = true;
    console.log('[Firebase] 初始化完成，線上模式');
    return true;
  } catch (err) {
    console.error('[Firebase] 初始化失敗:', err);
    _initialized = true;
    _onlineMode = false;
    return false;
  }
}

// ============================================================
// 驗證
// ============================================================
async function signInAnonymously() {
  try {
    const result = await auth.signInAnonymously();
    currentUser = result.user;
    console.log('[Firebase] 匿名登入成功, uid:', currentUser.uid);
    return currentUser;
  } catch (err) {
    console.error('[Firebase] 匿名登入失敗:', err);
    return null;
  }
}

function getUid() {
  return currentUser ? currentUser.uid : null;
}

// ============================================================
// Firestore 旅程操作
// ============================================================

/**
 * 建立新的雲端旅程
 * @param {Object} tripData - { trip, plans, expenses }
 * @returns {Promise<string|null>} tripId 或 null
 */
async function createCloudTrip(tripData) {
  if (!_onlineMode || !db) return null;
  const uid = getUid();
  if (!uid) return null;

  try {
    const tripRef = db.collection('trips').doc();
    const tripId = tripRef.id;

    // 寫入主文件
    await tripRef.set({
      ...tripData.trip,
      members: [uid],
      createdBy: uid,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    // 批次寫入 plans
    if (tripData.plans && tripData.plans.length) {
      const batch = db.batch();
      tripData.plans.forEach(plan => {
        const planRef = tripRef.collection('plans').doc(plan.id);
        batch.set(planRef, { ...plan, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
      });
      await batch.commit();
    }

    // 批次寫入 expenses
    if (tripData.expenses && tripData.expenses.length) {
      const batch = db.batch();
      tripData.expenses.forEach(exp => {
        const expRef = tripRef.collection('expenses').doc(exp.id);
        batch.set(expRef, { ...exp, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
      });
      await batch.commit();
    }

    console.log('[Firebase] 雲端旅程已建立:', tripId);
    return tripId;
  } catch (err) {
    console.error('[Firebase] 建立雲端旅程失敗:', err);
    return null;
  }
}

/**
 * 加入已存在的雲端旅程（透過分享碼）
 * @param {string} tripId
 * @returns {Promise<Object|null>} 旅程資料或 null
 */
async function joinCloudTrip(tripId) {
  if (!_onlineMode || !db) return null;
  const uid = getUid();
  if (!uid) return null;

  try {
    const tripRef = db.collection('trips').doc(tripId);
    const doc = await tripRef.get();

    if (!doc.exists) {
      console.warn('[Firebase] 找不到旅程:', tripId);
      return null;
    }

    // 把自己加入 members
    const data = doc.data();
    if (!data.members.includes(uid)) {
      await tripRef.update({
        members: firebase.firestore.FieldValue.arrayUnion(uid),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      // 等待 members 更新確認（避免後續 subcollection 寫入被 rules 擋住）
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // 讀取 plans 和 expenses
    const plansSnap = await tripRef.collection('plans').get();
    const expSnap = await tripRef.collection('expenses').get();

    const plans = [];
    plansSnap.forEach(d => plans.push({ id: d.id, ...d.data() }));

    const expenses = [];
    expSnap.forEach(d => expenses.push({ id: d.id, ...d.data() }));

    // 清理 Firestore metadata 欄位
    const trip = { ...data };
    delete trip.members;
    delete trip.createdBy;
    delete trip.createdAt;
    delete trip.updatedAt;

    console.log('[Firebase] 已加入旅程:', tripId);
    return { trip, plans, expenses };
  } catch (err) {
    console.error('[Firebase] 加入旅程失敗:', err);
    return null;
  }
}

/**
 * 儲存整份旅程 metadata（trip 主文件）
 */
async function saveTripMeta(tripId, tripMeta) {
  if (!_onlineMode || !db || !tripId) return;
  try {
    // 不要覆蓋 members/createdBy 等系統欄位
    const cleanMeta = { ...tripMeta };
    delete cleanMeta.members;
    delete cleanMeta.createdBy;
    delete cleanMeta.createdAt;
    delete cleanMeta.updatedAt;
    await db.collection('trips').doc(tripId).update({
      ...cleanMeta,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (err) {
    console.error('[Firebase] 儲存旅程 meta 失敗:', err);
  }
}

/**
 * 儲存單筆 plan
 * @returns {Promise<boolean>} 是否成功
 */
async function savePlanDoc(tripId, plan) {
  if (!_onlineMode || !db || !tripId) return false;
  try {
    // 清除非序列化欄位
    const cleanPlan = { ...plan };
    delete cleanPlan.updatedAt;
    await db.collection('trips').doc(tripId)
      .collection('plans').doc(plan.id)
      .set({ ...cleanPlan, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
    return true;
  } catch (err) {
    console.error('[Firebase] 儲存 plan 失敗:', err);
    return false;
  }
}

/**
 * 刪除單筆 plan
 */
async function deletePlanDoc(tripId, planId) {
  if (!_onlineMode || !db || !tripId) return;
  try {
    await db.collection('trips').doc(tripId)
      .collection('plans').doc(planId).delete();
  } catch (err) {
    console.error('[Firebase] 刪除 plan 失敗:', err);
  }
}

/**
 * 儲存單筆 expense
 * @returns {Promise<boolean>} 是否成功
 */
async function saveExpenseDoc(tripId, expense) {
  if (!_onlineMode || !db || !tripId) return false;
  try {
    const cleanExpense = { ...expense };
    delete cleanExpense.updatedAt;
    await db.collection('trips').doc(tripId)
      .collection('expenses').doc(expense.id)
      .set({ ...cleanExpense, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
    return true;
  } catch (err) {
    console.error('[Firebase] 儲存 expense 失敗:', err);
    return false;
  }
}

/**
 * 刪除單筆 expense
 */
async function deleteExpenseDoc(tripId, expenseId) {
  if (!_onlineMode || !db || !tripId) return;
  try {
    await db.collection('trips').doc(tripId)
      .collection('expenses').doc(expenseId).delete();
  } catch (err) {
    console.error('[Firebase] 刪除 expense 失敗:', err);
  }
}

// ============================================================
// 即時監聽（Real-time Sync）
// ============================================================

let _unsubTrip = null;
let _unsubPlans = null;
let _unsubExpenses = null;

/**
 * 開始監聽旅程的即時變更
 * @param {string} tripId
 * @param {Object} callbacks - { onTripUpdate, onPlansUpdate, onExpensesUpdate }
 * @returns {Function} unsubscribe function
 */
function listenToTrip(tripId, callbacks) {
  if (!_onlineMode || !db || !tripId) return () => {};

  // 先取消舊的監聽
  stopListening();

  const tripRef = db.collection('trips').doc(tripId);

  // 監聽 trip metadata
  _unsubTrip = tripRef.onSnapshot((doc) => {
    if (doc.exists && callbacks.onTripUpdate) {
      const data = { ...doc.data() };
      delete data.members;
      delete data.createdBy;
      delete data.createdAt;
      delete data.updatedAt;
      callbacks.onTripUpdate(data);
    }
  }, (err) => console.error('[Firebase] trip 監聽錯誤:', err));

  // 監聽 plans subcollection
  _unsubPlans = tripRef.collection('plans')
    .onSnapshot((snapshot) => {
      if (callbacks.onPlansUpdate) {
        const plans = [];
        snapshot.forEach(doc => plans.push({ id: doc.id, ...doc.data() }));
        // 移除 Firestore metadata
        plans.forEach(p => delete p.updatedAt);
        callbacks.onPlansUpdate(plans);
      }
    }, (err) => console.error('[Firebase] plans 監聯錯誤:', err));

  // 監聽 expenses subcollection
  _unsubExpenses = tripRef.collection('expenses')
    .onSnapshot((snapshot) => {
      if (callbacks.onExpensesUpdate) {
        const expenses = [];
        snapshot.forEach(doc => expenses.push({ id: doc.id, ...doc.data() }));
        expenses.forEach(e => delete e.updatedAt);
        callbacks.onExpensesUpdate(expenses);
      }
    }, (err) => console.error('[Firebase] expenses 監聽錯誤:', err));

  return stopListening;
}

function stopListening() {
  if (_unsubTrip) { _unsubTrip(); _unsubTrip = null; }
  if (_unsubPlans) { _unsubPlans(); _unsubPlans = null; }
  if (_unsubExpenses) { _unsubExpenses(); _unsubExpenses = null; }
}

// ============================================================
// 工具函式
// ============================================================

function isOnlineMode() {
  return _onlineMode;
}

function isFirebaseReady() {
  return _initialized && _onlineMode && db !== null;
}

/**
 * 產生分享連結
 */
function generateShareUrl(tripId) {
  return window.location.origin + window.location.pathname + '?trip=' + tripId;
}

/**
 * 從 URL 解析 trip ID
 */
function getTripIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('trip') || null;
}

// ============================================================
// 匯出（掛到 window 供 Vue app 使用）
// ============================================================
window.HamkkeFirebase = {
  init: initFirebase,
  getUid,
  isOnlineMode,
  isFirebaseReady,
  createCloudTrip,
  joinCloudTrip,
  saveTripMeta,
  savePlanDoc,
  deletePlanDoc,
  saveExpenseDoc,
  deleteExpenseDoc,
  listenToTrip,
  stopListening,
  generateShareUrl,
  getTripIdFromUrl
};
