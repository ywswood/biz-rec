/**
 * ========================================================================
 * 🟢 議事録＆企画書 自動生成スクリプト（完全版：メール送信付き・変数名重複対応）
 * 🟢 transcription.gs と共存可能
 * ========================================================================
 */

// ==========================================
// 設定 (MINUTES_CONFIG)
// ==========================================
// スクリプトプロパティから取得
const minutesProps = PropertiesService.getScriptProperties().getProperties();

const MINUTES_CONFIG = {
    BANK_URL: minutesProps.BANK_URL,
    BANK_PASS: minutesProps.BANK_PASS,
    PROJECT_NAME: minutesProps.PROJECT_NAME,
    TXT_FOLDER_ID: minutesProps.TXT_FOLDER_ID,
    DOC_FOLDER_ID: minutesProps.DOC_FOLDER_ID,
    ARCH_FOLDER_ID: minutesProps.ARCH_FOLDER_ID,
    VOICE_FOLDER_ID: minutesProps.VOICE_FOLDER_ID,
    NOTIFICATION_EMAIL: minutesProps.NOTIFICATION_EMAIL,
    SAMPLE_IMAGE_NAME: minutesProps.SAMPLE_IMAGE_NAME || 'sample_product.png',
    MAX_RETRIES: parseInt(minutesProps.MAX_RETRIES || '3', 10),
    RETRY_DELAY: parseInt(minutesProps.RETRY_DELAY || '2000', 10),
    API_TIMEOUT: parseInt(minutesProps.API_TIMEOUT || '300', 10)
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
　　・ [必須数値：価格、数量、原価率、期間などの数字は必ず記載。「数値言及なし」の場合はその旨明記]

(4) ■ 【決定事項】
　● [決定事項1]
　　・ 詳細は簡潔に記述
　● [決定事項2]
　　・ 詳細は簡潔に記述
　※重要。目立つように【決定】と隅付き括弧で強調する（Markdownの太字は使わない）。

(5) ■ 懸念・リスク事項
　● 営業利益目標への阻害要因
　　・ [具体的な懸念点]

(6) ■ ネクストアクション
　　・ [期限] [担当] : [内容]
　　・ [期限] [担当] : [内容]
　※表形式は使わず、箇条書きで記載する。

(7) ■ 会議の総括評価（AI視点）
　・ この会議が今期の「営業利益」にどう貢献するか、または何が不足していたかを客観的に評価。

# 出力開始
余計な挨拶や前置きは一切不要です。
1行目のタイトル「議事録_YYMMDD_XX」から出力してください。
`,

    PROPOSAL: `
以下の会議の書き起こしテキストから、この会議で議論されている「新商品」に関する企画書を作成してください。

【重要ルール】
- **冒頭の挨拶は一切不要です。**
- **企画書の中身（見出し以降）のみ**を出力してください。
- **提案先（商談先）の情報を書き起こしから読み取り、その企業に最適化した提案にしてください。**

【出力フォーマット】
# 商品企画書：[商品名]

## 0. 提案先情報
* **企業名:** [書き起こしから読み取れる商談先企業名]
* **業種・業態:** [推定される業種]
* **主な課題・ニーズ:** [会議で言及された課題やニーズ]

## 1. 商品コンセプト
[商品の魅力やコンセプトを情熱的に記述]

## 2. ターゲット層（提案先に最適化）
* [提案先企業の顧客層や、提案先が狙うべきターゲットを具体的に記述]
* [提案先の業種・業態に合わせたターゲット像]

## 3. 商品仕様（スペック）
| 項目 | 内容 |
| --- | --- |
| サイズ | [記述] |
| 素材 | [記述] |
| カラー | [記述] |
| 価格 | [記述] |

## 4. セールスポイント（提案先向け）
1. **[提案先の課題を解決するポイント1]**: [なぜこの提案先に有効か詳細]
2. **[提案先のニーズに応えるポイント2]**: [提案先のビジネスにどう貢献するか]
3. **[競合優位性ポイント3]**: [提案先が採用すべき理由]

## 5. 導入メリット（提案先視点）
* **売上向上:** [具体的な期待効果]
* **差別化:** [競合との差別化ポイント]
* **顧客満足:** [エンドユーザーへの価値]

## 6. キャッチコピー案
* 「[案1]」
* 「[案2]」
`
};

// ==========================================
// メイン処理（トリガー実行）
// ==========================================
// ==========================================
// Webアプリケーション (doPost) - 外部からの実行用
// ==========================================
// ==========================================
// Webアプリケーション (doPost) - 外部からの実行用
// ==========================================
function doPost(e) {
    try {
        const postData = JSON.parse(e.postData.contents);
        const action = postData.action;

        // 📥 音声アップロード処理 (action: 'upload_chunk')
        if (action === 'upload_chunk') {
            const fileName = postData.fileName;
            const fileData = postData.fileData; // Base64 string

            if (!fileName || !fileData) {
                throw new Error('Missing fileName or fileData');
            }

            const folder = DriveApp.getFolderById(MINUTES_CONFIG.VOICE_FOLDER_ID);
            const decodedData = Utilities.base64Decode(fileData);
            const blob = Utilities.newBlob(decodedData, 'audio/webm', fileName);

            const file = folder.createFile(blob);
            Logger.log(`✅ ファイル保存完了: ${fileName} (${file.getId()})`);

            return ContentService.createTextOutput(JSON.stringify({
                status: 'success',
                message: 'Upload successful',
                fileId: file.getId()
            })).setMimeType(ContentService.MimeType.JSON);
        }

        // 📑 報告書生成リクエスト (action: 'create_report') または その他
        Logger.log("🌐 Webアプリ経由のリクエストを受信しました（非同期モード）");

        // 一回限りのトリガーを作成して即座に終了する
        ScriptApp.newTrigger('executeAsyncTasks')
            .timeBased()
            .after(1) // 1ミリ秒後（実質即時）
            .create();

        // 待たせずにレスポンスを返す
        return ContentService.createTextOutput(JSON.stringify({
            status: 'success',
            message: 'Request accepted. Processing started in background.'
        })).setMimeType(ContentService.MimeType.JSON);

    } catch (error) {
        Logger.log(`❌ Webアプリ受付エラー: ${error.toString()}`);
        return ContentService.createTextOutput(JSON.stringify({
            status: 'error',
            message: error.toString()
        })).setMimeType(ContentService.MimeType.JSON);
    }
}

/**
 * 非同期実行用のラッパー関数
 * doPostからトリガー経由で呼び出される
 */
function executeAsyncTasks() {
    try {
        Logger.log("🚀 バックグラウンド処理を開始します");

        // 1. 音声ファイルの文字起こし実行 (transcription.jsの関数)
        if (typeof processVoiceFiles === 'function') {
            Logger.log("▶ processVoiceFiles() を実行します");
            processVoiceFiles();
        } else {
            Logger.log("⚠️ processVoiceFiles が見つかりません");
        }

        // 2. 書類生成の強制実行
        Logger.log("▶ processDocuments(true) を実行します");
        processDocuments(true);

        Logger.log("✅ バックグラウンド処理が完了しました");

    } catch (error) {
        Logger.log(`❌ バックグラウンド実行エラー: ${error.toString()}`);
        Logger.log(error.stack);
    }
}

// ==========================================
// 手動実行用 (待機時間を無視して強制実行)
// ==========================================
function manualRun() {
    processDocuments(true);
}

// ==========================================
// メイン処理（トリガー実行）
// force = true の場合は待機時間を無視
// ==========================================
function processDocuments(force = false) {
    try {
        Logger.log(`=== 書類生成処理を開始 (Force: ${force}) ===`);

        const txtFolder = DriveApp.getFolderById(MINUTES_CONFIG.TXT_FOLDER_ID);
        const docFolder = DriveApp.getFolderById(MINUTES_CONFIG.DOC_FOLDER_ID);
        const archFolder = DriveApp.getFolderById(MINUTES_CONFIG.ARCH_FOLDER_ID);
        const files = txtFolder.getFilesByType(MimeType.PLAIN_TEXT);

        let processedCount = 0;
        const STABILITY_THRESHOLD_MS = 20 * 60 * 1000; // 20分以内の更新は処理しない

        while (files.hasNext()) {
            const file = files.next();
            const fileName = file.getName(); // 例: 260201_150000.txt

            // 連番ファイル(_01) または タイムスタンプ(_162256) の両方を許可
            if (!fileName.match(/^\d{6}_(\d{2}|\d{6})\.txt$/)) continue;

            // 強制実行でない場合のみ、待機判定を行う
            if (!force) {
                const lastUpdated = file.getLastUpdated().getTime();
                const now = Date.now();

                if (now - lastUpdated < STABILITY_THRESHOLD_MS) {
                    Logger.log(`⏳ 待機中（更新直後）: ${fileName}`);
                    continue;
                }
            } else {
                Logger.log(`⚡ 強制実行: ${fileName}（待機時間をスキップします）`);
            }

            const baseName = fileName.replace('.txt', '');

            // 既に議事録があるかチェック
            const minutesName = `【議事録】${baseName}`;
            if (docFolder.getFilesByName(minutesName).hasNext()) {
                Logger.log(`⚠️ 既作成済みスキップ: ${minutesName}`);
                // 既に作成済みなら、元ファイルはアーカイブへ移動（整理のため）
                try {
                    file.moveTo(archFolder);
                    Logger.log(`📦 (既済) アーカイブ移動完了: ${fileName}`);
                } catch (e) {
                    Logger.log(`⚠️ (既済) アーカイブ移動失敗: ${e.message}`);
                }
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

            // 3. メール送信
            if (createdFiles.length > 0) {
                sendNotificationEmail(baseName, createdFiles, minutesContent);

                // 4. 元ファイルをアーカイブへ移動（成功時のみ）
                try {
                    file.moveTo(archFolder);
                    Logger.log(`📦 アーカイブ移動完了: ${fileName}`);
                } catch (e) {
                    Logger.log(`⚠️ アーカイブ移動失敗: ${e.message}`);
                }
            }

            processedCount++;
        }

        Logger.log(`=== 処理完了: ${processedCount}件のファイルを処理 ===`);

    } catch (error) {
        Logger.log(`❌ メイン処理エラー: ${error.message}`);
        Logger.log(error.stack);
    }
}

// ==========================================
// Googleドキュメント作成
// ==========================================
function createMinutesDoc(folder, title, content, imageBlob = null) {
    const doc = DocumentApp.create(title);
    const body = doc.getBody();

    body.setText(content);

    // 画像がある場合
    if (imageBlob) {
        try {
            body.insertParagraph(0, "");
            const image = body.insertImage(1, imageBlob);

            // 修正: getHeightを使わず幅のみ指定
            const originalWidth = image.getWidth();
            if (originalWidth > 400) {
                image.setWidth(400);
                // 高さは自動
            }
        } catch (e) {
            Logger.log(`⚠️ 画像挿入中にエラー(スキップしました): ${e.message}`);
        }
    }

    doc.saveAndClose();

    // フォルダ移動とファイル取得
    const docFile = DriveApp.getFileById(doc.getId());
    docFile.moveTo(folder);

    return docFile;
}

// ==========================================
// メール送信
// ==========================================
function sendNotificationEmail(baseName, files, minutesContent = null) {
    const subject = `【商談書類生成】${baseName}`;
    let body = `商談の自動文字起こしから、以下の書類を生成しました。\n\n`;
    const attachments = [];

    files.forEach(file => {
        body += `・${file.getName()}\n${file.getUrl()}\n`;
        attachments.push(file.getAs(MimeType.PDF));
    });

    // 議事録内容をメール本文に追加
    if (minutesContent) {
        body += `\n${'='.repeat(50)}\n`;
        body += `📋 議事録内容（クイックビュー）\n`;
        body += `${'='.repeat(50)}\n\n`;
        body += minutesContent;
        body += `\n\n${'='.repeat(50)}\n`;
    }

    body += `\n以上のファイルをPDFとして添付しました。ご確認ください。\n`;
    body += `\n--\nBiz-Record Bot`;

    MailApp.sendEmail({
        to: MINUTES_CONFIG.NOTIFICATION_EMAIL,
        subject: subject,
        body: body,
        attachments: attachments
    });

    Logger.log(`📧 メール送信完了: ${MINUTES_CONFIG.NOTIFICATION_EMAIL}`);
}

// ==========================================
// 画像検索
// ==========================================
function findSampleImage() {
    try {
        const foldersToCheck = [MINUTES_CONFIG.VOICE_FOLDER_ID, MINUTES_CONFIG.TXT_FOLDER_ID];

        for (const folderId of foldersToCheck) {
            const folder = DriveApp.getFolderById(folderId);
            const files = folder.getFilesByName(MINUTES_CONFIG.SAMPLE_IMAGE_NAME);
            if (files.hasNext()) {
                return files.next().getBlob();
            }
        }
        return null;
    } catch (e) {
        return null;
    }
}

// ==========================================
// Gemini API 呼び出し
// ==========================================
function callGeminiForMinutes(text, systemPrompt) {
    let previousModel = null;

    for (let attempt = 1; attempt <= MINUTES_CONFIG.MAX_RETRIES; attempt++) {
        try {
            let bankUrl = `${MINUTES_CONFIG.BANK_URL}?pass=${MINUTES_CONFIG.BANK_PASS}&project=${MINUTES_CONFIG.PROJECT_NAME}`;
            if (previousModel) {
                bankUrl += `&error_503=true&previous_model=${encodeURIComponent(previousModel)}`;
            }

            const bankRes = UrlFetchApp.fetch(bankUrl, { muteHttpExceptions: true });
            const bankData = JSON.parse(bankRes.getContentText());

            if (bankData.status !== 'success') {
                throw new Error(bankData.message);
            }

            const { api_key, model_name } = bankData;
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model_name}:generateContent?key=${api_key}`;

            const payload = {
                contents: [{
                    parts: [{ text: systemPrompt + "\n\n【書き起こしテキスト】\n" + text }]
                }]
            };

            const geminiRes = UrlFetchApp.fetch(apiUrl, {
                method: 'post',
                contentType: 'application/json',
                payload: JSON.stringify(payload),
                muteHttpExceptions: true,
                timeout: MINUTES_CONFIG.API_TIMEOUT
            });

            const statusCode = geminiRes.getResponseCode();

            if (statusCode === 503) {
                previousModel = model_name;
                Utilities.sleep(MINUTES_CONFIG.RETRY_DELAY);
                continue;
            }

            const geminiData = JSON.parse(geminiRes.getContentText());

            if (geminiData.error) {
                throw new Error(JSON.stringify(geminiData.error));
            }

            return geminiData.candidates[0].content.parts[0].text;

        } catch (error) {
            Logger.log(`❌ Gemini呼び出しエラー(試行${attempt}): ${error.message}`);
            if (attempt === MINUTES_CONFIG.MAX_RETRIES) return null;
            Utilities.sleep(MINUTES_CONFIG.RETRY_DELAY);
        }
    }
    return null;
}
