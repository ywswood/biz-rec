// ==========================================
// 設定
// ==========================================
const CONFIG = {
  CLIENT_ID: '1063787713722-6tlecpqtmp5i2uubvmcvrgcq5islr4i0.apps.googleusercontent.com',
  SCOPES: 'https://www.googleapis.com/auth/drive.file',
  DISCOVERY_DOCS: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'],

  // Google Drive フォルダID
  VOICE_FOLDER_ID: '1Drp4_rkJsLpdC49tzRDACcCnQb_ywl4h', // voice フォルダ

  // 録音設定
  CHUNK_DURATION: 5 * 60 * 1000, // 5分（ミリ秒）
  MAX_DURATION: 60 * 60 * 1000,  // 60分（ミリ秒）
  MAX_CHUNKS: 12,                 // 最大チャンク数（60分 / 5分）

  // 音声設定
  MIME_TYPE: 'audio/webm;codecs=opus',
  FILE_EXTENSION: '.webm'
};

// ==========================================
// グローバル変数
// ==========================================
let accessToken = null;
let mediaRecorder = null;
let audioStream = null;
let recordingStartTime = null;
let currentChunk = 0;
let timerInterval = null;
let chunkInterval = null;
let audioChunks = [];
let uploadedChunks = 0;
let sessionId = null;

// DOM要素
const authSection = document.getElementById('authSection');
const mainSection = document.getElementById('mainSection');
const authButton = document.getElementById('authButton');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusText = document.getElementById('statusText');
const chunkCount = document.getElementById('chunkCount');
const uploadCount = document.getElementById('uploadCount');
const timer = document.getElementById('timer');
const progressBar = document.getElementById('progressBar');
const logBox = document.getElementById('logBox');
const chunkList = document.getElementById('chunkList');

// ==========================================
// 初期化
// ==========================================
window.onload = () => {
  log('アプリ起動');
  authButton.addEventListener('click', handleAuth);
  startBtn.addEventListener('click', startRecording);
  stopBtn.addEventListener('click', stopRecording);
};

// ==========================================
// 認証処理
// ==========================================
function handleAuth() {
  log('Google認証を開始...');

  const client = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.CLIENT_ID,
    scope: CONFIG.SCOPES,
    callback: (response) => {
      if (response.error) {
        log(`❌ 認証エラー: ${response.error}`, 'error');
        return;
      }

      accessToken = response.access_token;
      log('✅ 認証成功');

      // UIを切り替え
      authSection.classList.add('hidden');
      mainSection.classList.remove('hidden');
    },
  });

  client.requestAccessToken();
}

// ==========================================
// 録音開始
// ==========================================
async function startRecording() {
  try {
    log('録音を開始します...');

    // マイク権限を取得
    audioStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: 48000
      }
    });

    log('✅ マイク接続成功');

    // MediaRecorderを初期化
    mediaRecorder = new MediaRecorder(audioStream, {
      mimeType: CONFIG.MIME_TYPE,
      audioBitsPerSecond: 128000 // 128kbps
    });

    // セッションIDを生成（YYMMDDHHmmss形式）
    const now = new Date();
    sessionId = formatDate(now) + '_' +
      String(now.getHours()).padStart(2, '0') +
      String(now.getMinutes()).padStart(2, '0') +
      String(now.getSeconds()).padStart(2, '0');

    log(`📝 セッションID: ${sessionId}`);

    // 録音データの蓄積
    audioChunks = [];
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };

    // 録音開始
    recordingStartTime = Date.now();
    currentChunk = 0;
    uploadedChunks = 0;

    mediaRecorder.start();

    // UIを更新
    startBtn.classList.add('hidden');
    stopBtn.classList.remove('hidden');
    statusText.innerHTML = '<span class="recording-indicator"></span>録音中';
    chunkList.style.display = 'block';

    // タイマー開始
    startTimer();

    // 5分ごとのチャンク処理
    scheduleNextChunk();

    log('🎤 録音開始');

  } catch (error) {
    log(`❌ 録音開始エラー: ${error.message}`, 'error');
  }
}

// ==========================================
// 録音停止
// ==========================================
function stopRecording() {
  log('録音を停止します...');

  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();

    // 最後のチャンクを処理
    mediaRecorder.onstop = async () => {
      if (audioChunks.length > 0) {
        currentChunk++;
        await processChunk();
      }

      cleanup();
      log('✅ 録音完了');
    };
  } else {
    cleanup();
  }
}

// ==========================================
// チャンクスケジューリング
// ==========================================
function scheduleNextChunk() {
  chunkInterval = setTimeout(async () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      log(`⏸️ チャンク ${currentChunk + 1} を保存中...`);

      // 録音を一時停止してチャンクを確定
      mediaRecorder.stop();

      mediaRecorder.onstop = async () => {
        currentChunk++;
        await processChunk();

        // 60分に達していない場合は録音を再開
        const elapsed = Date.now() - recordingStartTime;
        if (elapsed < CONFIG.MAX_DURATION && currentChunk < CONFIG.MAX_CHUNKS) {
          audioChunks = [];
          mediaRecorder.start();
          scheduleNextChunk();
        } else {
          log('⏹️ 最大録音時間に達しました');
          stopRecording();
        }
      };
    }
  }, CONFIG.CHUNK_DURATION);
}

// ==========================================
// チャンク処理（アップロード）
// ==========================================
async function processChunk() {
  if (audioChunks.length === 0) return;

  const blob = new Blob(audioChunks, { type: CONFIG.MIME_TYPE });
  const chunkNumber = String(currentChunk).padStart(2, '0');
  const fileName = `${sessionId}_chunk${chunkNumber}${CONFIG.FILE_EXTENSION}`;

  log(`📤 アップロード中: ${fileName} (${(blob.size / 1024 / 1024).toFixed(2)} MB)`);

  // チャンクリストに追加
  addChunkToList(fileName, 'アップロード中...');

  try {
    await uploadToDrive(blob, fileName);

    uploadedChunks++;
    updateChunkInList(fileName, 'uploaded');

    log(`✅ アップロード完了: ${fileName}`);
    updateUI();

  } catch (error) {
    log(`❌ アップロード失敗: ${error.message}`, 'error');
    updateChunkInList(fileName, '失敗');
  }
}

// ==========================================
// Google Drive アップロード（マルチパート）
// ==========================================
async function uploadToDrive(blob, fileName) {
  const metadata = {
    name: fileName,
    mimeType: CONFIG.MIME_TYPE,
    parents: [CONFIG.VOICE_FOLDER_ID]
  };

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', blob);

  const response = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      },
      body: form
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'アップロード失敗');
  }

  return await response.json();
}

// ==========================================
// タイマー
// ==========================================
function startTimer() {
  timerInterval = setInterval(() => {
    const elapsed = Date.now() - recordingStartTime;
    const minutes = Math.floor(elapsed / 60000);
    const seconds = Math.floor((elapsed % 60000) / 1000);

    timer.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

    // プログレスバー更新
    const progress = Math.min((elapsed / CONFIG.MAX_DURATION) * 100, 100);
    progressBar.style.width = `${progress}%`;

  }, 100);
}

// ==========================================
// UI更新
// ==========================================
function updateUI() {
  chunkCount.textContent = `${currentChunk} / ${CONFIG.MAX_CHUNKS}`;
  uploadCount.textContent = `${uploadedChunks} 完了`;
}

// ==========================================
// チャンクリスト管理
// ==========================================
function addChunkToList(fileName, status) {
  const item = document.createElement('div');
  item.className = 'chunk-item';
  item.id = `chunk-${fileName}`;
  item.innerHTML = `
    <span>${fileName}</span>
    <span class="chunk-status">${status}</span>
  `;
  chunkList.appendChild(item);
}

function updateChunkInList(fileName, status) {
  const item = document.getElementById(`chunk-${fileName}`);
  if (item) {
    const statusSpan = item.querySelector('.chunk-status');
    statusSpan.className = `chunk-status ${status}`;
    statusSpan.textContent = status === 'uploaded' ? '完了' : status;
  }
}

// ==========================================
// クリーンアップ
// ==========================================
function cleanup() {
  // タイマー停止
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  if (chunkInterval) {
    clearTimeout(chunkInterval);
    chunkInterval = null;
  }

  // ストリーム停止
  if (audioStream) {
    audioStream.getTracks().forEach(track => track.stop());
    audioStream = null;
  }

  // MediaRecorder解放
  if (mediaRecorder) {
    mediaRecorder = null;
  }

  // UI復元
  startBtn.classList.remove('hidden');
  stopBtn.classList.add('hidden');
  statusText.textContent = '完了';

  log('🛑 録音停止・リソース解放完了');
}

// ==========================================
// ログ出力
// ==========================================
function log(message, type = 'info') {
  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = `<span class="log-time">[${timeStr}]</span>${message}`;

  logBox.appendChild(entry);
  logBox.scrollTop = logBox.scrollHeight;

  console.log(`[${timeStr}] ${message}`);
}

// ==========================================
// ユーティリティ
// ==========================================
function formatDate(date) {
  const year = String(date.getFullYear()).slice(-2);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}
