/**
 * ========================================================================
 * 🟢 議事録＆企画書 自動生成スクリプト（アーカイブ移動：テキストのみ対応版）
 * 🟢 transcription.js と共存可能
 * ========================================================================
 */

// ==========================================
// 設定 (MINUTES_CONFIG)
// ==========================================
const minutesProps = PropertiesService.getScriptProperties().getProperties();

const MINUTES_CONFIG = {
    BANK_URL: minutesProps.BANK_URL,
    BANK_PASS: minutesProps.BANK_PASS,
    PROJECT_NAME: minutesProps.PROJECT_NAME || 'biz-rec',
    TXT_FOLDER_ID: minutesProps.TXT_FOLDER_ID,
    DOC_FOLDER_ID: minutesProps.DOC_FOLDER_ID,
    ARCH_FOLDER_ID: minutesProps.ARCH_FOLDER_ID, // テキスト保管用
    VOICE_FOLDER_ID: minutesProps.VOICE_FOLDER_ID,
    NOTIFICATION_EMAIL: minutesProps.NOTIFICATION_EMAIL,
    SAMPLE_IMAGE_NAME: minutesProps.SAMPLE_IMAGE_NAME || 'sample_product.png',
    MAX_RETRIES: 3,
    RETRY_DELAY: 2000,
    API_TIMEOUT: 60000
};

// ==========================================
// プロンプト定義 (MINUTES_PROMPTS)
// ==========================================
const MINUTES_PROMPTS = {
    MINUTES: `
以下の会議の書き起こしテキストから、指定のフォーマットで議事録を作成してください。

# 全体目標
**今期目標：営業利益の最大化**
※すべての内容は、この目標達成にどう寄与するかという視点で整理してください。

# 議事録の構成・出力ルール（厳守）

## 1. 書式とレイアウト（Googleドキュメント用最適化）
Googleドキュメントへ「書式なしテキスト」として貼り付けた際に、手直し不要で美しく見えるよう、以下の記号と改行ルールを絶対に守ってください。

*   **Markdown禁止**：# ## ** __ などのMarkdown記号は一切使用しないこと。
*   **見出し記号の統一**：
    *   大見出し（セクション）： ■ （全角四角＋半角スペース）
    *   中見出し（トピック）： 　● （全角スペース＋全角丸＋半角スペース）
    *   小見出し・詳細： 　　・ （全角スペース2つ＋全角中黒＋半角スペース）
*   **改行・余白のルール**：
    *   ■（大見出し）の前は、必ず「2行」の空行を入れる。
    *   ●（中見出し）の前は、必ず「1行」の空行を入れる。
    *   セクション内の文章は適度に改行し、詰まりすぎないようにする。

## 2. 記述ルール
*   個人名は記載しない（役割・部署名・「担当者」と記載）。
*   文体は「です・ます」調ではなく、簡潔な「である」調、または体言止めとする。

## 3. 記事構成（階層構造）
以下のセクション順序で出力すること。

(1) 議事録_[ファイル名の日付_連番]（例: 議事録_260202_01）（1行目にタイトルとして記載。入力テキストのファイル名情報から抽出）

(2) ■ 基本情報
　● 日時
　　・ [入力テキストから推定される日時]
　● 議題
　　・ [会議の主な議題]
　● 参加部署
　　・ [推測可能な範囲で記述]

(3) ■ 議論詳細（※ここがメイン）
　● [テーマごとの見出し]
　　・ [詳細内容]
　　・ [具体的なアクション（誰が、いつ、何を、いくらで）]
　　・ [必須数値：価格、数量、原価率、期間などの数字は必ず記載]

(4) ■ 【決定事項】
　● [決定事項]
　　・ 詳細は簡潔に記述

(5) ■ 懸念・リスク事項
(6) ■ ネクストアクション
(7) ■ 会議の総括評価（AI視点）

# 出力開始
余計な挨拶や前置きは一切不要です。
1行目のタイトル「議事録_YYMMDD_XX」から出力してください。
`,

    PROPOSAL: `
以下の会議の書き起こしテキストから、この会議で議論されている「新商品」に関する企画書を作成してください。

【重要ルール】
- **冒頭の挨拶は一切不要です。**
- **企画書の中身（見出し以降）のみ**を出力してください。

【出力フォーマット】
# 商品企画書：[商品名]

## 0. 提案先情報
* **企業名:** [商談先企業名]
* **業種・業態:** [推定される業種]
* **主な課題・ニーズ:** [言及された課題]

## 1. 商品コンセプト
## 2. ターゲット層
## 3. 商品仕様（スペック）
## 4. セールスポイント
## 5. 導入メリット
## 6. キャッチコピー案
`
};

// ==========================================
// Webアプリケーション (doPost) - 非同期化対応
// ==========================================
function doPost(e) {
    try {
        const postData = JSON.parse(e.postData.contents);
        const action = postData.action;

        // 📥 音声アップロード（これは軽量なので同期でOK）
        if (action === 'upload_chunk') {
            const folder = DriveApp.getFolderById(MINUTES_CONFIG.VOICE_FOLDER_ID);
            const blob = Utilities.newBlob(Utilities.base64Decode(postData.fileData), 'audio/webm', postData.fileName);
            folder.createFile(blob);
            return ContentService.createTextOutput(JSON.stringify({ status: 'success' })).setMimeType(ContentService.MimeType.JSON);
        }

        // 📑 書類生成（重いのでトリガーで分離）
        if (action === 'create_report') {
            // 1秒後に実行するトリガーを作成（非同期実行の開始）
            ScriptApp.newTrigger('executeAsyncTasks')
                .timeBased()
                .after(1000)
                .create();

            // 待たせずに即座にレスポンスを返す（スマホのエラーを防止）
            return ContentService.createTextOutput(JSON.stringify({
                status: 'success',
                message: 'Processing started in background.'
            })).setMimeType(ContentService.MimeType.JSON);
        }

        return ContentService.createTextOutput(JSON.stringify({ status: 'error' })).setMimeType(ContentService.MimeType.JSON);
    } catch (error) {
        return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: error.toString() })).setMimeType(ContentService.MimeType.JSON);
    }
}

/**
 * バックグラウンドで実行される実処理
 */
function executeAsyncTasks() {
    // まず自分を呼び出したトリガーを掃除（ゾンビ化防止）
    const triggers = ScriptApp.getProjectTriggers();
    triggers.forEach(t => {
        if (t.getHandlerFunction() === 'executeAsyncTasks') ScriptApp.deleteTrigger(t);
    });

    try {
        Logger.log("🚀 非同期タスクを開始しました");
        if (typeof processVoiceFiles === 'function') processVoiceFiles();
        processDocuments(true);
        Logger.log("✅ 全行程が完了しました");
    } catch (e) {
        Logger.log(`❌ 非同期実行エラー: ${e.toString()}`);
    }
}

function manualRun() {
    processDocuments(true);
}

// ==========================================
// メイン処理（テキストフォルダを監視し、成功したらアーカイブへ移動）
// ==========================================
function processDocuments(force = false) {
    try {
        Logger.log(`=== 書類生成処理を開始 (Force: ${force}) ===`);

        const txtFolder = DriveApp.getFolderById(MINUTES_CONFIG.TXT_FOLDER_ID);
        const docFolder = DriveApp.getFolderById(MINUTES_CONFIG.DOC_FOLDER_ID);
        const archFolder = DriveApp.getFolderById(MINUTES_CONFIG.ARCH_FOLDER_ID);
        const files = txtFolder.getFilesByType(MimeType.PLAIN_TEXT);

        let processedCount = 0;

        while (files.hasNext()) {
            const file = files.next();
            const fileName = file.getName();

            if (!fileName.match(/^\d{6}_\d{2,6}\.txt$/)) continue;

            // 自動実行の無効化（force=trueのみ）
            if (!force) {
                Logger.log(`⏳ 自動生成は無効化されています: ${fileName}`);
                continue;
            }

            const baseName = fileName.replace('.txt', '');
            const minutesName = `【議事録】${baseName}`;

            // 作成済みチェック
            if (docFolder.getFilesByName(minutesName).hasNext()) {
                Logger.log(`⚠️ 既作成済みにつきアーカイブへ直接移動: ${minutesName}`);
                file.moveTo(archFolder);
                continue;
            }

            Logger.log(`📄 書類生成ターゲット検出: ${fileName}`);
            const textContent = file.getBlob().getDataAsString();
            let createdFiles = [];

            // 1. 議事録作成
            const minutesContent = callGeminiForMinutes(textContent, MINUTES_PROMPTS.MINUTES);
            if (minutesContent) {
                const docFile = createMinutesDoc(docFolder, minutesName, minutesContent);
                createdFiles.push(docFile);
                Logger.log(`✅ 議事録作成完了: ${minutesName}`);
            }

            // 2. 企画書作成
            const proposalName = `【企画書】${baseName}`;
            if (!docFolder.getFilesByName(proposalName).hasNext()) {
                const proposalContent = callGeminiForMinutes(textContent, MINUTES_PROMPTS.PROPOSAL);
                if (proposalContent) {
                    const imageBlob = findSampleImage();
                    const docFile = createMinutesDoc(docFolder, proposalName, proposalContent, imageBlob);
                    createdFiles.push(docFile);
                    Logger.log(`✅ 企画書作成完了: ${proposalName}`);
                }
            }

            // 3. メール送信とアーカイブ移動
            if (createdFiles.length > 0) {
                sendNotificationEmail(baseName, createdFiles, minutesContent);
                try {
                    file.moveTo(archFolder); // テキストファイルをアーカイブへ移動
                    Logger.log(`📦 テキストアーカイブ移動完了: ${fileName}`);
                } catch (e) {
                    Logger.log(`⚠️ アーカイブ移動失敗: ${e.message}`);
                }
            }
            processedCount++;
        }
        Logger.log(`=== 処理完了: ${processedCount}件 ===`);
    } catch (error) {
        Logger.log(`❌ メイン処理エラー: ${error.message}`);
    }
}

function createMinutesDoc(folder, title, content, imageBlob = null) {
    const doc = DocumentApp.create(title);
    const body = doc.getBody();
    body.setText(content);
    if (imageBlob) {
        try {
            body.insertParagraph(0, "");
            body.insertImage(1, imageBlob).setWidth(400);
        } catch (e) { }
    }
    doc.saveAndClose();
    const docFile = DriveApp.getFileById(doc.getId());
    docFile.moveTo(folder);
    return docFile;
}

function sendNotificationEmail(baseName, files, minutesContent = null) {
    const subject = `【商談書類生成】${baseName}`;
    let body = `商談の自動文字起こしから、以下の書類を生成しました。\n\n`;
    const attachments = [];

    files.forEach(file => {
        body += `・${file.getName()}\n${file.getUrl()}\n`;
        attachments.push(file.getAs(MimeType.PDF));
    });

    if (minutesContent) {
        body += `\n${'='.repeat(30)}\n📋 議事録クイックビュー\n${minutesContent}\n${'='.repeat(30)}\n`;
    }

    MailApp.sendEmail({
        to: MINUTES_CONFIG.NOTIFICATION_EMAIL,
        subject: subject,
        body: body,
        attachments: attachments
    });
}

function findSampleImage() {
    try {
        const foldersToCheck = [MINUTES_CONFIG.VOICE_FOLDER_ID, MINUTES_CONFIG.TXT_FOLDER_ID];
        for (const folderId of foldersToCheck) {
            const folder = DriveApp.getFolderById(folderId);
            const files = folder.getFilesByName(MINUTES_CONFIG.SAMPLE_IMAGE_NAME);
            if (files.hasNext()) return files.next().getBlob();
        }
    } catch (e) { }
    return null;
}

function callGeminiForMinutes(text, systemPrompt) {
    let previousModel = null;
    for (let attempt = 1; attempt <= MINUTES_CONFIG.MAX_RETRIES; attempt++) {
        try {
            let bankUrl = `${MINUTES_CONFIG.BANK_URL}?pass=${MINUTES_CONFIG.BANK_PASS}&project=${MINUTES_CONFIG.PROJECT_NAME}`;
            if (previousModel) bankUrl += `&error_503=true&previous_model=${encodeURIComponent(previousModel)}`;
            const bankRes = UrlFetchApp.fetch(bankUrl, { muteHttpExceptions: true });
            const bankData = JSON.parse(bankRes.getContentText());
            if (bankData.status === 'rate_limited') {
                Utilities.sleep(bankData.wait_ms || MINUTES_CONFIG.RETRY_DELAY);
                attempt--; continue;
            }
            if (bankData.status !== 'success') throw new Error();
            const { api_key, model_name } = bankData;
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model_name}:generateContent?key=${api_key}`;
            const payload = { contents: [{ parts: [{ text: systemPrompt + "\n\n【書き起こし】\n" + text }] }] };
            const geminiRes = UrlFetchApp.fetch(apiUrl, { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true });
            if (geminiRes.getResponseCode() === 503) {
                previousModel = model_name;
                Utilities.sleep(MINUTES_CONFIG.RETRY_DELAY);
                continue;
            }
            const geminiData = JSON.parse(geminiRes.getContentText());
            if (geminiData.error) {
                reportErrorForMinutes(api_key);
                throw new Error();
            }
            return geminiData.candidates[0].content.parts[0].text;
        } catch (error) {
            if (attempt === MINUTES_CONFIG.MAX_RETRIES) return null;
            Utilities.sleep(MINUTES_CONFIG.RETRY_DELAY);
        }
    }
    return null;
}

function reportErrorForMinutes(api_key) {
    try {
        UrlFetchApp.fetch(MINUTES_CONFIG.BANK_URL, {
            method: 'post',
            contentType: 'application/json',
            payload: JSON.stringify({ pass: MINUTES_CONFIG.BANK_PASS, api_key: api_key }),
            muteHttpExceptions: true
        });
    } catch (e) { }
}
