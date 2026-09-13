# 効果音・BGM の差し替え

既定ではすべて `src/audio/webaudio.js` の **合成音**（OscillatorNode）で鳴ります。
用意した音声ファイルに差し替えるには、

1. `assets/audio/<name>.mp3`（または `.ogg`）を置く
2. `manifest.json` の `files` に `<name>` を並べる（拡張子は付けても付けなくてもよい）

```json
{ "files": ["hiyari", "clear", "bgm_main.ogg"] }
```

manifest に載っていない name は合成音のままです（載っていない＝取りに行かないので 404 は出ません）。

使える name（§9.2）:

| name | 用途 |
|---|---|
| `click` | ドラッグ・長押しの開始 |
| `fix_done` | 塞ぐ・片付ける・収納の完了 |
| `trash` | ゴミ箱に捨てた |
| `play_done` | 遊び完了 |
| `merge` | おもちゃの合成 |
| `hiyari` | ヒヤリ（低め。驚かせない） |
| `combo_warn` | 組み合わせ予告 |
| `deny` | 動かない・もう置けない・合わない |
| `pickup` | 抱き上げ・取り上げ |
| `fuss` | ぐずり開始（泣き声ではない） |
| `respawn` | 危険の再発 |
| `mouth` | 口に入れた（誤飲の猶予開始） |
| `relief` | 口から離した「ほっ」 |
| `climb` | ソファに登った |
| `fall_safe` | マットの上に落ちた |
| `visitor` | おじさん登場 |
| `cat` | 猫の登場・くわえる・置く |
| `clear` / `fail` | ステージ終了 |
| `bgm_main` | プレイ中ループ |
| `bgm_bored` | 満足度が低い間 `bgm_main` に重なるループ |

素材の指示は「toy-like, soft, not scary」（仕様 §9.3）。ライセンスは README.md に記載すること。

**このフォルダは 3D ビルド（`npm run build:3d`）だけ配布されます。** 2D の単一ファイルビルドは
`assets/` を持たないので、常に合成音で鳴ります。

---

## 赤ちゃんの声（笑い声・泣き声）を入れる

**コード変更は不要**です。上の name のうち次の3つが赤ちゃんの声に相当するので、
mp3 を置いて manifest に並べればその場面だけ実声に差し替わります。

| name | 鳴る場面（effect） | 入れる声 |
|---|---|---|
| `play_done` | おもちゃで遊び終えた（`play_done` / `recipe_ok` の toy 型） | 短い笑い声・喃語 |
| `clear` | ステージクリア | 弾けた笑い声（長めでよい） |
| `fuss` | ぐずり開始（`fuss_start`） | ぐずり声。**泣き叫ぶ声は §9.3 の "not scary" に反するので避ける** |

手順:

```bash
# 1. ファイルを置く
assets/audio/play_done.mp3
assets/audio/clear.mp3
assets/audio/fuss.mp3
# 2. manifest.json に名前を足す
```
```json
{ "files": ["play_done", "clear", "fuss"] }
```

```bash
npm run build:3d
npx vite preview --outDir dist-3d     # file:// では fetch が失敗するので preview で確認
```

DevTools のコンソールに `[audio] loaded play_done.mp3` が出れば差し替わっています。
出ない（=404）ときも合成音にフォールバックするだけで、ゲームは壊れません。

素材の条件:

- モノラル / 44.1kHz / **1〜2秒**（`clear` のみ 3秒程度まで）。長いと次の操作に被る
- ピークを **-6dBFS 前後**に揃える。既存の合成音は gain 0.1〜0.15 で鳴っているので、
  実声だけ大きいと浮く。無音の頭（リード）は削っておく
- `play_done` は遊ぶたびに鳴る＝**最頻出**。耳につかない短く軽いものを選ぶ

**注意：2D の単一ファイルビルド（`npm run build`）は `assets/` を配らないので、常に合成音のままです。**
2D でも実声を鳴らすには mp3 を data URI で埋め込む改造が別途必要（HTML が数百 KB 増える）。

素材を追加したら、CLAUDE.md の「ライセンス表記欄」に出典・ライセンス・確認日を記入すること。
