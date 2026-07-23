// The developer-tool panel markup, injected once at startup. Pure string
// constant — extracted from the wiring code so the structure is readable
// on its own.
//
// Three switchable modes, selected by the tabs in the panel header:
//   CAPTURE — investigate UNMAPPED controls by operating the hardware
//             (pick -> live capture -> results/report)
//   GHOST   — flag controls shown in the UI that DON'T EXIST on the
//             real device (deletion candidates)
//   MISLINK — flag controls whose mapping/link is WRONG, with a note
// GHOST/MISLINK are manual: the user clicks the controls they noticed
// and the flags are collected into a report. The RAW LOG stays visible
// in every mode.

export const DEV_PANEL_HTML = `
        <div id="dev-panel" class="mode-capture" style="display: none;">
            <div id="dev-panel-header">
                <span class="dev-title">DEVELOPER TOOL</span>
                <!-- EN/JA language toggle (src/app/i18n.ts): the main UI is
                     all-English, so the switch lives with the dev tooling.
                     Shows the ACTIVE language; clicking switches. -->
                <button class="dev-btn" id="lang-toggle" title="Switch language">EN</button>
                <button class="dev-btn" id="dev-panel-min" style="margin-left: auto;" title="Minimize/restore the panel">&#8213;</button>
            </div>
            <div id="dev-panel-body">
                <!-- Right area: CONSOLE / SUBSCRIPTIONS as tabs (same
                     tab-connects-to-frame look as the mode tabs left).
                     CONSOLE is the default. -->
                <div id="dev-right-wrap">
                <div class="dev-modes" id="dev-right-tabs">
                    <button class="dev-right-tab active" data-panel="console"
                        title="Device Center WebSocket RX/TX traffic">CONSOLE</button>
                    <button class="dev-right-tab" data-panel="subs"
                        title="Device Center subscriptions and manual subscribe">SUBSCRIPTIONS</button>
                </div>
                <div id="dev-right">
                <div id="dev-subs" style="display: none;">
                    <div id="dev-subs-body">
                    <div class="dev-subs-box" id="dev-subs-status">
                        <div class="dev-console-headrow">
                            <span class="dev-col-head dev-console-head">SUBSCRIBED</span>
                            <span id="dev-subs-count"></span>
                        </div>
                        <div class="dev-step-hint"><span class="dev-i18n-en">Current Device Center subscriptions — only these arrive as notifications. &#10005; unsubscribes.</span><span class="dev-i18n-ja">Device Center へ購読中のアドレス（通知はこれらのみ届く）。&#10005;で購読解除。</span></div>
                        <div id="dev-subs-list"></div>
                        <div class="dev-btn-row">
                            <button class="dev-btn" id="dev-subs-default-btn"
                                title="Remove all manual/range subscriptions and restore the default mapped set (only while connected)">Restore Default</button>
                            <button class="dev-btn" id="dev-subs-clear-btn"
                                title="Unsubscribe everything (only while connected)">Clear All</button>
                        </div>
                    </div>
                    <div class="dev-subs-box" id="dev-subs-addbox">
                        <div class="dev-console-headrow">
                            <span class="dev-col-head dev-console-head">ADD SUBSCRIPTION</span>
                        </div>
                        <div class="dev-step-hint"><span class="dev-i18n-en">Single address or bulk range (each part may be n-m, only while connected). 3 parts = parameters, 2 parts = meters. <b>Enter</b> adds:</span><span class="dev-i18n-ja">個別アドレスまたは範囲一括（各要素 n-m 可・接続中のみ）。3要素=parameters、2要素=meters。<b>Enter</b>でも追加:</span></div>
                        <pre class="dev-subs-example">parameters 0-10:0:0-10
meters 0:1</pre>
                        <div class="dev-subs-add">
                            <input id="dev-subs-addr" placeholder="id:x:y (parameters) / id:x (meters)" spellcheck="false"
                                title="Address or range to subscribe. Auto-detected by part count (3 = parameters / 2 = meters). Enter adds">
                            <button class="dev-btn" id="dev-subs-add-btn"
                                title="Subscribe the entered address (ranges expand to a bulk add; only while connected)">Add</button>
                        </div>
                    </div>
                    </div>
                </div>

                <div id="dev-console">
                    <div id="dev-console-body">
                        <div id="dev-timeline" class="dev-console-col dev-console-col-first">
                            <div class="dev-console-headrow">
                                <span class="dev-col-head dev-console-head">TIMELINE</span>
                                <label class="header-toggle" id="dev-log-rx-toggle"
                                    title="Show received (RX) lines">
                                    <span>RX</span>
                                    <div class="toggle-track" id="dev-log-rx-track">
                                        <div class="toggle-thumb"></div>
                                    </div>
                                </label>
                                <label class="header-toggle" id="dev-log-tx-toggle"
                                    title="Show sent (TX) lines">
                                    <span>TX</span>
                                    <div class="toggle-track" id="dev-log-tx-track">
                                        <div class="toggle-thumb"></div>
                                    </div>
                                </label>
                                <label class="header-toggle" id="dev-log-meters-toggle"
                                    title="Include meter notifications in the log/captures (very high volume)">
                                    <span>Meters</span>
                                    <div class="toggle-track" id="dev-log-meters-track">
                                        <div class="toggle-thumb"></div>
                                    </div>
                                </label>
                                <label class="header-toggle" id="dev-log-wrap-toggle"
                                    title="Wrap long lines (horizontal scroll when off)">
                                    <span>Wrap</span>
                                    <div class="toggle-track" id="dev-log-wrap-track">
                                        <div class="toggle-thumb"></div>
                                    </div>
                                </label>
                                <span id="dev-log-count"></span>
                                <button class="dev-btn" id="dev-log-clear" title="Clear the log and the observed address lists">Clear</button>
                            </div>
                            <div id="dev-log"></div>
                        </div>
                        <!-- Every address actually received, deduped,
                             consecutive values collapsed to n-m -->
                        <div id="dev-observed" class="dev-console-col">
                            <div class="dev-console-headrow">
                                <span class="dev-col-head dev-console-head">OBSERVED</span>
                                <span id="dev-observed-count"></span>
                                <button class="dev-btn" id="dev-observed-copy"
                                    title="Copy the observed address list to the clipboard">Copy</button>
                            </div>
                            <div class="dev-step-hint"><span class="dev-i18n-en"><b>RX only</b> — addresses actually received (consecutive values collapsed as n-m). TX is not counted.</span><span class="dev-i18n-ja"><b>RXのみ</b> — 実際に受信したアドレスの一覧（連続する値は n-m に集約。送信 TX は含まない）。</span></div>
                            <div id="dev-observed-list" class="dev-console-col-list"></div>
                        </div>
                        <!-- Of those, the addresses with NO current mapping -->
                        <div id="dev-unmapped-obs" class="dev-console-col">
                            <div class="dev-console-headrow">
                                <span class="dev-col-head dev-console-head">UNMAPPED</span>
                                <span id="dev-unmapped-obs-count"></span>
                                <button class="dev-btn" id="dev-unmapped-obs-copy"
                                    title="Copy the unmapped observed addresses to the clipboard">Copy</button>
                            </div>
                            <div class="dev-step-hint"><span class="dev-i18n-en"><b>RX only</b> — received addresses that have no mapping yet.</span><span class="dev-i18n-ja"><b>RXのみ</b> — 受信したうち、現状マッピングされていないアドレス。</span></div>
                            <div id="dev-unmapped-obs-list" class="dev-console-col-list"></div>
                        </div>
                    </div>
                </div>
                </div>
                </div>

                <!-- Tab strip sits directly on top of the steps frame, so
                     the active tab visually connects with its content -->
                <div id="dev-steps-wrap">
                <div class="dev-modes">
                    <button class="dev-mode-tab active" data-mode="capture"
                        title="Investigate unmapped controls by operating the hardware">CAPTURE</button>
                    <button class="dev-mode-tab" data-mode="ghost"
                        title="Flag controls shown in the UI that do not exist on the real device">GHOST</button>
                    <button class="dev-mode-tab" data-mode="mislink"
                        title="Flag controls whose link/mapping is wrong">MISLINK</button>
                    <button class="dev-mode-tab" data-mode="trymap"
                        title="Temporarily link an unmapped address to a UI control and verify live">TRYMAP</button>
                </div>
                <div id="dev-steps">
                <!-- CAPTURE mode: GUIDE (descriptions, left) | operation
                     columns ① TARGET & CAPTURE → ② RESULTS → ③ REPORT -->
                <div id="dev-mode-capture" class="dev-mode-cols">
                    <div class="dev-guide">
                        <div class="dev-col-head">GUIDE</div>
                        <div class="dev-guide-body">
                        <div class="dev-guide-desc">Investigate unmapped controls with the real device.</div>
                        <div class="dev-guide-desc-jp">未マッピングのコントロールを実機で調査します。</div>
                        <div class="dev-step">&#9312; <b>Select</b> — press <b>Pick</b>: unmapped controls blink red. Click one (non-blinking mapped controls work too). The target glows red and scrolls into view.</div>
                        <div class="dev-step-jp">&#9312; <b>選択</b> — Pick を押すと未マッピングが赤枠で点滅。1つクリックで対象に（点滅なしのマッピング済みも選択可）。対象は赤グローで明滅し、自動スクロールで表示。</div>
                        <div class="dev-step">&#9312; <b>Capture</b> — operate that control on the hardware; responding addresses appear live (&#9733; = best unassigned candidate). <b>Done</b> (Enter) records, <b>&#10005;</b> (Esc) cancels.</div>
                        <div class="dev-step-jp">&#9312; <b>記録</b> — 実機で該当コントロールを操作すると反応アドレスがライブ表示（&#9733;＝未割当の有力候補）。Done（Enter）で記録、&#10005;（Esc）でキャンセル。</div>
                        <div class="dev-step">&#9313; <b>Review</b> — recorded captures are listed; &#10005; deletes one.</div>
                        <div class="dev-step-jp">&#9313; <b>確認</b> — 記録済みキャプチャの一覧。&#10005;で削除。</div>
                        <div class="dev-step">&#9314; <b>Report</b> — the fix request updates live; <b>Copy</b> or <b>Download</b>.</div>
                        <div class="dev-step-jp">&#9314; <b>レポート</b> — 修正依頼レポートはリアルタイム更新。Copy または Download。</div>
                        <div class="dev-step" style="margin-top: 8px;">&#8251; Red highlights (blink = unmapped / glow = target) appear only while this tab is active.</div>
                        <div class="dev-step-jp" style="margin-top: 8px;">※ 赤の強調表示（点滅＝未マッピング／グロー＝選択中の対象）は CAPTURE タブ選択中のみ。</div>
                        </div>
                    </div>
                    <div class="dev-step-col" id="dev-capture">
                        <div class="dev-col-head">&#9312; TARGET &amp; CAPTURE</div>
                        <div id="dev-capture-live">
                            <!-- Target card first; while capturing, the ✕
                                 (cancel) / Done buttons appear stacked at
                                 the card's right -->
                            <div id="dev-capture-target"></div>
                            <div id="dev-capture-status"></div>
                            <div id="dev-capture-addrs"></div>
                        </div>
                    </div>
                    <div class="dev-step-col" id="dev-results">
                        <div class="dev-col-head">&#9313; RESULTS<span id="dev-results-count"></span></div>
                        <div id="dev-capture-list"></div>
                        <div class="dev-btn-row">
                            <button class="dev-btn" id="dev-capture-clear" title="Discard all captures">Clear All</button>
                        </div>
                    </div>
                    <div class="dev-step-col dev-report-col" id="dev-report">
                        <div class="dev-col-head">&#9314; REPORT</div>
                        <textarea id="dev-report-text" class="dev-report-text" readonly spellcheck="false"></textarea>
                        <div class="dev-btn-row">
                            <button class="dev-btn" id="dev-report-copy" title="Copy to clipboard">Copy</button>
                            <button class="dev-btn" id="dev-report-dl" title="Save as a text file">Download</button>
                        </div>
                        <div class="dev-report-note"><span class="dev-i18n-en">Please share this report with the author.</span><span class="dev-i18n-ja">このレポートを作者に共有してください。</span></div>
                    </div>
                </div>

                <!-- GHOST mode: GUIDE | ① PICK → ② MARKED → ③ REPORT -->
                <div id="dev-mode-ghost" class="dev-mode-cols" style="display: none;">
                    <div class="dev-guide">
                        <div class="dev-col-head">GUIDE</div>
                        <div class="dev-guide-body">
                        <div class="dev-guide-desc">Flag controls shown in the UI that do NOT exist on the real device (deletion candidates).</div>
                        <div class="dev-guide-desc-jp">画面にあるが実機には存在しないコントロール（削除候補）を記録します。</div>
                        <div class="dev-step">&#9312; <b>Mark</b> — press <b>Pick</b> and click each phantom control (multiple OK, <b>Esc</b> to finish). Marks show as purple outlines.</div>
                        <div class="dev-step-jp">&#9312; <b>マーク</b> — Pick を押し、実機に無いコントロールを順にクリック（複数可・Escで終了）。マークは紫枠で表示。</div>
                        <div class="dev-step">&#9313; <b>Review</b> — marked controls are listed; &#10005; removes one.</div>
                        <div class="dev-step-jp">&#9313; <b>確認</b> — マーク一覧。&#10005;で削除。</div>
                        <div class="dev-step">&#9314; <b>Report</b> — the deletion request updates live; <b>Copy</b> or <b>Download</b>.</div>
                        <div class="dev-step-jp">&#9314; <b>レポート</b> — 削除依頼レポートはリアルタイム更新。Copy または Download。</div>
                        </div>
                    </div>
                    <div class="dev-step-col">
                        <div class="dev-col-head">&#9312; PICK</div>
                        <!-- Same target card as CAPTURE: Pick inside the card,
                             info shows the last marked control -->
                        <div id="dev-ghost-target" class="dev-target-card"></div>
                    </div>
                    <div class="dev-step-col">
                        <div class="dev-col-head">&#9313; MARKED<span id="dev-ghost-count"></span></div>
                        <div id="dev-ghost-list" class="dev-flag-list"></div>
                        <div class="dev-btn-row">
                            <button class="dev-btn" id="dev-ghost-clear" title="Discard all marks">Clear All</button>
                        </div>
                    </div>
                    <div class="dev-step-col dev-report-col">
                        <div class="dev-col-head">&#9314; REPORT</div>
                        <textarea id="dev-ghost-text" class="dev-report-text" readonly spellcheck="false"></textarea>
                        <div class="dev-btn-row">
                            <button class="dev-btn" id="dev-ghost-copy" title="Copy to clipboard">Copy</button>
                            <button class="dev-btn" id="dev-ghost-dl" title="Save as a text file">Download</button>
                        </div>
                        <div class="dev-report-note"><span class="dev-i18n-en">Please share this report with the author.</span><span class="dev-i18n-ja">このレポートを作者に共有してください。</span></div>
                    </div>
                </div>

                <!-- MISLINK mode: GUIDE | ① PICK → ② MARK & NOTE → ③ REPORT -->
                <div id="dev-mode-mislink" class="dev-mode-cols" style="display: none;">
                    <div class="dev-guide">
                        <div class="dev-col-head">GUIDE</div>
                        <div class="dev-guide-body">
                        <div class="dev-guide-desc">Flag controls whose mapping / link is wrong, and note what it should be.</div>
                        <div class="dev-guide-desc-jp">リンク／マッピングが誤っているコントロールを記録し、正しい内容をメモします。</div>
                        <div class="dev-step">&#9312; <b>Mark</b> — press <b>Pick</b> and click each wrong control (multiple OK, <b>Esc</b> to finish). Marks show as yellow outlines.</div>
                        <div class="dev-step-jp">&#9312; <b>マーク</b> — Pick を押し、リンクが誤っているコントロールを順にクリック（複数可・Escで終了）。マークは黄枠で表示。</div>
                        <div class="dev-step">&#9313; <b>Note</b> — in each marked item, type what the correct mapping should be. &#10005; removes one.</div>
                        <div class="dev-step-jp">&#9313; <b>メモ</b> — 各項目に「正しくはどうあるべきか」を記入。&#10005;で削除。</div>
                        <div class="dev-step">&#9314; <b>Report</b> — the fix request updates live; <b>Copy</b> or <b>Download</b>.</div>
                        <div class="dev-step-jp">&#9314; <b>レポート</b> — 修正依頼レポートはリアルタイム更新。Copy または Download。</div>
                        </div>
                    </div>
                    <div class="dev-step-col">
                        <div class="dev-col-head">&#9312; PICK</div>
                        <!-- Same target card as CAPTURE: Pick inside the card,
                             info shows the last marked control -->
                        <div id="dev-mislink-target" class="dev-target-card"></div>
                    </div>
                    <div class="dev-step-col">
                        <div class="dev-col-head">&#9313; MARK &amp; NOTE<span id="dev-mislink-count"></span></div>
                        <div id="dev-mislink-list" class="dev-flag-list"></div>
                        <div class="dev-btn-row">
                            <button class="dev-btn" id="dev-mislink-clear" title="Discard all marks">Clear All</button>
                        </div>
                    </div>
                    <div class="dev-step-col dev-report-col">
                        <div class="dev-col-head">&#9314; REPORT</div>
                        <textarea id="dev-mislink-text" class="dev-report-text" readonly spellcheck="false"></textarea>
                        <div class="dev-btn-row">
                            <button class="dev-btn" id="dev-mislink-copy" title="Copy to clipboard">Copy</button>
                            <button class="dev-btn" id="dev-mislink-dl" title="Save as a text file">Download</button>
                        </div>
                        <div class="dev-report-note"><span class="dev-i18n-en">Please share this report with the author.</span><span class="dev-i18n-ja">このレポートを作者に共有してください。</span></div>
                    </div>
                </div>

                <!-- TRYMAP mode: GUIDE | ① TARGET → ② ADDRESS → ③ LINKED.
                     Temporary runtime links: entries are pushed into the
                     reverse maps so incoming notifications drive the picked
                     control live; nothing is persisted. -->
                <div id="dev-mode-trymap" class="dev-mode-cols" style="display: none;">
                    <div class="dev-guide">
                        <div class="dev-col-head">GUIDE</div>
                        <div class="dev-guide-body">
                        <div class="dev-guide-desc">Temporarily link an address from CONSOLE's UNMAPPED list to a UI control and verify it live (this session only — nothing is saved).</div>
                        <div class="dev-guide-desc-jp">CONSOLE の UNMAPPED で検知したアドレスを UI コントロールへ一時的にマップし、動作確認します（セッション限り・保存されません）。</div>
                        <div class="dev-step">&#9312; <b>Target</b> — press <b>Pick</b> and click the UI control to drive (mapped controls can be picked too).</div>
                        <div class="dev-step-jp">&#9312; <b>対象</b> — Pick を押して盤面のコントロールをクリック（マッピング済みも選択可）。</div>
                        <div class="dev-step">&#9313; <b>Address</b> — click an address in the list (live view of CONSOLE's UNMAPPED); for parameters choose the value type, then press <b>Link</b>. The control shows a blue dashed outline.</div>
                        <div class="dev-step-jp">&#9313; <b>アドレス</b> — 一覧（CONSOLE の UNMAPPED と連動）からアドレスを選び、parameters は値タイプを選択して <b>Link</b>。対象は青の破線枠で表示。</div>
                        <div class="dev-step">&#9314; <b>Verify</b> — operate the hardware: notifications on the linked address now drive the control. &#10005; unlinks; linked addresses reappear in UNMAPPED after unlinking.</div>
                        <div class="dev-step-jp">&#9314; <b>確認</b> — 実機を操作すると該当アドレスの通知がコントロールに反映されます。&#10005;で解除（解除後は UNMAPPED に再表示）。</div>
                        <div class="dev-step">&#8251; Meter links drop when that node's meter tap is cycled (the meter reverse map is rebuilt).</div>
                        <div class="dev-step-jp">※ メーターの一時リンクは、メータータップを切り替えると解除されます（逆引きマップ再構築のため）。</div>
                        </div>
                    </div>
                    <div class="dev-step-col">
                        <div class="dev-col-head">&#9312; TARGET</div>
                        <!-- Same target card as CAPTURE: Pick inside the card,
                             the picked target shows with ✕ (deselect) -->
                        <div id="dev-trymap-target" class="dev-target-card"></div>
                    </div>
                    <div class="dev-step-col">
                        <div class="dev-col-head">&#9313; ADDRESS<span id="dev-trymap-addr-count"></span></div>
                        <div id="dev-trymap-addr-list"></div>
                        <div class="dev-trymap-controls">
                            <select id="dev-trymap-type"
                                title="Value type used to decode parameter notifications">
                                <option value="bool">bool</option>
                                <option value="level">level</option>
                                <option value="level_knob">level_knob</option>
                                <option value="pan">pan</option>
                                <option value="gain">gain</option>
                                <option value="dgain">dgain</option>
                                <option value="phonesLevel">phonesLevel</option>
                                <option value="freq">freq</option>
                                <option value="delayTime">delayTime</option>
                                <option value="string">string</option>
                            </select>
                            <button class="dev-btn" id="dev-trymap-apply"
                                title="Create the temporary link (this session only)">Link</button>
                        </div>
                    </div>
                    <div class="dev-step-col">
                        <div class="dev-col-head">&#9314; LINKED<span id="dev-trymap-count"></span></div>
                        <div id="dev-trymap-list" class="dev-flag-list"></div>
                        <div class="dev-btn-row">
                            <button class="dev-btn" id="dev-trymap-clear" title="Remove all temporary links">Clear All</button>
                        </div>
                    </div>
                </div>
                </div>
                </div>
            </div>
        </div>`;
