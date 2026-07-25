// EN / JA language toggle (title bar). English is the canonical language:
// every user-facing string in the markup and code is written in English,
// and this module swaps in the Japanese translation where one exists in
// the JA dictionary below — strings without a translation simply stay
// English. The choice persists (ConfigStore key `language`, default 'en').
//
// Tooltips are the main translated surface. Static titles (index.html /
// UIBuilder templates / the devmode panel) are picked up by
// refreshTooltips(), which remembers each element's canonical English in
// data-i18n-en on first contact so later toggles can re-translate in
// both directions. Dynamically written tooltips go through setTooltip(),
// which stores the canonical (plus {placeholder} args) the same way.
// Body text that exists in both languages (the devmode guide) is toggled
// by CSS on html[lang] instead (.dev-i18n-en/-ja and the guide classes).

import { ConfigStore } from '../config/config-store';
import { EVENT_MODEL_SWITCHED } from '../shared/constants';

export type Lang = 'en' | 'ja';

// Fired on document after a language switch (listeners re-render any text
// they own that does not go through setTooltip)
export const EVENT_LANG_CHANGED = 'urx:lang-changed';

// English canonical -> Japanese. Keys may carry {placeholder}s; t() fills
// them after lookup so one entry covers every parameter combination.
const JA: Record<string, string> = {
    // Header toggles / buttons (index.html)
    'Auto-scroll to the active nodes when the flow selection changes':
        'フロー表示切替時にアクティブノードの位置へ自動スクロール',
    'Auto-scroll to a node when its connection state or parameters change':
        '結線状態やパラメータの変化時にそのノードへ自動スクロール',
    'Hide muted connection lines':
        'ミュート中（muted）の結線を非表示にします',
    'In FOCUS VIEW, hide off-path nodes entirely (OFF dims them instead)':
        'FOCUS VIEW中、パス外のノードを非表示にする（OFFでは減光表示）',
    'In FOCUS VIEW, suppress wipe/blink effects for off-path changes (disconnections from and new connections to the path are still shown)':
        'FOCUS VIEW中、パス外の変化のワイプ/ブリンクを抑制する（パスの切断・パスへの新規接続は対象外）',
    'In FOCUS VIEW, suppress Scroll to Change for off-path changes':
        'FOCUS VIEW中、パス外の変化への Scroll to Change を抑制する',
    'Collapse every section (title + horizontal meter only)':
        '全セクションを折りたたみ表示（タイトル＋横向きメーターのみ）にする',
    'Restore every section to the normal full view':
        '全セクションを通常のフル表示に戻す',
    'Export the current settings (model, toggles, collapse states, ...) as a JSON file':
        '現在の設定（モデル・トグル・折りたたみ状態等）をJSONファイルとして書き出す',
    'Load and apply a settings JSON file (reloads the page)':
        '設定JSONファイルを読み込んで適用する（ページを再読み込みします）',
    'Decrease the overall font size by one step (5 steps)':
        '全体の文字サイズを1段階小さく（5段階）',
    'Increase the overall font size by one step (5 steps)':
        '全体の文字サイズを1段階大きく（5段階）',
    'Model selection': 'モデル選択',
    'Device System firmware version (/vd/device)':
        '実機の System ファームウェアバージョン（/vd/device）',
    'Device DSP / USB streaming sample rate (display only)':
        '実機の DSP / USB ストリーミングサンプルレート（表示のみ）',
    'Demo mode: simulates device behavior without a connection':
        '接続なしで実機挙動をシミュレートするデモモード',
    'Outline every control that has no device mapping in red (steady; DEV mode shows the same outlines while picking)':
        'デバイスマッピングを持たないコントロールを赤枠表示する（点滅なし。DEVモードでは対象選択中に同じ赤枠が出ます）',
    'Developer mode: red outlines on unmapped elements, Device Center log, click-to-capture for mapping research':
        '開発者モード: 未マッピング要素の赤枠表示・Device Centerログ・クリックでマッピング調査キャプチャ',
    'Show/hide the header controls': 'ヘッダーのコントロールを表示/非表示',
    'Switch language': '言語切替',

    // Sections / nodes (UIBuilder templates, collapse buttons)
    'Collapse all nodes in this section': 'セクション内の全ノードを折りたたみ表示にする',
    'Restore all nodes in this section to full view': 'セクション内の全ノードをフル表示に戻す',
    'Show/hide the USB DAW nodes': 'USB DAW ノードの表示/非表示',
    'Toggle collapsed/full view': '折りたたみ表示/フル表示を切り替え',
    'Click or press ESC to clear': 'クリックまたはESCで解除',

    // Meter tap chips (static template titles + the dynamic re-writes)
    'Meter tap: INPUT (before all DSP)': 'メータータップ: INPUT（全DSP前）',
    'Meter tap: POST (output after inserts)': 'メータータップ: POST（インサート後の出力）',
    'Meter tap: OUT (output)': 'メータータップ: OUT（出力）',
    'Meter tap: {label} (click to cycle: {cycle})':
        'メータータップ: {label}（クリックで切替: {cycle}）',
    'Meter tap: {label}': 'メータータップ: {label}',

    // Alerts
    'Could not load the settings file:': '設定ファイルを読み込めませんでした:',

    // Devmode panel (static tooltips)
    'Minimize/restore the panel': 'パネルを最小化/復元',
    'Device Center WebSocket RX/TX traffic': 'Device Center WebSocket の RX/TX トラフィック',
    'Device Center subscriptions and manual subscribe': 'Device Center への購読状況と手動購読',
    'Remove all manual/range subscriptions and restore the default mapped set (only while connected)':
        '手動/範囲購読をすべて解除し、マッピング定義済みの既定購読に戻す（デバイス接続中のみ）',
    'Unsubscribe everything (only while connected)': 'すべての購読を解除する（デバイス接続中のみ）',
    'Address or range to subscribe. Auto-detected by part count (3 = parameters / 2 = meters). Enter adds':
        '購読するアドレスまたは範囲。要素数で自動判別（3要素=parameters / 2要素=meters）。Enterで追加',
    'Subscribe the entered address (ranges expand to a bulk add; only while connected)':
        '入力したアドレス（範囲は展開して一括）を購読する（デバイス接続中のみ）',
    'Show received (RX) lines': '受信（RX）行を表示する',
    'Show sent (TX) lines': '送信（TX）行を表示する',
    'Include meter notifications in the log/captures (very high volume)':
        'メーター通知もログ/キャプチャに含める（大量に流れます）',
    'Wrap long lines (horizontal scroll when off)': '長い行を折り返して表示（オフのときは横スクロール）',
    'Clear the log and the observed address lists': 'ログと受信アドレス一覧をクリア',
    'Copy the observed address list to the clipboard': '受信アドレス一覧をクリップボードにコピー',
    'Copy the unmapped observed addresses to the clipboard': '未マッピングの受信アドレス一覧をクリップボードにコピー',
    'Investigate unmapped controls by operating the hardware': '未マッピングのコントロールを実機操作で調査',
    'Flag controls shown in the UI that do not exist on the real device':
        '画面上にあるが実機には存在しないコントロールを指摘',
    'Flag controls whose link/mapping is wrong': 'リンク/マッピングが誤っているコントロールを指摘',
    'Discard all captures': 'キャプチャ記録をすべて破棄',
    'Copy to clipboard': 'クリップボードにコピー',
    'Save as a text file': 'テキストファイルとして保存',
    'Pick controls that do not exist on the device (repeat OK / Esc to finish)':
        '実機に存在しないコントロールを選択（連続可 / Escで終了）',
    'Pick controls whose link is wrong (repeat OK / Esc to finish)':
        'リンクが誤っているコントロールを選択（連続可 / Escで終了）',
    'Discard all marks': 'マークをすべて破棄',

    // Devmode panel — TRYMAP mode
    'Temporarily link an unmapped address to a UI control and verify live':
        '未マッピングアドレスをUIコントロールへ一時マップして動作確認',
    'Pick the UI control to drive': '駆動するUIコントロールを選択',
    'Value type used to decode parameter notifications':
        'parameters通知のデコードに使う値タイプ',
    'Create the temporary link (this session only)': '一時リンクを作成（セッション限り・保存されません）',
    'Remove all temporary links': '一時リンクをすべて解除',
    'Unlink': 'リンク解除',
    'Cancel picking (Esc)': '選択待ちをキャンセル（Esc）',
    'Deselect the target (Esc)': '対象の選択を解除（Esc）',

    // Devmode panel (dynamic strings in src/devmode/devmode.ts)
    '{n} items': '{n}件',
    'Remove this mark': 'このマークを削除',
    'unmapped': '未マッピング',
    'What should it be? (note)': '正しくはどうあるべきか（メモ）',
    'Unsubscribe': '購読解除',
    'total {n}': '計{n}',
    'existing:': '既存:',
    'Most frequent unassigned = mapping candidate': '未割当のうち最頻 = マッピング候補',
    'Click a control on the board to choose the capture target (other clicks are disabled while picking)':
        '画面上のコントロールをクリックしてキャプチャ対象を選択（選択中は他のクリック操作を無効化）',
    'Cancel without recording (Esc)': '選択をキャンセル（記録しない / Esc）',
    'Finish and record this capture (Enter)': 'このキャプチャを完了して記録 (Enter)',
    'Delete this record': 'この記録を削除',
};

let lang: Lang = 'en';

/** Translate an English canonical string into the active language and
 *  fill {placeholder}s. Missing translations fall back to English. */
export function t(en: string, params?: Record<string, string>): string {
    let text = lang === 'ja' ? (JA[en] ?? en) : en;
    if (params) {
        for (const [k, v] of Object.entries(params)) {
            text = text.split(`{${k}}`).join(v);
        }
    }
    return text;
}

/** Write a tooltip in the active language, remembering the English
 *  canonical (and args) so a later language switch re-translates it.
 *  An empty string clears the tooltip. */
export function setTooltip(el: HTMLElement, en: string, params?: Record<string, string>): void {
    if (!en) {
        el.removeAttribute('title');
        delete el.dataset.i18nEn;
        delete el.dataset.i18nArgs;
        return;
    }
    el.dataset.i18nEn = en;
    if (params) el.dataset.i18nArgs = JSON.stringify(params);
    else delete el.dataset.i18nArgs;
    el.title = t(en, params);
}

// Re-render every known tooltip. Elements seen for the first time donate
// their current title as the English canonical (all markup titles are
// English). Exported so modules that inject titled markup after startup
// (devmode panel) can pull their tooltips into the active language.
export function refreshTooltips(): void {
    document.querySelectorAll<HTMLElement>('[title], [data-i18n-en]').forEach(el => {
        const en = el.dataset.i18nEn ?? el.getAttribute('title');
        if (!en) return;
        el.dataset.i18nEn = en;
        let params: Record<string, string> | undefined;
        if (el.dataset.i18nArgs) {
            try { params = JSON.parse(el.dataset.i18nArgs); } catch { /* ignore */ }
        }
        const text = t(en, params);
        if (el.title !== text) el.title = text;
    });
    // The toggle button rides along (it is injected with the dev panel,
    // after initI18n's startup pass)
    syncToggleButton();
}

function setLang(next: Lang): void {
    lang = next;
    ConfigStore.set('language', lang);
    document.documentElement.lang = lang;
    refreshTooltips();
    syncToggleButton();
    document.dispatchEvent(new CustomEvent(EVENT_LANG_CHANGED));
}

function syncToggleButton(): void {
    const btn = document.getElementById('lang-toggle');
    if (!btn) return;
    btn.textContent = lang.toUpperCase();
    setTooltip(btn, 'Switch language');
}

export function initI18n(): void {
    const saved = ConfigStore.get('language');
    if (saved === 'ja' || saved === 'en') lang = saved;
    document.documentElement.lang = lang;

    // Markup ships English; only a restored JA needs an initial pass
    if (lang !== 'en') refreshTooltips();
    syncToggleButton();

    // The toggle button lives in the devmode panel's title bar, which is
    // injected after this init — delegate the click so the wiring holds
    document.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest?.('#lang-toggle')) {
            setLang(lang === 'en' ? 'ja' : 'en');
        }
    });

    // buildAll() recreates the node templates with English titles
    document.addEventListener(EVENT_MODEL_SWITCHED, () => {
        if (lang !== 'en') refreshTooltips();
    });
}
