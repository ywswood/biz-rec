/**
 * ========================================================================
 * 🟢 GAS用コード (transcription.js) - 音声文字起こし_分割対応
 * ========================================================================
 */

// ==========================================
// 設定
// ==========================================
const transcribeProps = PropertiesService.getScriptProperties().getProperties();

const CONFIG = {
    BANK_URL: transcribeProps.BANK_URL,
    BANK_PASS: transcribeProps.BANK_PASS,
    PROJECT_NAME: transcribeProps.PROJECT_NAME || 'biz-rec',
    TXT_FOLDER_ID: transcribeProps.TXT_FOLDER_ID,
    VOICE_FOLDER_ID: transcribeProps.VOICE_FOLDER_ID,
    ARCH_FOLDER_ID: transcribeProps.ARCH_FOLDER_ID, // 追加
    MAX_RETRIES: 3,
    RETRY_DELAY: 2000,
    API_TIMEOUT: 60000,
    MIN_TEXT_LENGTH: 10
};

// ==========================================
// メイン処理（トリガー実行: 1分ごと）
// ==========================================
function processVoiceFiles() {
    const voiceFolder = DriveApp.getFolderById(CONFIG.VOICE_FOLDER_ID);
    const fileEntries = [];
    const files = voiceFolder.getFiles();

    // 1. ファイルを一旦リスト化して名前（時刻順）でソート
    while (files.hasNext()) {
        const file = files.next();
        if (file.getName().endsWith('.webm')) {
            fileEntries.push(file);
        }
    }

    // 昇順ソート（古い録音から順に処理）
    fileEntries.sort((a, b) => a.getName().localeCompare(b.getName()));

    Logger.log(`=== 処理開始: 音声ファイルスキャン (${fileEntries.length}件) ===`);
    let count = 0;

    for (const file of fileEntries) {
        const fileName = file.getName();
        try {
            Logger.log(`🎤 処理開始: ${fileName}`);

            // 文字起こし実行
            const text = transcribeAudio(file);

            // 有意性判定
            if (!text || text.includes('SKIP') || text.length < CONFIG.MIN_TEXT_LENGTH) {
                Logger.log(`⚠️ 有意な内容なしと判定し破棄します: "${text || '(空文字)'}"`);
                file.setTrashed(true);
                continue;
            }

            // テキスト保存（排他制御・高速検索・インデックス遅延対策）
            saveTextToSessionFile(fileName, text);

            // 処理済み音声ファイルは即時削除
            file.setTrashed(true);
            Logger.log(`🗑️ 元音声ファイル削除: ${fileName}`);

            count++;
        } catch (e) {
            Logger.log(`❌ エラー (${fileName}): ${e.message}`);
        }
    }

    Logger.log(`=== 処理完了: ${count}件 ===`);
}

// ==========================================
// 文字起こし関数
// ==========================================
function transcribeAudio(file) {
    const blob = file.getBlob();
    return callApiBankTranscription(blob, file.getMimeType());
}

// 実際のAPI呼び出し部分
function callApiBankTranscription(blob, mimeType) {
    let previousModel = null;

    for (let attempt = 1; attempt <= CONFIG.MAX_RETRIES; attempt++) {
        try {
            let bankUrl = `${CONFIG.BANK_URL}?pass=${CONFIG.BANK_PASS}&project=${CONFIG.PROJECT_NAME}`;
            if (previousModel) {
                bankUrl += `&error_503=true&previous_model=${encodeURIComponent(previousModel)}`;
            }

            const bankRes = UrlFetchApp.fetch(bankUrl, { muteHttpExceptions: true });
            const bankData = JSON.parse(bankRes.getContentText());

            if (bankData.status === 'rate_limited') {
                const waitMs = bankData.wait_ms || CONFIG.RETRY_DELAY;
                Logger.log(`⏳ レート制限: ${waitMs}ms 待機します`);
                Utilities.sleep(waitMs);
                attempt--;
                continue;
            }

            if (bankData.status !== 'success') {
                throw new Error(`API Bank Error: ${bankData.message}`);
            }

            const { api_key, model_name } = bankData;

            const base64Audio = Utilities.base64Encode(blob.getBytes());
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model_name}:generateContent?key=${api_key}`;

            const payload = {
                contents: [{
                    parts: [
                        { text: "音声を書き起こしてください。フィラー（えー、あー）は取り除いてください。もし無音、ノイズのみ、または「テストです」「あーあー」などの無意味な発言、あるいは挨拶のみで内容がない場合は、書き起こさずに「SKIP」とだけ返してください。理由などの付随するコメントは一切不要です。" },
                        { inline_data: { mime_type: 'audio/webm', data: base64Audio } }
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

            if (statusCode === 503) {
                Logger.log(`⚠️ 503 Error: ${model_name} - 他のモデルで再試行します`);
                previousModel = model_name;
                Utilities.sleep(CONFIG.RETRY_DELAY);
                continue;
            }

            const geminiData = JSON.parse(geminiRes.getContentText());
            if (geminiData.error) {
                reportError(api_key);
                throw new Error(JSON.stringify(geminiData.error));
            }

            return geminiData.candidates[0].content.parts[0].text;

        } catch (error) {
            Logger.log(`❌ 試行 ${attempt}/${CONFIG.MAX_RETRIES}: ${error.message}`);
            if (attempt === CONFIG.MAX_RETRIES) throw error;
            Utilities.sleep(CONFIG.RETRY_DELAY);
        }
    }
}

// ==========================================
// セッションファイルへの保存
// ==========================================
function saveTextToSessionFile(originalFileName, text) {
    const lock = LockService.getScriptLock();
    try {
        lock.waitLock(30000);
    } catch (e) {
        throw new Error('Lock timeout');
    }

    try {
        const txtFolder = DriveApp.getFolderById(CONFIG.TXT_FOLDER_ID);

        // SessionIDの特定
        const sessionMatch = originalFileName.match(/^(\d{6}_\d{6})_chunk\d{2}\.webm$/);
        const sessionId = sessionMatch ? sessionMatch[1] : originalFileName.replace('.webm', '');
        const dateStr = sessionId.split('_')[0];

        const chunkMatch = originalFileName.match(/_chunk(\d{2})\.webm$/);
        const chunkNum = chunkMatch ? chunkMatch[1] : '00';
        const appendContent = `\n\n--- Chunk ${chunkNum} (${new Date().toLocaleTimeString()}) ---\n${text}`;

        // 2. 既存セッションファイルの検索
        let targetFile = null;
        const allFiles = txtFolder.getFiles();

        while (allFiles.hasNext()) {
            const f = allFiles.next();
            // 名前でまず絞り込み
            if (f.getName().indexOf(dateStr + "_") !== -1 && !f.isTrashed()) {
                // メタデータのSessionIDをチェック
                if (f.getDescription() === sessionId) {
                    targetFile = f;
                    break;
                }
                // インデックス遅延対策：中身に含まれるIDをチェック
                if (new Date().getTime() - f.getLastUpdated().getTime() < 60000) {
                    const content = f.getBlob().getDataAsString();
                    if (content.indexOf(`Original Session: ${sessionId}`) !== -1) {
                        targetFile = f;
                        if (!targetFile.getDescription()) targetFile.setDescription(sessionId);
                        break;
                    }
                }
            }
        }

        if (targetFile) {
            // 追記
            const currentContent = targetFile.getBlob().getDataAsString();
            targetFile.setContent(currentContent + appendContent);
            Logger.log(`📝 既存ファイル(${targetFile.getName()})に追記: ${sessionId}`);
        } else {
            // 新規作成: txtフォルダとarchフォルダの両方をスキャンして最大連番を特定
            let maxNum = 0;
            const foldersToScan = [CONFIG.TXT_FOLDER_ID, CONFIG.ARCH_FOLDER_ID];

            foldersToScan.forEach(folderId => {
                if (!folderId || folderId.trim() === "") return;
                try {
                    const folder = DriveApp.getFolderById(folderId);
                    const allFiles = folder.getFiles();
                    while (allFiles.hasNext()) {
                        const f = allFiles.next();
                        const fName = f.getName();
                        // 日付が一致するテキストファイル
                        if (fName.indexOf(dateStr + "_") === 0 && fName.endsWith(".txt") && !f.isTrashed()) {
                            const m = fName.match(/_(\d{2})\.txt$/);
                            if (m) {
                                const n = parseInt(m[1], 10);
                                if (n > maxNum) maxNum = n;
                            }
                        }
                    }
                } catch (err) {
                    Logger.log(`⚠️ フォルダスキャン失敗 (${folderId}): ${err.message}`);
                }
            });

            const nextNum = (maxNum + 1).toString().padStart(2, '0');
            const targetFileName = `${dateStr}_${nextNum}.txt`;

            const header = `=== 録音記録 ===\nOriginal Session: ${sessionId}\nFile Name: ${targetFileName}\n作成開始: ${new Date().toLocaleString()}\n`;
            const newFile = txtFolder.createFile(targetFileName, header + appendContent, MimeType.PLAIN_TEXT);

            newFile.setDescription(sessionId);
            Logger.log(`🆕 新規セッションファイル作成: ${targetFileName} (Session: ${sessionId})`);
        }

    } finally {
        lock.releaseLock();
    }
}

// ==========================================
// エラー報告
// ==========================================
function reportError(api_key) {
    try {
        UrlFetchApp.fetch(CONFIG.BANK_URL, {
            method: 'post',
            contentType: 'application/json',
            payload: JSON.stringify({ pass: CONFIG.BANK_PASS, api_key: api_key }),
            muteHttpExceptions: true
        });
    } catch (e) { }
}
