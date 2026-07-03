# Cognitive Feed — 把 doomscroll 變成學習的設計

日期：2026-07-03
狀態：已定稿（brainstorming 六輪問答收斂）

## 立場（theory of change）

- **滑是入口，互動才是學習。** 被動 re-reading 在認知科學上近乎無效（fluency illusion）；
  feed 的職責是把人騙進來，學習發生在生成性動作（reply、quote-repost）。
- **獎勵三路並收**：過去的自己當觀眾（間隔重現舊回覆）、AI 當假觀眾（Groq）、
  可視 vault 成長。真社交（多人）明確砍掉，不在 scope。
- **排序糖衣包藥**：engagement 相似度當糖衣，注入 spacing + interleaving 當藥粉。
- **AI 內容進 vault、標記身分**（`author: recall-bot`），維持「vault 是唯一真相來源」，
  但排除於搜尋索引、TF-IDF centroid 與 For-you 候選池。

## §1 記憶模型與排程器

### Sidecar 記憶帳本

`vault/.wiki-thread/memory.json`（與 state.json 並列，gitignored）：

```json
{ "<note-id>": { "lastSeen": 0, "lastRetrieved": 0, "strength": 0.5,
                 "reviews": [{ "t": 0, "kind": "reply", "delta": 0.3 }] } }
```

### 事件 → strength

| 事件 | 效果 |
|---|---|
| view（dwell ≥ 3s） | strength +0.02（弱曝光） |
| like / save | 只餵 engagement centroid，**不碰 strength** |
| 表情自評 🤔/🙂/😎 | strength 錨定 0.3 / 0.6 / 0.9 |
| quote-repost / reply | 金標準：+0.3，重置遺忘時鐘（lastRetrieved） |
| Groq 評 reply 品質 | 在金標準上 ±0.15 修正（隱藏分，使用者不可見） |

### 遺忘曲線（簡化版，零依賴）

```
effectiveStrength = strength × exp(-Δdays / (7 × (1 + reviews.length)))
```

複習次數越多半衰期越長 = spacing effect。Δdays 以 lastRetrieved 起算（無則 lastSeen）。

### rankForYou() 三項加權

```
score = 0.50 × engagement 相似度（現有 TF-IDF + tag + 鄰接邏輯不動）
      + 0.35 × (1 − effectiveStrength)      // 快忘的浮上來
      + 0.15 × 交錯懲罰                      // 與前一篇同 tag 降權，強制 interleaving
```

冷啟動照舊 recency。

## §2 AI 觀眾（Groq）

- **整合**：`server.js` 用 Node 18+ 內建 `fetch` 打 Groq（OpenAI 相容 endpoint）。
  Key 讀 `GROQ_API_KEY`，啟動時以 ~10 行 parser 讀一次 `.env`（不裝 dotenv）。
  **沒 key → AI 功能整體靜默消失**，zero-dep 承諾無傷。
- **提問貼文**：組 feed 時挑 effectiveStrength 最低的到期筆記生成提問卡，
  以 `@recall-bot` 口吻貼出、threaded 在原筆記下。
  **煞車：每 8 篇至多 1 張、每天上限 5 張**（防止排程器判定「全都快忘了」而刷屏）。
- **回評**：使用者 reply 後送 Groq，「好奇的朋友」人設：先肯定對的、指出一個遺漏、
  收在追問。回傳隱藏 0–1 品質分餵 §1。**絕不出現分數、勾叉、「正確答案是」**。
- **戶籍**：兩者都寫成真 `.md` 至 `vault/replies/ai/`，frontmatter
  `author: recall-bot`、`tags: [ai]`。`buildIndex()` 據此排除於搜尋索引、
  TF-IDF centroid、For-you 候選池——只作為 thread 回覆存在；提問卡是唯一例外，
  由排程器主動插入 feed。
- **失敗模式**：Groq timeout / 429 → 提問卡不生成、回評靜默略過，
  fire-and-forget，永不阻塞 `POST /api/reply` 主流程。

## §3 前端互動與成長迴路

- **Quote-repost**：repost 改彈小輸入框「加一句你的話…」，可留空（留空 = 舊行為）。
  有字 → 存 `vault/reposts/` 真筆記、連回原文、觸發金標準信號。
  UI 為 quote 卡（你的話在上、原文縮小嵌下），沿用 Threads 視覺語彙。
- **表情自評**：僅兩時機——展開提問卡答案後；dwell 長但零互動離開時（toast，可無視）。
  永不 modal、永不擋路。
- **重逢加成**：曾 reply / quote 過的筆記到期重浮時，卡頂加一行
  「你 3 週前回覆過這篇 💬」，點開落在舊回覆。看見舊想法 → 補一句 → 再次 retrieval。
- **Progress 視圖**：側欄新視圖（沿用 `showList` 模式 + `GET /api/progress`）：
  復健中筆記數、strength 分佈迷你長條、連續回顧天數（streak 不推播不懲罰）。

## Milestones（各自獨立可交付、可測）

1. **記憶引擎**：memory.json + 事件更新 + 衰減公式 + rankForYou 三項加權（無 UI 改動）
2. **微摩擦互動**：quote-repost + 表情自評 + 對應 API
3. **AI 觀眾**：.env loader + Groq client + 提問卡（含煞車）+ 回評 + author 排除邏輯
4. **成長迴路**：Progress 視圖 + 重逢加成

每個 milestone 配 Playwright 測試（AI 部分 mock Groq endpoint）；
沿用 `.test-vault` 隔離、測試須 deterministic（不依賴 feed 順序）。

## 已知風險（烤問中確認過，接受）

- Fluency illusion 仍在：view 也加 strength，可能高估記憶——用極小權重（+0.02）壓低。
- AI 假觀眾的多巴胺弱於真人：以「即時 feedback 的學習價值」補償，不假裝是社交。
- vault 內機器文與人文混居：以 `author: recall-bot` + 索引排除圍堵，Obsidian 端
  使用者自行以資料夾 `replies/ai/` 辨識。
