/* ============================================================
   ChatWave – app.js  (v2.0)
   منطق التطبيق الكامل | Firebase Firestore + Storage + Auth
   ============================================================ */

'use strict';

/* ══════════════════════ الحالة العامة ══════════════════════ */
let FB            = null;   // Firebase APIs
let currentUser   = null;   // بيانات المستخدم الحالي
let currentChatId = null;   // معرف المحادثة المفتوحة
let currentPartner= null;   // بيانات المستخدم الآخر
let messagesUnsub = null;   // إلغاء الاشتراك من الرسائل
let chatsUnsub    = null;   // إلغاء الاشتراك من المحادثات
let typingTimer   = null;   // مؤقت مؤشر الكتابة
let pendingImageFile = null; // الصورة المنتظرة للإرسال
let isMobile      = window.innerWidth <= 768;
let soundEnabled  = true;   // إعداد الصوت
let typingEnabled = true;   // إعداد مؤشر الكتابة
let readReceiptsEnabled = true; // إيصالات القراءة
let partnerOnlineUnsub = null; // مراقبة حالة الشريك

// إحصائيات
let totalMsgsSent = parseInt(localStorage.getItem('cw_msgs_sent') || '0');

/* ══════════════════════════════════════════════════════
   🔥 تهيئة Firebase
══════════════════════════════════════════════════════ */
window.addEventListener('DOMContentLoaded', () => {
  const interval = setInterval(() => {
    if (window._firebase) {
      FB = window._firebase;
      clearInterval(interval);
      loadSettings();
      initApp();
    }
  }, 80);
});

function loadSettings() {
  soundEnabled        = localStorage.getItem('cw_sound') !== 'false';
  typingEnabled       = localStorage.getItem('cw_typing') !== 'false';
  readReceiptsEnabled = localStorage.getItem('cw_read_receipts') !== 'false';
  const isDark        = localStorage.getItem('cw_theme') !== 'light';
  if (!isDark) document.body.classList.add('light-mode');

  // تطبيق إعدادات الواجهة
  const el = document.getElementById('toggle-sound');
  if (el) el.checked = soundEnabled;
  const el2 = document.getElementById('toggle-typing');
  if (el2) el2.checked = typingEnabled;
  const el3 = document.getElementById('toggle-read-receipts');
  if (el3) el3.checked = readReceiptsEnabled;
}

/* ══════════════════════════════════════════════════════
   🚀 تهيئة التطبيق
══════════════════════════════════════════════════════ */
function initApp() {
  FB.onAuthStateChanged(FB.auth, async (user) => {
    if (user) {
      const userData = await getUserData(user.uid);
      if (userData && userData.name) {
        currentUser = { uid: user.uid, ...userData };
        showApp();
      } else {
        showLogin();
      }
    } else {
      showLogin();
    }
  });

  // تتبع حجم النافذة
  window.addEventListener('resize', () => {
    isMobile = window.innerWidth <= 768;
  });

  // إغلاق Emoji Picker عند الضغط خارجه
  document.addEventListener('click', (e) => {
    const picker  = document.getElementById('emoji-picker');
    const emojiBtn = document.querySelector('.emoji-btn');
    if (picker && !picker.contains(e.target) && e.target !== emojiBtn && !emojiBtn?.contains(e.target)) {
      picker.style.display = 'none';
    }
  });

  // Escape يغلق كل شيء
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeSettings();
      closeNewChatModal();
      closeImageViewer();
      closePartnerProfile();
      closeConfirmModal();
      const picker = document.getElementById('emoji-picker');
      if (picker) picker.style.display = 'none';
      cancelImagePreview();
    }
  });

  initEmojiPicker();
}

/* ══════════════════════════════════════════════════════
   🔐 تسجيل الدخول / الخروج
══════════════════════════════════════════════════════ */
async function handleLogin() {
  const name  = document.getElementById('login-name').value.trim();
  const phone = document.getElementById('login-phone').value.trim();
  const bio   = document.getElementById('login-bio').value.trim() || 'متاح للمحادثة 💬';

  if (!name)  { showToast('الرجاء إدخال اسمك ⚠️', 'error'); return; }
  if (!phone) { showToast('الرجاء إدخال رقم الهاتف ⚠️', 'error'); return; }
  if (name.length < 2)  { showToast('الاسم قصير جداً', 'error'); return; }

  const btn = document.getElementById('login-btn');
  btn.disabled = true;
  btn.innerHTML = '<div class="upload-spinner"></div><span>جارٍ التحميل...</span>';
  showTopLoader(true);

  try {
    const cred = await FB.signInAnonymously(FB.auth);
    const uid  = cred.user.uid;

    const avatarUrl = generateAvatar(name, '25D366');

    const userData = {
      uid,
      name,
      phone,
      bio,
      avatar:    avatarUrl,
      lastSeen:  FB.serverTimestamp(),
      createdAt: FB.serverTimestamp(),
      online:    true,
      msgsSent:  0,
    };

    await FB.setDoc(FB.doc(FB.db, 'users', uid), userData);

    currentUser = { uid, name, phone, bio, avatar: avatarUrl };
    showApp();
    showToast(`أهلاً بك ${name}! 🎉`, 'success');
  } catch (err) {
    console.error('Login error:', err);
    showToast('حدث خطأ. تأكد من إعدادات Firebase ❌', 'error');
    btn.disabled = false;
    btn.innerHTML = '<span class="btn-text">ابدأ المحادثة</span><svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M5 12H19M12 5l7 7-7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  } finally {
    showTopLoader(false);
  }
}

async function handleLogout() {
  showConfirmModal('هل تريد تسجيل الخروج من ChatWave؟', async () => {
    try {
      if (currentUser) {
        await FB.updateDoc(FB.doc(FB.db, 'users', currentUser.uid), {
          online: false,
          lastSeen: FB.serverTimestamp()
        }).catch(() => {});
      }
      cleanupListeners();
      await FB.signOut(FB.auth);
      currentUser   = null;
      currentChatId = null;
      currentPartner= null;
      showLogin();
      showToast('تم تسجيل الخروج بنجاح 👋');
    } catch (err) {
      showToast('خطأ في تسجيل الخروج', 'error');
    }
  });
}

function cleanupListeners() {
  if (messagesUnsub)    messagesUnsub();
  if (chatsUnsub)       chatsUnsub();
  if (partnerOnlineUnsub) partnerOnlineUnsub();
  messagesUnsub = chatsUnsub = partnerOnlineUnsub = null;
}

/* ══════════════════════════════════════════════════════
   📋 بيانات المستخدم
══════════════════════════════════════════════════════ */
async function getUserData(uid) {
  try {
    const snap = await FB.getDoc(FB.doc(FB.db, 'users', uid));
    return snap.exists() ? snap.data() : null;
  } catch { return null; }
}

/* ══════════════════════════════════════════════════════
   🖥️ إظهار الشاشات
══════════════════════════════════════════════════════ */
function showLogin() {
  document.getElementById('login-screen').classList.add('active');
  document.getElementById('app-screen').classList.remove('active');
  document.getElementById('app-screen').style.display = 'none';
  // إعادة تفعيل زر تسجيل الدخول
  const btn = document.getElementById('login-btn');
  if (btn) {
    btn.disabled = false;
    btn.innerHTML = '<span class="btn-text">ابدأ المحادثة</span><svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M5 12H19M12 5l7 7-7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }
}

function showApp() {
  document.getElementById('login-screen').classList.remove('active');
  const appScreen = document.getElementById('app-screen');
  appScreen.style.display = 'flex';
  appScreen.classList.add('active');

  updateSidebarUI();
  loadChats();
  loadContacts();
  updatePresence();
  updateSettingsStats();
}

function updateSidebarUI() {
  if (!currentUser) return;
  setText('sidebar-name', currentUser.name);
  setAttr('sidebar-avatar', 'src', currentUser.avatar);
  setText('sidebar-status', '🟢 متصل الآن');
}

/* ══════════════════════════════════════════════════════
   💬 المحادثات
══════════════════════════════════════════════════════ */
function loadChats() {
  if (!currentUser) return;
  const q = FB.query(
    FB.collection(FB.db, 'chats'),
    FB.orderBy('updatedAt', 'desc')
  );

  if (chatsUnsub) chatsUnsub();
  chatsUnsub = FB.onSnapshot(q, (snap) => {
    const myChats = snap.docs.filter(d => {
      const data = d.data();
      return data.members && data.members.includes(currentUser.uid);
    });
    renderChatsList(myChats);
    updateSettingsStats(myChats.length);
  }, (err) => {
    console.error('Chats snapshot error:', err);
  });
}

function renderChatsList(docs) {
  const container = document.getElementById('chats-list');

  if (!docs.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">💬</div>
        <p>لا توجد محادثات بعد<br>ابدأ محادثة جديدة مع أصدقائك!</p>
      </div>`;
    return;
  }

  container.innerHTML = '';
  docs.forEach(d => {
    const data      = d.data();
    const partnerId = data.members.find(m => m !== currentUser.uid);
    const names     = data.memberNames   || {};
    const avatars   = data.memberAvatars || {};
    const partnerName   = names[partnerId]   || 'مستخدم';
    const partnerAvatar = avatars[partnerId] || generateAvatar(partnerName);

    const lastMsg  = data.lastMessage || '';
    const lastTime = data.updatedAt ? formatTime(data.updatedAt.toDate()) : '';
    const unread   = data.unreadCount && data.unreadCount[currentUser.uid] > 0;
    const count    = data.unreadCount ? (data.unreadCount[currentUser.uid] || 0) : 0;
    const isOnline = data.memberOnline ? data.memberOnline[partnerId] : false;

    const item = document.createElement('div');
    item.className = `chat-item ${d.id === currentChatId ? 'active' : ''}`;
    item.dataset.chatId = d.id;
    item.innerHTML = `
      <div class="chat-item-avatar">
        <img src="${escapeAttr(partnerAvatar)}" alt="${escapeAttr(partnerName)}"
             onerror="this.src='${generateAvatar(partnerName)}'"/>
        ${isOnline ? '<div class="chat-item-online"></div>' : ''}
      </div>
      <div class="chat-item-content">
        <div class="chat-item-top">
          <span class="chat-item-name">${escapeHtml(partnerName)}</span>
          <span class="chat-item-time">${escapeHtml(lastTime)}</span>
        </div>
        <div class="chat-item-preview ${unread ? 'unread' : ''}">
          ${escapeHtml(lastMsg || 'ابدأ المحادثة...')}
        </div>
      </div>
      ${count > 0 ? `<div class="unread-badge">${count > 99 ? '99+' : count}</div>` : ''}
    `;
    item.addEventListener('click', () => openChat(d.id, {
      uid: partnerId, name: partnerName, avatar: partnerAvatar
    }));
    container.appendChild(item);
  });
}

/* ══════════════════════════════════════════════════════
   👥 قائمة المستخدمين
══════════════════════════════════════════════════════ */
async function loadContacts() {
  const container = document.getElementById('contacts-list');
  container.innerHTML = '<div class="loading-chats"><div class="skeleton-item" style="--d:0s"></div><div class="skeleton-item" style="--d:.1s"></div></div>';

  try {
    const snap = await FB.getDocs(FB.collection(FB.db, 'users'));
    container.innerHTML = '';

    const users = [];
    snap.forEach(d => {
      if (d.id !== currentUser.uid) users.push({ uid: d.id, ...d.data() });
    });

    if (!users.length) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">👥</div><p>لا يوجد مستخدمون آخرون بعد</p></div>';
      return;
    }

    users.forEach(user => {
      const item = document.createElement('div');
      item.className = 'contact-item';
      const isOnline = user.online || false;
      item.innerHTML = `
        <img src="${escapeAttr(user.avatar || generateAvatar(user.name || 'U'))}"
             alt="${escapeAttr(user.name || 'مستخدم')}"
             onerror="this.src='${generateAvatar(user.name || 'U')}'"/>
        <div class="contact-info">
          <div class="contact-name">${escapeHtml(user.name || 'مستخدم')}</div>
          <div class="contact-bio">${escapeHtml(user.bio || 'مستخدم ChatWave')}</div>
        </div>
        <span class="contact-status-badge ${isOnline ? 'online' : 'offline'}">
          ${isOnline ? '🟢 متصل' : '⚫ غير متصل'}
        </span>
      `;
      item.addEventListener('click', () => startChatWithUser(user));
      container.appendChild(item);
    });
  } catch (err) {
    console.error('Load contacts error:', err);
    container.innerHTML = '<div class="empty-state"><p>خطأ في تحميل المستخدمين</p></div>';
  }
}

async function startChatWithUser(user) {
  // البحث عن محادثة موجودة
  const chatId = buildChatId(currentUser.uid, user.uid);
  await ensureChatExists(chatId, user);
  openChat(chatId, user);
  switchTab('chats');
}

function buildChatId(uid1, uid2) {
  return [uid1, uid2].sort().join('_');
}

async function ensureChatExists(chatId, partner) {
  const chatRef = FB.doc(FB.db, 'chats', chatId);
  const snap    = await FB.getDoc(chatRef);

  if (!snap.exists()) {
    await FB.setDoc(chatRef, {
      members: [currentUser.uid, partner.uid],
      memberNames: {
        [currentUser.uid]: currentUser.name,
        [partner.uid]:     partner.name
      },
      memberAvatars: {
        [currentUser.uid]: currentUser.avatar,
        [partner.uid]:     partner.avatar || generateAvatar(partner.name)
      },
      memberOnline: {
        [currentUser.uid]: true,
        [partner.uid]:     partner.online || false
      },
      lastMessage:  '',
      updatedAt:    FB.serverTimestamp(),
      createdAt:    FB.serverTimestamp(),
      unreadCount:  { [currentUser.uid]: 0, [partner.uid]: 0 }
    });
  }
}

/* ══════════════════════════════════════════════════════
   🔍 فلتر البحث
══════════════════════════════════════════════════════ */
function filterChats(query) {
  const clearBtn = document.getElementById('search-clear');
  if (clearBtn) clearBtn.style.display = query ? 'block' : 'none';

  const items = document.querySelectorAll('.chat-item');
  let found = 0;
  items.forEach(item => {
    const name = item.querySelector('.chat-item-name')?.textContent || '';
    const preview = item.querySelector('.chat-item-preview')?.textContent || '';
    const match = name.includes(query) || preview.includes(query);
    item.style.display = match ? 'flex' : 'none';
    if (match) found++;
  });

  // رسالة "لا توجد نتائج"
  const container = document.getElementById('chats-list');
  const existingMsg = container.querySelector('.no-results');
  if (!found && query) {
    if (!existingMsg) {
      const msg = document.createElement('div');
      msg.className = 'empty-state no-results';
      msg.innerHTML = `<div class="empty-icon">🔍</div><p>لا توجد نتائج لـ "${escapeHtml(query)}"</p>`;
      container.appendChild(msg);
    }
  } else if (existingMsg) {
    existingMsg.remove();
  }
}

function clearSearch() {
  const input = document.getElementById('search-input');
  if (input) { input.value = ''; filterChats(''); }
}

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  const activeBtn = document.querySelector(`[data-tab="${tab}"]`);
  if (activeBtn) activeBtn.classList.add('active');

  document.getElementById('chats-list').style.display   = tab === 'chats'    ? 'block' : 'none';
  document.getElementById('contacts-list').style.display = tab === 'contacts' ? 'block' : 'none';

  if (tab === 'contacts') loadContacts();
}

/* ══════════════════════════════════════════════════════
   ➕ إنشاء محادثة جديدة
══════════════════════════════════════════════════════ */
function startNewChat() {
  document.getElementById('new-chat-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('new-chat-name')?.focus(), 100);
}

function closeNewChatModal() {
  document.getElementById('new-chat-modal').style.display = 'none';
  const n = document.getElementById('new-chat-name');
  const p = document.getElementById('new-chat-phone');
  if (n) n.value = '';
  if (p) p.value = '';
}

async function createNewChat() {
  const name  = document.getElementById('new-chat-name').value.trim();
  const phone = document.getElementById('new-chat-phone').value.trim();

  if (!name || !phone) { showToast('أدخل الاسم ورقم الهاتف ⚠️', 'error'); return; }

  showTopLoader(true);

  try {
    // البحث عن مستخدم بنفس الهاتف
    const usersSnap = await FB.getDocs(FB.collection(FB.db, 'users'));
    let partnerData = null;

    usersSnap.forEach(d => {
      const data = d.data();
      if (data.phone === phone && d.id !== currentUser.uid) {
        partnerData = { uid: d.id, ...data };
      }
    });

    // إذا لم يُوجد بعد: إنشاء مستخدم وهمي للتجريب
    if (!partnerData) {
      const fakeUid  = 'demo_' + phone.replace(/\D/g, '');
      const fakeAvatar = generateAvatar(name);
      partnerData = {
        uid:    fakeUid,
        name,
        phone,
        bio:    'مستخدم ChatWave',
        avatar: fakeAvatar,
        online: false
      };
      // حفظ المستخدم الوهمي
      await FB.setDoc(FB.doc(FB.db, 'users', fakeUid), {
        ...partnerData,
        createdAt: FB.serverTimestamp(),
        lastSeen:  FB.serverTimestamp()
      });
    }

    const chatId = buildChatId(currentUser.uid, partnerData.uid);
    await ensureChatExists(chatId, partnerData);

    closeNewChatModal();
    openChat(chatId, partnerData);
    showToast(`تم إنشاء محادثة مع ${name} ✅`, 'success');
  } catch (err) {
    console.error('Create chat error:', err);
    showToast('خطأ في إنشاء المحادثة ❌', 'error');
  } finally {
    showTopLoader(false);
  }
}

/* ══════════════════════════════════════════════════════
   📂 فتح / إغلاق المحادثة
══════════════════════════════════════════════════════ */
async function openChat(chatId, partner) {
  // إلغاء اشتراك المحادثة السابقة
  if (messagesUnsub) messagesUnsub();
  if (partnerOnlineUnsub) partnerOnlineUnsub();

  currentChatId  = chatId;
  currentPartner = partner;

  // تحديث الواجهة
  document.getElementById('welcome-state').style.display = 'none';
  document.getElementById('active-chat').style.display   = 'flex';

  setText('chat-partner-name', partner.name);
  setAttr('chat-partner-avatar', 'src', partner.avatar || generateAvatar(partner.name));

  // إظهار منطقة الدردشة على الموبايل
  if (isMobile) {
    document.getElementById('sidebar').classList.add('hidden');
    document.getElementById('chat-area').classList.add('visible');
  }

  // تحديد المحادثة النشطة في القائمة
  document.querySelectorAll('.chat-item').forEach(el => {
    el.classList.toggle('active', el.dataset.chatId === chatId);
  });

  // مسح الرسائل
  document.getElementById('messages-area').innerHTML = '';

  // مراقبة حالة الشريك
  watchPartnerOnline(partner.uid);

  // تحميل الرسائل
  loadMessages(chatId);

  // إعادة تعيين عداد القراءة
  try {
    await FB.updateDoc(FB.doc(FB.db, 'chats', chatId), {
      [`unreadCount.${currentUser.uid}`]: 0
    });
  } catch (e) {}

  // تحميل بيانات الشريك المحدثة
  try {
    const partnerDoc = await FB.getDoc(FB.doc(FB.db, 'users', partner.uid));
    if (partnerDoc.exists()) {
      const pd = partnerDoc.data();
      currentPartner = { uid: partner.uid, ...pd };
      updatePartnerStatus(pd.online, pd.lastSeen);
    }
  } catch (e) {}

  // التركيز على حقل الرسالة
  setTimeout(() => document.getElementById('message-input')?.focus(), 200);
}

function closeChat() {
  if (isMobile) {
    document.getElementById('sidebar').classList.remove('hidden');
    document.getElementById('chat-area').classList.remove('visible');
  }
  document.getElementById('welcome-state').style.display = '';
  document.getElementById('active-chat').style.display   = 'none';
  currentChatId  = null;
  currentPartner = null;
  if (messagesUnsub)    messagesUnsub();
  if (partnerOnlineUnsub) partnerOnlineUnsub();
  // إزالة التحديد
  document.querySelectorAll('.chat-item').forEach(el => el.classList.remove('active'));
}

function watchPartnerOnline(partnerUid) {
  const userRef = FB.doc(FB.db, 'users', partnerUid);
  if (partnerOnlineUnsub) partnerOnlineUnsub();
  partnerOnlineUnsub = FB.onSnapshot(userRef, (snap) => {
    if (snap.exists()) {
      const data = snap.data();
      updatePartnerStatus(data.online, data.lastSeen);
    }
  });
}

function updatePartnerStatus(isOnline, lastSeen) {
  const dot      = document.getElementById('partner-online-dot');
  const statusEl = document.getElementById('partner-status-text');
  const wrap     = document.getElementById('chat-partner-status');

  if (!statusEl) return;

  if (isOnline) {
    if (dot) dot.style.display = 'block';
    statusEl.textContent = 'متصل الآن';
    wrap?.classList.remove('offline');
  } else {
    if (dot) dot.style.display = 'none';
    const time = lastSeen ? formatLastSeen(lastSeen.toDate?.() || new Date(lastSeen)) : '';
    statusEl.textContent = time ? `آخر ظهور: ${time}` : 'غير متصل';
    wrap?.classList.add('offline');
  }
}

function formatLastSeen(date) {
  if (!date) return '';
  const now  = new Date();
  const diff = (now - date) / 1000;
  if (diff < 60)    return 'منذ لحظات';
  if (diff < 3600)  return `منذ ${Math.floor(diff / 60)} دقيقة`;
  if (diff < 86400) return `اليوم الساعة ${formatTime(date)}`;
  return formatDate(date);
}

/* ══════════════════════════════════════════════════════
   📩 تحميل وعرض الرسائل
══════════════════════════════════════════════════════ */
function loadMessages(chatId) {
  const msgsRef = FB.collection(FB.db, 'chats', chatId, 'messages');
  const q = FB.query(msgsRef, FB.orderBy('createdAt', 'asc'));

  messagesUnsub = FB.onSnapshot(q, (snap) => {
    const area = document.getElementById('messages-area');
    if (!area) return;

    area.innerHTML = '';
    let lastDateStr = '';

    snap.docs.forEach(d => {
      const data = d.data();
      const msgDate = data.createdAt ? data.createdAt.toDate?.() || new Date() : new Date();
      const dateStr = formatDate(msgDate);

      // فاصل التاريخ
      if (dateStr !== lastDateStr) {
        const sep = document.createElement('div');
        sep.className = 'date-separator';
        sep.innerHTML = `<span>${escapeHtml(dateStr)}</span>`;
        area.appendChild(sep);
        lastDateStr = dateStr;
      }

      const isMe = data.senderId === currentUser.uid;
      const msgEl = buildMessageElement(d.id, data, isMe, msgDate);
      area.appendChild(msgEl);
    });

    // التمرير لآخر رسالة
    scrollToBottom(area);

    // تمييز الرسائل إذا كان البحث نشطاً
    const searchVal = document.getElementById('in-chat-search-input')?.value;
    if (searchVal) searchMessages(searchVal);

  }, (err) => {
    console.error('Messages snapshot error:', err);
  });
}

function buildMessageElement(id, data, isMe, date) {
  const wrap = document.createElement('div');
  wrap.className = `message-wrap ${isMe ? 'outgoing' : 'incoming'}`;
  wrap.dataset.msgId = id;

  const time = formatTime(date);

  let contentHtml = '';

  if (data.type === 'image') {
    const caption = data.caption || data.text || '';
    contentHtml = `
      <div class="message-image" onclick="openImageViewer('${escapeAttr(data.imageUrl)}', '${escapeAttr(caption)}')">
        <img src="${escapeAttr(data.imageUrl)}" alt="صورة" loading="lazy"
             onerror="this.parentElement.innerHTML='<p style=padding:10px;color:var(--text-secondary)>⚠️ فشل تحميل الصورة</p>'"/>
      </div>
      ${caption ? `<div class="message-image-caption">${escapeHtml(caption)}</div>` : ''}
    `;
  } else {
    const text = linkifyText(escapeHtml(data.text || ''));
    contentHtml = `<div class="message-text">${text}</div>`;
  }

  // حالة القراءة (للرسائل الصادرة فقط)
  let readReceiptHtml = '';
  if (isMe && readReceiptsEnabled) {
    const status = data.readBy && data.readBy.includes(currentPartner?.uid) ? 'read'
                 : data.delivered ? 'delivered' : 'sent';
    const icons  = { sent: '✓', delivered: '✓✓', read: '✓✓' };
    readReceiptHtml = `<span class="read-receipt ${status}" title="${status === 'read' ? 'مقروءة' : status === 'delivered' ? 'مستلمة' : 'مرسلة'}">${icons[status]}</span>`;
  }

  wrap.innerHTML = `
    <div class="message-bubble">
      ${contentHtml}
      <div class="message-meta">
        <span class="message-time">${escapeHtml(time)}</span>
        ${readReceiptHtml}
      </div>
    </div>
  `;

  return wrap;
}

function scrollToBottom(area, smooth = true) {
  setTimeout(() => {
    area.scrollTo({ top: area.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, 60);
}

/* ══════════════════════════════════════════════════════
   ✏️ إرسال الرسائل النصية
══════════════════════════════════════════════════════ */
async function sendMessage() {
  if (!currentChatId || !currentUser) return;

  const input = document.getElementById('message-input');
  const text  = input.value.trim();

  if (!text) return;

  input.value = '';
  autoResize(input);
  resetTyping();

  // إضافة رسالة مؤقتة للواجهة فوراً
  const tempId = 'temp_' + Date.now();
  const area   = document.getElementById('messages-area');
  const tempEl = buildTempMessage(text);
  tempEl.dataset.tempId = tempId;
  area.appendChild(tempEl);
  scrollToBottom(area);

  playSound('send');

  try {
    const msgsRef = FB.collection(FB.db, 'chats', currentChatId, 'messages');
    const msgRef  = await FB.addDoc(msgsRef, {
      type:       'text',
      text,
      senderId:   currentUser.uid,
      senderName: currentUser.name,
      createdAt:  FB.serverTimestamp(),
      delivered:  false,
      readBy:     []
    });

    // تحديث آخر رسالة في المحادثة
    await FB.updateDoc(FB.doc(FB.db, 'chats', currentChatId), {
      lastMessage: text.length > 50 ? text.substring(0, 50) + '...' : text,
      updatedAt:   FB.serverTimestamp(),
      [`unreadCount.${currentPartner?.uid}`]: FB.increment(1),
      [`memberOnline.${currentUser.uid}`]: true
    });

    // إزالة الرسالة المؤقتة (ستُستبدل بالرسالة الحقيقية من Snapshot)
    tempEl.remove();

    // تحديث إحصائيات
    totalMsgsSent++;
    localStorage.setItem('cw_msgs_sent', totalMsgsSent.toString());
    updateSettingsStats();

  } catch (err) {
    console.error('Send message error:', err);
    // تحديد الرسالة المؤقتة كفاشلة
    const bubble = tempEl.querySelector('.message-bubble');
    if (bubble) bubble.classList.add('failed');
    showToast('فشل إرسال الرسالة، تحقق من الاتصال', 'error');
  }
}

function buildTempMessage(text) {
  const wrap = document.createElement('div');
  wrap.className = 'message-wrap outgoing';
  wrap.innerHTML = `
    <div class="message-bubble sending">
      <div class="message-text">${escapeHtml(text)}</div>
      <div class="message-meta">
        <span class="message-time">${formatTime(new Date())}</span>
        <span class="read-receipt sent">✓</span>
      </div>
    </div>
  `;
  return wrap;
}

function handleKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

/* ══════════════════════════════════════════════════════
   ☁️ Cloudinary – إعدادات الرفع
══════════════════════════════════════════════════════ */
const CLOUDINARY_CLOUD_NAME   = 'docghs8ij';
const CLOUDINARY_UPLOAD_PRESET = 'wp9ibcuc';
const CLOUDINARY_UPLOAD_URL   = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;

/* ══════════════════════════════════════════════════════
   🖼️ رفع وإرسال الصور عبر Cloudinary
══════════════════════════════════════════════════════ */
function handleImageSelect(event) {
  const file = event.target.files[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    showToast('اختر ملف صورة صالح (JPG, PNG, WEBP) 🖼️', 'error');
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    showToast('حجم الصورة يجب أن يكون أقل من 10MB ⚠️', 'error');
    return;
  }

  pendingImageFile = file;

  // عرض معاينة الصورة
  const reader = new FileReader();
  reader.onload = (e) => {
    setAttr('image-preview-img', 'src', e.target.result);
    document.getElementById('image-preview-wrap').style.display = 'flex';
    document.getElementById('preview-caption').value = '';
    setTimeout(() => document.getElementById('preview-caption')?.focus(), 200);
  };
  reader.readAsDataURL(file);

  event.target.value = '';
}

function cancelImagePreview() {
  document.getElementById('image-preview-wrap').style.display = 'none';
  pendingImageFile = null;
}

async function confirmSendImage() {
  if (!pendingImageFile || !currentChatId) return;
  const caption = document.getElementById('preview-caption')?.value.trim() || '';
  cancelImagePreview();
  await uploadAndSendImage(pendingImageFile, caption);
  pendingImageFile = null;
}

async function uploadAndSendImage(file, caption = '') {
  if (!currentChatId || !currentUser) return;

  // إضافة مؤشر رفع في منطقة الرسائل
  const area   = document.getElementById('messages-area');
  const loadEl = document.createElement('div');
  loadEl.className = 'message-wrap outgoing';
  loadEl.innerHTML = `
    <div class="message-bubble sending">
      <div class="upload-progress">
        <div class="upload-spinner"></div>
        <span style="font-size:.82rem;color:rgba(255,255,255,.7)">جارٍ الرفع...</span>
      </div>
      <div class="image-upload-progress-bar">
        <div class="image-upload-progress-fill" id="img-upload-fill" style="width:0%"></div>
      </div>
    </div>
  `;
  area.appendChild(loadEl);
  scrollToBottom(area);
  showGlobalUpload(true, 0);

  try {
    /* ─────────────────────────────────────────────────────
       الخطوة 1: رفع الصورة لـ Cloudinary عبر XMLHttpRequest
       حتى نقدر نتابع نسبة التقدم (progress)
    ───────────────────────────────────────────────────── */
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
    formData.append('folder', `chatwave/${currentChatId}`);

    const downloadURL = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', CLOUDINARY_UPLOAD_URL, true);

      // متابعة نسبة الرفع
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          const fillEl = document.getElementById('img-upload-fill');
          if (fillEl) fillEl.style.width = pct + '%';
          showGlobalUpload(true, pct);
        }
      };

      xhr.onload = () => {
        if (xhr.status === 200) {
          const res = JSON.parse(xhr.responseText);
          resolve(res.secure_url); // رابط HTTPS للصورة
        } else {
          reject(new Error(`Cloudinary error: ${xhr.status} - ${xhr.responseText}`));
        }
      };

      xhr.onerror = () => reject(new Error('Network error during upload'));
      xhr.send(formData);
    });

    /* ─────────────────────────────────────────────────────
       الخطوة 2: حفظ رابط الصورة في Firestore
    ───────────────────────────────────────────────────── */
    const msgsRef = FB.collection(FB.db, 'chats', currentChatId, 'messages');
    await FB.addDoc(msgsRef, {
      type:       'image',
      imageUrl:   downloadURL,
      caption:    caption,
      text:       '',
      senderId:   currentUser.uid,
      senderName: currentUser.name,
      createdAt:  FB.serverTimestamp(),
      delivered:  false,
      readBy:     []
    });

    // تحديث آخر رسالة في المحادثة
    await FB.updateDoc(FB.doc(FB.db, 'chats', currentChatId), {
      lastMessage: '📷 صورة' + (caption ? `: ${caption}` : ''),
      updatedAt:   FB.serverTimestamp(),
      [`unreadCount.${currentPartner?.uid}`]: FB.increment(1)
    });

    playSound('send');
    showToast('تم إرسال الصورة ✅', 'success');
    totalMsgsSent++;
    localStorage.setItem('cw_msgs_sent', totalMsgsSent.toString());

  } catch (err) {
    console.error('Cloudinary upload error:', err);
    const bubble = loadEl.querySelector('.message-bubble');
    if (bubble) bubble.classList.add('failed');
    showToast('فشل رفع الصورة، تحقق من الاتصال ❌', 'error');
  } finally {
    loadEl.remove();
    showGlobalUpload(false);
  }
}

/* توجيه القديم للتوافق */
function handleImageUpload(event) {
  handleImageSelect(event);
}

/* ══════════════════════════════════════════════════════
   🗑️ مسح المحادثة
══════════════════════════════════════════════════════ */
function clearChatHistory() {
  if (!currentChatId) return;
  showConfirmModal('سيتم مسح جميع رسائل هذه المحادثة. هل أنت متأكد؟', async () => {
    showTopLoader(true);
    try {
      const msgsRef = FB.collection(FB.db, 'chats', currentChatId, 'messages');
      const snap    = await FB.getDocs(msgsRef);
      const batch   = FB.writeBatch(FB.db);
      snap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
      await FB.updateDoc(FB.doc(FB.db, 'chats', currentChatId), {
        lastMessage: '',
        updatedAt:   FB.serverTimestamp()
      });
      showToast('تم مسح المحادثة ✅', 'success');
    } catch (err) {
      console.error('Clear chat error:', err);
      showToast('خطأ في مسح المحادثة ❌', 'error');
    } finally {
      showTopLoader(false);
    }
  });
}

/* ══════════════════════════════════════════════════════
   🔍 البحث في الرسائل
══════════════════════════════════════════════════════ */
function searchInChat() {
  const el = document.getElementById('in-chat-search');
  if (!el) return;
  const isVisible = el.style.display !== 'none';
  el.style.display = isVisible ? 'none' : 'flex';
  if (!isVisible) {
    document.getElementById('in-chat-search-input')?.focus();
  }
}

function closeSearchInChat() {
  const el = document.getElementById('in-chat-search');
  if (el) el.style.display = 'none';
  // إزالة التظليل
  document.querySelectorAll('.message-text').forEach(el => {
    el.innerHTML = el.textContent;
  });
}

function searchMessages(query) {
  const messages = document.querySelectorAll('.message-bubble');
  messages.forEach(bubble => {
    const textEl = bubble.querySelector('.message-text');
    if (!textEl) return;
    const original = textEl.dataset.original || textEl.textContent;
    textEl.dataset.original = original;
    if (!query) {
      textEl.textContent = original;
      bubble.parentElement?.style.removeProperty('display');
      return;
    }
    if (original.includes(query)) {
      textEl.innerHTML = original.split(query).map(part => escapeHtml(part)).join(
        `<mark class="message-highlight">${escapeHtml(query)}</mark>`
      );
      bubble.parentElement.style.display = '';
    } else {
      bubble.parentElement.style.display = 'none';
    }
  });
}

/* ══════════════════════════════════════════════════════
   💬 مؤشر الكتابة
══════════════════════════════════════════════════════ */
async function handleTyping() {
  if (!currentChatId || !currentUser || !typingEnabled) return;

  clearTimeout(typingTimer);

  try {
    await FB.updateDoc(FB.doc(FB.db, 'chats', currentChatId), {
      [`typing.${currentUser.uid}`]: true
    });
  } catch (e) {}

  typingTimer = setTimeout(resetTyping, 2500);
}

async function resetTyping() {
  clearTimeout(typingTimer);
  if (!currentChatId || !currentUser) return;
  try {
    await FB.updateDoc(FB.doc(FB.db, 'chats', currentChatId), {
      [`typing.${currentUser.uid}`]: false
    });
  } catch (e) {}
}

/* ══════════════════════════════════════════════════════
   ⚙️ الإعدادات
══════════════════════════════════════════════════════ */
function openSettings() {
  document.getElementById('settings-panel').classList.add('open');
  document.getElementById('settings-overlay').classList.add('visible');

  if (currentUser) {
    setVal('settings-name', currentUser.name || '');
    setVal('settings-phone', currentUser.phone || '');
    setVal('settings-bio', currentUser.bio || '');
    setAttr('settings-avatar', 'src', currentUser.avatar || generateAvatar('U'));
    setText('settings-last-seen', 'الآن');
    updateBioCount();
    updateNameCount();
  }
  setText('settings-msgs-count', totalMsgsSent.toString());
}

function closeSettings() {
  document.getElementById('settings-panel').classList.remove('open');
  document.getElementById('settings-overlay').classList.remove('visible');
}

function updateBioCount() {
  const val = document.getElementById('settings-bio')?.value || '';
  setText('bio-count', `${val.length}/120`);
}

function updateNameCount() {
  const input = document.getElementById('settings-name');
  const val   = input?.value || '';
  setText('settings-name-count', `${val.length}/50`);
  if (input) input.addEventListener('input', () => {
    setText('settings-name-count', `${input.value.length}/50`);
  });
}

async function saveSettings() {
  const name  = document.getElementById('settings-name')?.value.trim();
  const phone = document.getElementById('settings-phone')?.value.trim();
  const bio   = document.getElementById('settings-bio')?.value.trim();

  if (!name)  { showToast('الاسم مطلوب ⚠️', 'error'); return; }
  if (name.length < 2) { showToast('الاسم قصير جداً', 'error'); return; }

  showTopLoader(true);
  try {
    const updates = { name, bio, updatedAt: FB.serverTimestamp() };
    if (phone) updates.phone = phone;

    await FB.updateDoc(FB.doc(FB.db, 'users', currentUser.uid), updates);
    currentUser = { ...currentUser, name, phone, bio };
    updateSidebarUI();
    showToast('تم حفظ التغييرات ✅', 'success');
    closeSettings();
  } catch (err) {
    console.error('Save settings error:', err);
    showToast('خطأ في الحفظ ❌', 'error');
  } finally {
    showTopLoader(false);
  }
}

/* ─── رفع صورة البروفايل ─── */
async function handleProfilePhoto(event) {
  const file = event.target.files[0];
  if (!file || !currentUser) return;

  if (!file.type.startsWith('image/')) { showToast('اختر صورة صالحة 🖼️', 'error'); return; }
  if (file.size > 5 * 1024 * 1024)    { showToast('الصورة يجب أن تكون أقل من 5MB', 'error'); return; }

  showToast('جارٍ رفع صورة البروفايل...', 'info');
  showUploadRing(true);

  try {
    /* رفع صورة البروفايل لـ Cloudinary */
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
    formData.append('folder', 'chatwave/profiles');

    const downloadURL = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', CLOUDINARY_UPLOAD_URL, true);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) updateUploadRing((e.loaded / e.total) * 100);
      };
      xhr.onload = () => {
        if (xhr.status === 200) {
          resolve(JSON.parse(xhr.responseText).secure_url);
        } else {
          reject(new Error('Cloudinary error: ' + xhr.status));
        }
      };
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.send(formData);
    });

    // تحديث Firestore
    await FB.updateDoc(FB.doc(FB.db, 'users', currentUser.uid), { avatar: downloadURL });
    currentUser.avatar = downloadURL;

    // تحديث الواجهة
    setAttr('settings-avatar', 'src', downloadURL);
    setAttr('sidebar-avatar', 'src', downloadURL);

    showToast('تم تحديث صورة البروفايل ✅', 'success');
  } catch (err) {
    console.error('Profile photo error:', err);
    showToast('فشل رفع الصورة ❌', 'error');
  } finally {
    showUploadRing(false);
    event.target.value = '';
  }
}

function showUploadRing(show, pct = 0) {
  const ring = document.getElementById('upload-ring');
  if (!ring) return;
  ring.style.display = show ? 'block' : 'none';
  if (show) updateUploadRing(pct);
}
function updateUploadRing(pct) {
  const circle = document.querySelector('.progress-circle');
  if (!circle) return;
  const offset = 226 - (226 * pct / 100);
  circle.style.strokeDashoffset = offset;
}

/* إعدادات التبديل */
function toggleSoundSetting(el) {
  soundEnabled = el.checked;
  localStorage.setItem('cw_sound', soundEnabled.toString());
  showToast(soundEnabled ? '🔊 صوت الإشعارات مُفعّل' : '🔇 صوت الإشعارات مُعطّل');
}
function toggleTypingSetting(el) {
  typingEnabled = el.checked;
  localStorage.setItem('cw_typing', typingEnabled.toString());
  showToast(typingEnabled ? 'مؤشر الكتابة مُفعّل' : 'مؤشر الكتابة مُعطّل');
}
function toggleReadReceiptsSetting(el) {
  readReceiptsEnabled = el.checked;
  localStorage.setItem('cw_read_receipts', readReceiptsEnabled.toString());
  showToast(readReceiptsEnabled ? 'إيصالات القراءة مُفعّلة' : 'إيصالات القراءة مُعطّلة');
}

function updateSettingsStats(chatsCount) {
  if (chatsCount !== undefined) {
    setText('settings-chats-count', chatsCount.toString());
  }
  setText('settings-msgs-count', totalMsgsSent.toString());
}

/* ══════════════════════════════════════════════════════
   👤 بروفايل الشريك
══════════════════════════════════════════════════════ */
async function openPartnerProfile() {
  if (!currentPartner) return;
  const modal = document.getElementById('partner-profile-modal');
  if (!modal) return;

  modal.style.display = 'flex';

  setAttr('partner-profile-avatar', 'src', currentPartner.avatar || generateAvatar(currentPartner.name || 'U'));
  setText('partner-profile-name',   currentPartner.name || 'مستخدم');
  setText('partner-profile-status', currentPartner.online ? '🟢 متصل الآن' : '⚫ غير متصل');
  setText('partner-profile-bio',    currentPartner.bio || 'لم يُضف حالة بعد');
  setText('partner-profile-phone',  currentPartner.phone || 'غير متوفر');

  const lastSeen = currentPartner.lastSeen;
  const ls = lastSeen ? formatLastSeen(lastSeen.toDate?.() || new Date(lastSeen)) : 'غير متوفر';
  setText('partner-profile-lastseen', ls);
}

function closePartnerProfile() {
  const m = document.getElementById('partner-profile-modal');
  if (m) m.style.display = 'none';
}

/* ══════════════════════════════════════════════════════
   🟢 تحديث الحضور (Online Status)
══════════════════════════════════════════════════════ */
async function updatePresence() {
  if (!currentUser) return;

  const userRef = FB.doc(FB.db, 'users', currentUser.uid);

  const doUpdate = async () => {
    if (!currentUser) return;
    try {
      await FB.updateDoc(userRef, {
        lastSeen: FB.serverTimestamp(),
        online:   true
      });
    } catch (e) {}
  };

  await doUpdate();

  // تحديث كل دقيقة
  const presenceInterval = setInterval(doUpdate, 60000);

  // عند مغادرة الصفحة
  const setOffline = async () => {
    clearInterval(presenceInterval);
    if (!currentUser) return;
    try {
      await FB.updateDoc(userRef, {
        lastSeen: FB.serverTimestamp(),
        online:   false
      });
    } catch (e) {}
  };

  window.addEventListener('beforeunload', setOffline);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      FB.updateDoc(userRef, { online: false }).catch(() => {});
    } else {
      doUpdate();
    }
  });
}

/* ══════════════════════════════════════════════════════
   🎨 المظهر (Dark / Light)
══════════════════════════════════════════════════════ */
function toggleDarkMode() {
  const isLight = document.body.classList.toggle('light-mode');
  localStorage.setItem('cw_theme', isLight ? 'light' : 'dark');
  showToast(isLight ? '☀️ الوضع المضيء' : '🌙 الوضع الداكن');
}

/* ══════════════════════════════════════════════════════
   😀 Emoji Picker
══════════════════════════════════════════════════════ */
const EMOJI_DATA = {
  smileys: ['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🤩','🥳','😏','😒','😞','😔','😟','😕','🙁','☹️','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😱','😨','😰','😥','😓','🤗','🤔','🤭','🤫','🤥','😶','😐','😑','😬','🙄','😯','😦','😧','😮','😲','🥱','😴'],
  hearts:  ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','☮️','✝️','☯️','✨','💫','⭐','🌟','💥','🔥','🎉','🎊'],
  gestures:['👋','🤚','🖐️','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🙏','🤝','💪','🦾','🦿','🤳','💅'],
  animals: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🐔','🐧','🐦','🐤','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🦋','🐛','🐌','🐞','🐜','🦗','🦟','🦂','🐢','🐍','🦎','🦖','🦕','🐙','🦑','🦐','🦞','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈'],
  food:    ['🍎','🍊','🍋','🍌','🍉','🍇','🍓','🍈','🍑','🍒','🍍','🥭','🥝','🍅','🥥','🥑','🍆','🥦','🥬','🥒','🌽','🥕','🧄','🧅','🥔','🍠','🍞','🥐','🥖','🫓','🥨','🧀','🥚','🍳','🧈','🥞','🧇','🥓','🥩','🍗','🍖','🌭','🍔','🍟','🍕','🫔','🌮','🌯','🥗','🫕','🥘','🍝','🍜','🍲','🍛','🍣','🍱','🥟','🍤','🍙','🍚','🍘','🍥','🥮','🍢','🧆','🥚','🍡','🍧','🍨','🍦','🥧','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍿','🍩','🍪','🌰','🥜'],
  activities: ['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🏓','🏸','🏒','🥍','🏏','🏹','🥊','🥋','🥅','⛳','🎣','🏊','🧗','🚴','🏇','🤺','⛷️','🏂','🏋️','🤸','🤼','🤾','⛹️','🎿','🛷','🏌️','🤿','🎽','🛹','🛼','🛷','🏄','🚣','🤽','🧘','🏃','🚶','🧖','🎭','🎨','🖼️','🎪','🎠','🎡','🎢','🎯','🎱','🔮','🧿','🎮','🕹️','🃏','🀄','🎲'],
  symbols: ['✨','💫','⭐','🌟','✅','❌','❓','❗','💯','🔥','💎','🏆','🎯','📌','📎','🔑','🔒','🔓','💡','🔔','🔕','📣','📢','🎵','🎶','💬','💭','🗨️','📱','💻','⌨️','🖥️','🖨️','🖱️','💾','💿','📷','📸','🎥','📞','☎️','📟','📺','📻','⏰','⏱️','⌚','🌈','🌊','⚡','❄️','🌙','☀️','🌍','🌎','🌏','🗺️','🧭']
};

let currentEmojiCategory = 'smileys';

function initEmojiPicker() {
  showEmojiCategory('smileys');
}

function toggleEmojiPicker() {
  const picker = document.getElementById('emoji-picker');
  if (!picker) return;
  picker.style.display = picker.style.display === 'none' || !picker.style.display ? 'block' : 'none';
}

function showEmojiCategory(cat) {
  currentEmojiCategory = cat;
  document.querySelectorAll('.emoji-cat-btn').forEach(b => b.classList.remove('active'));
  const activeCat = document.querySelector(`[onclick="showEmojiCategory('${cat}')"]`);
  if (activeCat) activeCat.classList.add('active');
  renderEmojis(EMOJI_DATA[cat] || []);
}

function renderEmojis(emojis) {
  const grid = document.getElementById('emoji-grid');
  if (!grid) return;
  grid.innerHTML = '';
  emojis.forEach(emoji => {
    const btn = document.createElement('button');
    btn.className = 'emoji-btn-item';
    btn.textContent = emoji;
    btn.title = emoji;
    btn.addEventListener('click', () => insertEmoji(emoji));
    grid.appendChild(btn);
  });
}

function filterEmojis(query) {
  if (!query) { showEmojiCategory(currentEmojiCategory); return; }
  const all = Object.values(EMOJI_DATA).flat();
  // لا يمكن البحث بالنص في الإيموجي بسهولة، لذلك سنعرض الكل
  renderEmojis(all);
}

function insertEmoji(emoji) {
  const input = document.getElementById('message-input');
  if (!input) return;
  const start = input.selectionStart;
  const end   = input.selectionEnd;
  const val   = input.value;
  input.value = val.slice(0, start) + emoji + val.slice(end);
  input.setSelectionRange(start + emoji.length, start + emoji.length);
  input.focus();
  autoResize(input);
}

/* ══════════════════════════════════════════════════════
   🖼️ عارض الصور
══════════════════════════════════════════════════════ */
function openImageViewer(url, caption) {
  const viewer = document.getElementById('image-viewer');
  if (!viewer) return;
  setAttr('viewer-img', 'src', url);
  setAttr('viewer-download', 'href', url);
  setText('viewer-caption', caption || '');
  viewer.style.display = 'flex';
}

function closeImageViewer() {
  const viewer = document.getElementById('image-viewer');
  if (viewer) viewer.style.display = 'none';
}

// دعم القديم
function viewImage(url) {
  openImageViewer(url, '');
}

/* ══════════════════════════════════════════════════════
   📣 مودال التأكيد
══════════════════════════════════════════════════════ */
let pendingConfirmAction = null;

function showConfirmModal(message, onConfirm) {
  setText('confirm-message', message);
  pendingConfirmAction = onConfirm;
  document.getElementById('confirm-modal').style.display = 'flex';
}

function closeConfirmModal() {
  document.getElementById('confirm-modal').style.display = 'none';
  pendingConfirmAction = null;
}

function executeConfirmedAction() {
  closeConfirmModal();
  if (typeof pendingConfirmAction === 'function') pendingConfirmAction();
}

/* ══════════════════════════════════════════════════════
   🔊 الصوت
══════════════════════════════════════════════════════ */
const audioCtx = typeof AudioContext !== 'undefined' ? new AudioContext() : null;

function playSound(type) {
  if (!soundEnabled || !audioCtx) return;
  try {
    const osc  = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    if (type === 'send') {
      osc.frequency.setValueAtTime(880, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(440, audioCtx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.1);
      osc.start(); osc.stop(audioCtx.currentTime + 0.12);
    } else if (type === 'receive') {
      osc.frequency.setValueAtTime(550, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(700, audioCtx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.06, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.18);
      osc.start(); osc.stop(audioCtx.currentTime + 0.2);
    }
  } catch (e) {}
}

/* ══════════════════════════════════════════════════════
   🛠️ دوال مساعدة للـ UI
══════════════════════════════════════════════════════ */
function showTopLoader(show) {
  const el = document.getElementById('top-loader');
  if (el) el.style.display = show ? 'block' : 'none';
}

function showGlobalUpload(show, pct = 0) {
  const el = document.getElementById('global-upload-indicator');
  if (!el) return;
  el.style.display = show ? 'block' : 'none';
  if (show) setText('upload-progress-text', `جارٍ الرفع... ${pct}%`);
}

let toastTimer = null;
function showToast(msg, type = '') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.className   = 'toast show' + (type ? ` ${type}` : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.className = 'toast'; }, 3200);
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

/* ══════════════════════════════════════════════════════
   🛠️ دوال مساعدة عامة
══════════════════════════════════════════════════════ */

/** توليد رابط صورة Avatar */
function generateAvatar(name, bg = '128C7E') {
  const encoded = encodeURIComponent((name || 'U').slice(0, 2));
  return `https://ui-avatars.com/api/?name=${encoded}&background=${bg}&color=fff&size=200&font-size=0.45&bold=true`;
}

/** تنسيق الوقت */
function formatTime(date) {
  if (!date) return '';
  try {
    return date.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

/** تنسيق التاريخ */
function formatDate(date) {
  if (!date) return '';
  const now   = new Date();
  const yest  = new Date(now); yest.setDate(now.getDate() - 1);
  if (isSameDay(date, now))  return 'اليوم';
  if (isSameDay(date, yest)) return 'أمس';
  return date.toLocaleDateString('ar-SA', { day: 'numeric', month: 'long', year: 'numeric' });
}

function isSameDay(d1, d2) {
  return d1.getDate()     === d2.getDate()  &&
         d1.getMonth()    === d2.getMonth() &&
         d1.getFullYear() === d2.getFullYear();
}

/** حماية XSS */
function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#039;');
}

function escapeAttr(str) {
  return String(str || '').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

/** تحويل الروابط في النص */
function linkifyText(text) {
  const urlRegex = /(\bhttps?:\/\/[\w\-]+(\.[\w\-]+)+(\/[^\s]*)?)/gi;
  return text.replace(urlRegex, url => `<a href="${url}" target="_blank" rel="noopener noreferrer" style="color:var(--green-primary);text-decoration:underline">${url}</a>`);
}

/** مساعدو DOM */
function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}
function setAttr(id, attr, val) {
  const el = document.getElementById(id);
  if (el) el.setAttribute(attr, val);
}
function setVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}

/* ══════════════════════════════════════════════════════
   💡 شرح ربط Firebase Storage (كتعليق توثيقي)
══════════════════════════════════════════════════════

   كيفية ربط Firebase Storage لإرسال الصور:
   ═══════════════════════════════════════════════

   1. إنشاء مشروع Firebase:
      - اذهب إلى https://console.firebase.google.com
      - أنشئ مشروعاً جديداً
      - فعّل Authentication → Anonymous
      - فعّل Firestore Database → Start in test mode
      - فعّل Storage → Start in test mode

   2. نسخ إعدادات المشروع:
      - Project Settings → General → Your apps → Web app
      - انسخ firebaseConfig والصقه في index.html

   3. قواعد Firestore (Firestore Rules):
      rules_version = '2';
      service cloud.firestore {
        match /databases/{db}/documents {
          match /{document=**} {
            allow read, write: if request.auth != null;
          }
        }
      }

   4. قواعد Storage (Storage Rules):
      rules_version = '2';
      service firebase.storage {
        match /b/{bucket}/o {
          match /{allPaths=**} {
            allow read: if true;
            allow write: if request.auth != null
              && request.resource.size < 10 * 1024 * 1024
              && request.resource.contentType.matches('image/.*');
          }
        }
      }

   5. كيف يعمل uploadBytesResumable (المستخدم في هذا الكود):
      const storageRef = ref(storage, 'chat-images/chatId/filename.jpg');
      const uploadTask = uploadBytesResumable(storageRef, file);

      uploadTask.on('state_changed',
        (snapshot) => {
          // نسبة التقدم
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
        },
        (error) => { console.error(error); },
        async () => {
          // اكتمل الرفع - جلب رابط التنزيل
          const url = await getDownloadURL(uploadTask.snapshot.ref);
          // حفظ الرابط في Firestore
        }
      );

══════════════════════════════════════════════════════ */
