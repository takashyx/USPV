# URX Signal Path Visualizer

**v0.1.0 (beta)**

[English](#english) | [日本語](#日本語)

![Overview](readme_images/overview.png)

---

## English

A real-time signal-routing visualizer for the YAMAHA URX series (URX44V / URX44 / URX22).
It connects to Yamaha Device Center running on the same PC and shows the current routing, levels, and parameters live.

> **Note:** This tool is still in **beta**. Some features may not work as expected.
> Currently it has been tested on **Chrome only**. A standalone app (Windows / macOS) is under consideration for the future, but we are releasing it as a web page first.

### Getting Started

**No installation, no build, no Node.js required** — this is a static web page that runs as-is.

1. Download this repository: click the green **Code** button → **Download ZIP** (or `git clone`)
2. Extract the ZIP anywhere
3. Double-click `index.html` (or drag it into your browser) — **Chrome** recommended (the only tested browser)

That's it. The app runs entirely locally — nothing is sent anywhere.

> **FYI:** Only 3 files are actually required to run the app: `index.html`, `css/styles.css`, and `dist/bundle.js` (keep the folder structure). Everything else in the repository is source code and documentation.

### Connecting to Your Device

1. Connect your URX to the PC and make sure **Yamaha Device Center** is running
2. Open `index.html` — the app connects to Device Center automatically
3. When connected, the device model is selected automatically, routing lines appear, and meters/knobs follow the actual device in real time

When Device Center is not running (or the device is disconnected), routing lines are hidden.

### Demo Mode

Want to try it without a device? Turn on the **Demo** toggle in the header (or open the page with `?demo` added to the URL). The app simulates device behavior: routing changes every few seconds and meters move.


### Basic Usage

| Action | What happens |
|---|---|
| Click a node | **FOCUS VIEW** — only the connected signal path is highlighted. Press `ESC` (or click the chip next to the title) to exit |
| `▲` on a node | Collapse the node to its title + a horizontal meter. `▼` restores it |
| **Collapse All / Expand All** | Collapse or restore every node at once |
| **Hide Muted** toggle | Show or hide muted (gray dashed) connection lines |
| Model selector | Switch between URX44V / URX44 / URX22 (selected automatically when a device is connected) |
| `−` / `＋` | Adjust the overall font size (5 steps) |
| **Export / Load** | Save the current settings (model, toggles, collapse states, ...) as a JSON file, or load one |


### License

MIT License — see [LICENSE](LICENSE).

This is an unofficial tool and is not affiliated with or endorsed by Yamaha Corporation.

---

## 日本語

YAMAHA URX シリーズ (URX44V / URX44 / URX22) のシグナルルーティングをリアルタイムに可視化するツールです。
同じ PC 上で動作する Yamaha Device Center と接続し、現在のルーティング・レベル・パラメータをライブ表示します。

> **注意:** 本ツールはまだ **β版** です。一部の機能が正常に動作しない場合があります。
> 現時点で動作確認は **Chrome のみ**で行っています。今後スタンドアローンアプリ (Windows / macOS) 化も検討していますが、まずは Web ページとして公開します。

### 使い方 (起動)

**インストール・ビルド・Node.js は一切不要**です。そのまま動く静的な Web ページです。

1. このリポジトリをダウンロード: 緑色の **Code** ボタン → **Download ZIP** (または `git clone`)
2. ZIP を好きな場所に展開
3. `index.html` をダブルクリック (またはブラウザにドラッグ) — **Chrome** 推奨 (動作確認済みブラウザ)

これだけで動きます。完全にローカルで動作し、外部への通信は一切ありません。

> **参考:** 実行に本当に必要なのは `index.html`・`css/styles.css`・`dist/bundle.js` の3ファイルだけです (フォルダ構成は維持してください)。リポジトリ内のそれ以外はソースコードとドキュメントです。

### 実機との接続

1. URX を PC に接続し、**Yamaha Device Center** を起動しておく
2. `index.html` を開くと自動的に Device Center へ接続されます
3. 接続されるとモデルが自動選択され、結線が表示され、メーターやノブが実機にリアルタイムで追従します

Device Center が起動していない (または実機が切断されている) 間は、結線は表示されません。

### デモモード

実機がなくても試せます。ヘッダーの **Demo** トグルを ON にする (または URL に `?demo` を付けて開く) と、数秒ごとにルーティングが変化しメーターが動く実機シミュレーションが始まります。


### 基本操作

| 操作 | 動作 |
|---|---|
| ノードをクリック | **FOCUS VIEW** — 接続されている信号経路だけがハイライトされます。`ESC` (またはタイトル横のチップをクリック) で解除 |
| ノードの `▲` | ノードをタイトル + 横向きメーターだけに折りたたみ。`▼` で元に戻ります |
| **Collapse All / Expand All** | 全ノードを一括で折りたたみ / 展開 |
| **Hide Muted** トグル | ミュート中の結線 (灰色破線) の表示 / 非表示 |
| モデルセレクタ | URX44V / URX44 / URX22 を切り替え (実機接続時は自動選択) |
| `−` / `＋` | 全体の文字サイズを調整 (5段階) |
| **Export / Load** | 現在の設定 (モデル・トグル・折りたたみ状態など) を JSON ファイルとして保存 / 読み込み |


### ライセンス

MIT License — [LICENSE](LICENSE) を参照してください。

本ツールは非公式のツールであり、ヤマハ株式会社とは一切関係ありません。
