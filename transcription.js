/**
 * ========================================================================
 * 🟢 これが GAS (Google Apps Script) 用のコードです
 * 🟢 このファイルの中身をすべてコピーして、GASに貼り付けてください
 * ========================================================================
 * 
 * 【機能】
 * 1. voiceフォルダ内の音声ファイルを自動検出
 * 2. api_bank経由でGemini APIを使って文字起こし
 * 3. テキストをdocフォルダに保存（YYMMDD_01形式・連番管理）
 * 4. 処理済み音声ファイルを削除
 * 5. 同一セッションの全チャンクが完了したらテキスト結合
 * 
 * 【設定方法】
 * 1. このコードをGoogle Apps Scriptプロジェクトに貼り付け
 * 2. トリガー設定：「processVoiceFiles」関数を「時間主導型」「1分ごと」で実行
 * 3. 初回実行時に権限承認が必要です
 * 
 * 【api_bank連携】
 * - BANK_URLとBANK_PASSは実際の値に置き換えてください
 * - 503エラー対応済み（最大3回リトライ）
 */

// ==========================================
// 設定
// ==========================================
const CONFIG = {
  // API Bank設定
  BANK_URL: 'https://script.google.com/macros/s/AKfycbxCscLkbbvTUU7sqpZSayJ8pEQlWl8mrEBaSy_FklbidJRc649HwWc4SF0Q3GvUQZbuGA/exec', // 実際のURL
  BANK_PASS: '1030013',
  PROJECT_NAME: 'biz-record',

  // Google Driveフォルダ
  VOICE_FOLDER_ID: '1Drp4_rkJsLpdC49tzRDACcCnQb_ywl4h', // voice
  DOC_FOLDER_ID: '11gbAyd8kdgZN8bD29PDAm32B0LuboVtq',   // doc

  // リトライ設定
  MAX_RETRIES: 3,
  RETRY_DELAY: 2000, // ミリ秒

  // プロンプト
  TRANSCRIPTION_PROMPT: `
以下の音声を文字起こししてください。

【ルール】
- 話者は明確に分けてください（話者A、話者Bなど）
- フィラー（えー、あのー等）は適度に省略
- 聞き取れない部分は[不明]と記載
- タイムスタンプは不要

出力形式：
話者A: [発言内容]
話者B: [発言内容]
...
`
};

// ==========================================
// メイン処理（トリガーから実行）
// ==========================================
async function processVoiceFiles() {
  try {
    Logger.log('=== 音声ファイル処理を開始 ===');

    const voiceFolder = DriveApp.getFolderById(CONFIG.VOICE_FOLDER_ID);
    const files = voiceFolder.getFiles();

    let processedCount = 0;
    const sessions = {}; // セッションごとのチャンク管理

    while (files.hasNext()) {
      const file = files.next();
      const fileName = file.getName();

      // .webmファイルのみ処理
      if (!fileName.endsWith('.webm')) continue;

      Logger.log(`📁 処理対象: ${fileName}`);

      try {
        // セッションIDとチャンク番号を抽出
        const match = fileName.match(/^(\d{6}_\d{6})_chunk(\d{2})\.webm$/);
        if (!match) {
          Logger.log(`⚠️ ファイル名形式が不正: ${fileName}`);
          continue;
        }

        const sessionId = match[1];
        const chunkNum = parseInt(match[2]);

        // セッション管理初期化
        if (!sessions[sessionId]) {
          sessions[sessionId] = {
            chunks: [],
            totalChunks: 0
          };
        }

        // 文字起こし実行
        const transcription = await transcribeAudio(file);

        if (transcription) {
          // テキストファイルとして保存
          const textFileName = `${sessionId}_chunk${String(chunkNum).padStart(2, '0')}.txt`;
          saveTextToDoc(textFileName, transcription);

          // セッション情報更新
          sessions[sessionId].chunks.push({
            num: chunkNum,
            text: transcription,
            fileName: textFileName
          });
          sessions[sessionId].totalChunks++;

          Logger.log(`✅ 文字起こし完了: ${fileName}`);

          // 音声ファイル削除
          file.setTrashed(true);
          Logger.log(`🗑️ 音声ファイル削除: ${fileName}`);

          processedCount++;
        }

      } catch (error) {
        Logger.log(`❌ 処理エラー (${fileName}): ${error.message}`);
      }

      // レート制限対策（1ファイルごとに少し待機）
      Utilities.sleep(1000);
    }

    // セッション完了チェック＆結合処理
    Object.keys(sessions).forEach(sessionId => {
      checkAndMergeSession(sessionId, sessions[sessionId]);
    });

    Logger.log(`=== 処理完了: ${processedCount}件 ===`);

  } catch (error) {
    Logger.log(`❌ メイン処理エラー: ${error.message}`);
  }
}

// ==========================================
// 音声文字起こし（Gemini API + api_bank）
// ==========================================
async function transcribeAudio(file) {
  const blob = file.getBlob();
  const base64Audio = Utilities.base64Encode(blob.getBytes());
  const mimeType = file.getMimeType();

  let previousModel = null;

  for (let attempt = 1; attempt <= CONFIG.MAX_RETRIES; attempt++) {
    Logger.log(`🔄 文字起こし試行 ${attempt}/${CONFIG.MAX_RETRIES}`);

    try {
      // 1. API Bankからキー取得
      let bankUrl = `${CONFIG.BANK_URL}?pass=${CONFIG.BANK_PASS}&project=${CONFIG.PROJECT_NAME}`;
      if (previousModel) {
        bankUrl += `&error_503=true&previous_model=${encodeURIComponent(previousModel)}`;
      }

      const bankRes = UrlFetchApp.fetch(bankUrl, { muteHttpExceptions: true });
      const bankData = JSON.parse(bankRes.getContentText());

      if (bankData.status !== 'success') {
        Logger.log(`❌ API Bank エラー: ${bankData.message}`);
        return null;
      }

      const { api_key, model_name } = bankData;
      Logger.log(`📦 モデル取得: ${model_name}`);

      // 2. Gemini APIで文字起こし
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model_name}:generateContent?key=${api_key}`;

      const payload = {
        contents: [{
          parts: [
            {
              text: CONFIG.TRANSCRIPTION_PROMPT
            },
            {
              inline_data: {
                mime_type: mimeType,
                data: base64Audio
              }
            }
          ]
        }]
      };

      const geminiRes = UrlFetchApp.fetch(apiUrl, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      });

      const statusCode = geminiRes.getResponseCode();

      // 503エラー処理
      if (statusCode === 503) {
        Logger.log(`⚠️ 503エラー (${model_name}) - 次のモデルで再試行`);
        previousModel = model_name;
        Utilities.sleep(CONFIG.RETRY_DELAY);
        continue;
      }

      const geminiData = JSON.parse(geminiRes.getContentText());

      // エラーチェック
      if (geminiData.error || !geminiData.candidates || geminiData.candidates.length === 0) {
        Logger.log(`❌ Gemini APIエラー: ${JSON.stringify(geminiData)}`);
        reportError(api_key); // 503以外のエラーは報告
        return null;
      }

      // 成功
      const transcription = geminiData.candidates[0].content.parts[0].text;
      Logger.log(`✅ 文字起こし成功 (${transcription.length}文字)`);
      return transcription;

    } catch (error) {
      Logger.log(`❌ 例外発生: ${error.message}`);
      if (attempt === CONFIG.MAX_RETRIES) {
        return null;
      }
      Utilities.sleep(CONFIG.RETRY_DELAY);
    }
  }

  Logger.log('❌ 最大リトライ回数に達しました');
  return null;
}

// ==========================================
// テキストをdocフォルダに保存
// ==========================================
function saveTextToDoc(fileName, text) {
  const docFolder = DriveApp.getFolderById(CONFIG.DOC_FOLDER_ID);

  // 既存ファイルチェック（上書き防止）
  const existingFiles = docFolder.getFilesByName(fileName);
  if (existingFiles.hasNext()) {
    Logger.log(`⚠️ ファイルが既に存在: ${fileName}`);
    return;
  }

  // テキストファイル作成
  docFolder.createFile(fileName, text, MimeType.PLAIN_TEXT);
  Logger.log(`💾 テキスト保存: ${fileName}`);
}

// ==========================================
// セッション完了チェック＆結合
// ==========================================
function checkAndMergeSession(sessionId, sessionData) {
  const docFolder = DriveApp.getFolderById(CONFIG.DOC_FOLDER_ID);

  // セッション内の全チャンクファイルを検索
  const allChunkFiles = [];
  const files = docFolder.getFiles();

  while (files.hasNext()) {
    const file = files.next();
    const fileName = file.getName();

    if (fileName.startsWith(sessionId + '_chunk') && fileName.endsWith('.txt')) {
      const match = fileName.match(/_chunk(\d{2})\.txt$/);
      if (match) {
        allChunkFiles.push({
          num: parseInt(match[1]),
          file: file
        });
      }
    }
  }

  // チャンク数チェック（仮に12チャンク＝60分を想定）
  // 実際の総チャンク数は録音時間によって変動するため、
  // ここでは一定時間経過後に結合する、または別のフラグで判断する必要があります
  // 簡易実装として、voiceフォルダに該当セッションのファイルがなくなったら結合とする

  const voiceFolder = DriveApp.getFolderById(CONFIG.VOICE_FOLDER_ID);
  const remainingVoiceFiles = voiceFolder.getFiles();
  let hasRemainingChunks = false;

  while (remainingVoiceFiles.hasNext()) {
    const voiceFile = remainingVoiceFiles.next();
    if (voiceFile.getName().startsWith(sessionId)) {
      hasRemainingChunks = true;
      break;
    }
  }

  if (!hasRemainingChunks && allChunkFiles.length > 0) {
    Logger.log(`📝 セッション完了を検出: ${sessionId} (${allChunkFiles.length}チャンク)`);

    // チャンク番号順にソート
    allChunkFiles.sort((a, b) => a.num - b.num);

    // テキスト結合
    let mergedText = `=== 商談記録 ===\nセッションID: ${sessionId}\n作成日時: ${new Date().toLocaleString('ja-JP')}\nチャンク数: ${allChunkFiles.length}\n\n`;

    allChunkFiles.forEach(chunk => {
      mergedText += `\n--- Chunk ${String(chunk.num).padStart(2, '0')} ---\n`;
      mergedText += chunk.file.getBlob().getDataAsString();
      mergedText += '\n';
    });

    // 連番付きファイル名を生成
    const finalFileName = generateSequentialFileName(sessionId);
    docFolder.createFile(finalFileName, mergedText, MimeType.PLAIN_TEXT);

    Logger.log(`✅ 結合テキスト作成: ${finalFileName}`);

    // チャンクファイルを削除
    allChunkFiles.forEach(chunk => {
      chunk.file.setTrashed(true);
    });

    Logger.log(`🗑️ チャンクファイル削除完了`);
  }
}

// ==========================================
// 連番付きファイル名生成（YYMMDD_01形式）
// ==========================================
function generateSequentialFileName(sessionId) {
  const docFolder = DriveApp.getFolderById(CONFIG.DOC_FOLDER_ID);

  // セッションIDから日付部分を抽出（YYMMDD）
  const datePrefix = sessionId.substring(0, 6);

  // 同じ日付の既存ファイルを検索
  const files = docFolder.getFiles();
  let maxNum = 0;

  while (files.hasNext()) {
    const file = files.next();
    const fileName = file.getName();

    // YYMMDD_XX.txt 形式のファイルを検索
    const match = fileName.match(/^(\d{6})_(\d{2})\.txt$/);
    if (match && match[1] === datePrefix) {
      const num = parseInt(match[2]);
      if (num > maxNum) {
        maxNum = num;
      }
    }
  }

  // 次の連番
  const nextNum = String(maxNum + 1).padStart(2, '0');
  return `${datePrefix}_${nextNum}.txt`;
}

// ==========================================
// エラー報告（api_bank）
// ==========================================
function reportError(api_key) {
  try {
    UrlFetchApp.fetch(CONFIG.BANK_URL, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        pass: CONFIG.BANK_PASS,
        api_key: api_key
      }),
      muteHttpExceptions: true
    });
    Logger.log('📮 エラー報告送信完了');
  } catch (error) {
    Logger.log(`⚠️ エラー報告失敗: ${error.message}`);
  }
}

// ==========================================
// 手動テスト用（任意）
// ==========================================
function manualTest() {
  processVoiceFiles();
}
