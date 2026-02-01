/**
 * ========================================================================
 * 🟢 議事録＆企画書 自動生成スクリプト
 * 🟢 このファイルの中身をすべてコピーして、新しいGASプロジェクトに貼り付けてください
 * ========================================================================
 * 
 * 【機能】
 * 1. txtフォルダの書き起こしテキストを監視
 * 2. 議事録がまだ作られていないファイルを検出
 * 3. Gemini APIを使って「議事録」と「商品企画書」をGoogleドキュメントとして自動生成
 * 4. 企画書には指定の画像を挿入
 * 
 * 【設定】
 * 1. API Bankの設定（transcription.jsと同じ）
 * 2. フォルダIDの設定
 * 3. サンプル画像の設定（下記 CONFIG.SAMPLE_IMAGE_NAME 参照）
 */

// ==========================================
// 設定
// ==========================================
const CONFIG = {
    // API Bank設定（transcription.jsと同じ）
    BANK_URL: 'https://script.google.com/macros/s/AKfycbxCscLkbbvTUU7sqpZSayJ8pEQlWl8mrEBaSy_FklbidJRc649HwWc4SF0Q3GvUQZbuGA/exec',
    BANK_PASS: '1030013',
    PROJECT_NAME: 'biz-record',

    // Google Driveフォルダ
    TXT_FOLDER_ID: '11gbAyd8kdgZN8bD29PDAm32B0LuboVtq', // 読み込み元（テキスト）
    DOC_FOLDER_ID: '1s3X47RZlrgDc3_MZQSgp5v9TvM8EUt_i', // 保存先（ドキュメント）
    VOICE_FOLDER_ID: '1Drp4_rkJsLpdC49tzRDACcCnQb_ywl4h', // 画像検索用（voiceフォルダなど）

    // サンプル画像名（Google Driveにこの名前で画像を置いてください）
    // 企画書に挿入されます
    SAMPLE_IMAGE_NAME: 'sample_product.png',

    // リトライ設定
    MAX_RETRIES: 3,
    RETRY_DELAY: 2000,
    API_TIMEOUT: 300 // 5分
};

// ==========================================
// プロンプト定義
// ==========================================
const PROMPTS = {
    MINUTES: `
以下の会議の書き起こしテキストから、指定のフォーマットで議事録を作成してください。

【出力フォーマット】
## 議事録：[会議名称]

### 1. 開催概要
* **日時：** 202X年MM月DD日（曜） HH:mm 〜 HH:mm (推定)
* **出席者：** テキストから推定される人物

### 2. 本日の目的
* [会議の主な目的を1〜2行で]

### 3. 決定事項
> **【決定】** [決定した内容1]
> **【決定】** [決定した内容2]

### 4. 協議内容（要旨）
#### [議題1]
* [内容]
#### [議題2]
* [内容]

### 5. ネクストアクション（ToDo）
| 期限 | タスク内容 | 担当者 |
| --- | --- | --- |
| MM/DD | [タスク1] | [氏名] |

### 6. 次回予定
* [次回の日程や議題など]
`,

    PROPOSAL: `
以下の会議の書き起こしテキストから、この会議で議論されている「新商品」に関する企画書を作成してください。

【出力フォーマット】
# 商品企画書：[商品名]

## 1. 商品コンセプト
[商品の魅力やコンセプトを情熱的に記述]

## 2. ターゲット層
* [ターゲット1]
* [ターゲット2]

## 3. 商品仕様（スペック）
| 項目 | 内容 |
| --- | --- |
| サイズ | [記述] |
| 素材 | [記述] |
| カラー | [記述] |
| 価格 | [記述] |

## 4. セールスポイント
1. **[ポイント1]**: [詳細]
2. **[ポイント2]**: [詳細]
3. **[ポイント3]**: [詳細]

## 5. キャッチコピー案
* 「[案1]」
* 「[案2]」
`
};

// ==========================================
// メイン処理（トリガー実行）
// ==========================================
async function processDocuments() {
    try {
        Logger.log('=== 書類生成処理を開始 ===');

        const txtFolder = DriveApp.getFolderById(CONFIG.TXT_FOLDER_ID);
        const docFolder = DriveApp.getFolderById(CONFIG.DOC_FOLDER_ID);
        const files = txtFolder.getFilesByType(MimeType.PLAIN_TEXT);

        let processedCount = 0;

        while (files.hasNext()) {
            const file = files.next();
            const fileName = file.getName(); // 例: 260201_01.txt

            // 連番ファイルのみ対象 (YYMMDD_XX.txt)
            if (!fileName.match(/^\d{6}_\d{2}\.txt$/)) continue;

            const baseName = fileName.replace('.txt', '');

            // 既に議事録があるかチェック
            const minutesName = `【議事録】${baseName}`;
            if (docFolder.getFilesByName(minutesName).hasNext()) {
                continue; // 作成済みならスキップ
            }

            Logger.log(`📄 新規テキスト検出: ${fileName}`);
            const textContent = file.getBlob().getDataAsString();

            // 1. 議事録作成
            const minutesContent = await callGemini(textContent, PROMPTS.MINUTES);
            if (minutesContent) {
                createGoogleDoc(docFolder, minutesName, minutesContent);
                Logger.log(`✅ 議事録作成完了: ${minutesName}`);
            }

            // 2. 企画書作成
            const proposalName = `【企画書】${baseName}`;
            if (!docFolder.getFilesByName(proposalName).hasNext()) {
                const proposalContent = await callGemini(textContent, PROMPTS.PROPOSAL);
                if (proposalContent) {
                    const imageBlob = findSampleImage();
                    createGoogleDoc(docFolder, proposalName, proposalContent, imageBlob);
                    Logger.log(`✅ 企画書作成完了: ${proposalName}`);
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
function createGoogleDoc(folder, title, content, imageBlob = null) {
    const doc = DocumentApp.create(title);
    const body = doc.getBody();

    // GeminiのMarkdown出力を簡易的にパースしてセット
    // (注: 本格的なMarkdownパースは複雑なため、ここではプレーンテキストとして貼り付けつつ
    //  必要な部分を目視で整えやすくする、あるいは簡易整形を行う)

    body.setText(content);

    // 画像がある場合、最後またはタイトルの下に挿入
    if (imageBlob) {
        body.insertParagraph(0, ""); // スペース
        const image = body.insertImage(1, imageBlob);
        image.setWidth(400); // サイズ調整
        image.setHeight(400 * (imageBlob.getHeight() ? imageBlob.getHeight() / imageBlob.getWidth() : 1));
    }

    doc.saveAndClose();

    // 作成されたドキュメントを指定フォルダに移動
    const docFile = DriveApp.getFileById(doc.getId());
    docFile.moveTo(folder);
}

// ==========================================
// 画像検索
// ==========================================
function findSampleImage() {
    try {
        // voiceフォルダ、またはtxtフォルダから画像を探す
        const foldersToCheck = [CONFIG.VOICE_FOLDER_ID, CONFIG.TXT_FOLDER_ID];

        for (const folderId of foldersToCheck) {
            const folder = DriveApp.getFolderById(folderId);
            const files = folder.getFilesByName(CONFIG.SAMPLE_IMAGE_NAME);
            if (files.hasNext()) {
                Logger.log(`🖼️ 画像発見: ${CONFIG.SAMPLE_IMAGE_NAME} in ${folder.getName()}`);
                return files.next().getBlob();
            }
        }

        Logger.log(`⚠️ 画像が見つかりません: ${CONFIG.SAMPLE_IMAGE_NAME}`);
        return null;
    } catch (e) {
        Logger.log(`⚠️ 画像検索エラー: ${e.message}`);
        return null;
    }
}

// ==========================================
// Gemini API 呼び出し (共通関数)
// ==========================================
async function callGemini(text, systemPrompt) {
    let previousModel = null;

    for (let attempt = 1; attempt <= CONFIG.MAX_RETRIES; attempt++) {
        try {
            // API Bankからキー取得
            let bankUrl = `${CONFIG.BANK_URL}?pass=${CONFIG.BANK_PASS}&project=${CONFIG.PROJECT_NAME}`;
            if (previousModel) {
                bankUrl += `&error_503=true&previous_model=${encodeURIComponent(previousModel)}`;
            }

            const bankRes = UrlFetchApp.fetch(bankUrl, { muteHttpExceptions: true });
            const bankData = JSON.parse(bankRes.getContentText());

            if (bankData.status !== 'success') {
                throw new Error(bankData.message);
            }

            const { api_key, model_name } = bankData;

            // Gemini API リクエスト
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
                timeout: CONFIG.API_TIMEOUT
            });

            const statusCode = geminiRes.getResponseCode();

            if (statusCode === 503) {
                previousModel = model_name;
                Utilities.sleep(CONFIG.RETRY_DELAY);
                continue;
            }

            const geminiData = JSON.parse(geminiRes.getContentText());

            if (geminiData.error) {
                throw new Error(JSON.stringify(geminiData.error));
            }

            return geminiData.candidates[0].content.parts[0].text;

        } catch (error) {
            Logger.log(`❌ Gemini呼び出しエラー(試行${attempt}): ${error.message}`);
            if (attempt === CONFIG.MAX_RETRIES) return null;
            Utilities.sleep(CONFIG.RETRY_DELAY);
        }
    }
    return null;
}
