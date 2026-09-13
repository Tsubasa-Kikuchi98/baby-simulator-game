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
