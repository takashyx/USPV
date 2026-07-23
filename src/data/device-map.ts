// =============================================================================
// device-map.ts — Device Center 通信仕様とアドレスマッピング定義
// =============================================================================
//
// このファイルは YAMAHA Device Center (casket) との通信で使う「データ仕様」だけを
// 集約したもの。WebSocket の送受信・DOM 反映などの実装は src/broker/ にある。
// 仕様の正は REQUIREMENTS.md §6「データ仕様」。
//
// -----------------------------------------------------------------------------
// ■ 通信プロトコル概要 (実装: src/broker/)
// -----------------------------------------------------------------------------
//   接続先   : ws://127.0.0.1:51780/casket  (JSON-RPC 1.0 風のメッセージ)
//
//   デバイス列挙:
//     送信 { jsonrpc:'1.0', method:'getDeviceList' }
//     受信 { params: { list: [ { model:'URX22', dev_uid:'{...}' } ] } }
//
//   仮想デバイス (VD) 操作: requestVD でラップする
//     送信 { method:'requestVD', params:{ dev_uid, vdp:{ method:'get'|'post', uri } } }
//     ・同期確認   : get  /vd/synchronize            → data.sync_status === 'online' が必須
//     ・値の取得   : get  /vd/parameters/{addr}
//     ・購読開始   : post /vd/parameters/{addr}?operation=regist   (解除は unregist)
//     ・メーター   : /vd/meters/{addr} も同様に get / regist / unregist
//     受信(通知含む) { params|result: { vdp: { uri, data:{ current_value } } } }
//
//   値の書き込み (UI 操作 → 実機):
//     送信 { method:'setParameter', params:{ vdp:{ uri:'/vd/parameters/{addr}',
//            data:{ current_value } } } }
//
//   アドレス形式:
//     パラメータ  "{paramId}:{x}:{y}"  … y は多くの場合チャンネル/ペアのインデックス
//     メーター    "{meterId}:{x}"      … x はチャンネル (L/R は連番)
//
// -----------------------------------------------------------------------------
// ■ パラメータ型 (PARAM_MAPPINGS の type / 変換実装: broker handleParamUpdate)
// -----------------------------------------------------------------------------
//   level            フェーダー。dB×100 (例 -6000 = -60dB)。-32768 は -∞
//   level_knob       センドレベルノブ。dB×100。dataset.value に dB を保持し
//                    -60dB 以下で結線ミュート判定 (view isFaderMuted)
//   pan              パン/バランス。-63(L) .. 0(C) .. +63(R)
//   gain             アナログプリアンプゲイン。dB×100 (-800..7000)
//   dgain            デジタルゲイン。dB×100 (-2400..2400)
//   phonesLevel      ヘッドホンレベル。0..100 → 表示 0.0..10.0
//   bool             1 = ON
//   bool_ssmcs       SSMCS 版 COMP/EQ。0 = ON (論理が反転)
//   bool_stereo_pair L/R ペア書き込み。rightY に R 側の y を持つ
//   insertFx         0xffffffff / -1 = OFF、それ以外 = ON (挿し込み先 ID)
//   freq             周波数。Hz×10。表示は 20Hz..20kHz の対数スケール
//   oscMode          オシレーター波形。value: 0=SINE, 1=PINK, 2=BURST
//   portRef          パッチ(入力元)選択。current_value の下位 31bit がポート ID。
//                    受信時に currentPatches[対象ノード] を更新する
//   string           チャンネル名など。JSON 引用符付き文字列の場合がある
//   delayTime        STREAMING DELAY タイム。ms×100 (1.00..1000.00 ms)
//   frameRate        STREAMING DELAY フレームレート。ドロップダウン順の index 0..7
//   chColor          CH SETTING カラー。パレット index (CH_COLOR_PALETTE、10 = Off)。
//                    ノード上辺のアクセント色に反映する
//   sampleRate       サンプルレート。生 Hz (44100/48000/96000/192000)。表示のみ —
//                    書き込むと実機が再クロックするため viewer からは送信しない
//
//   メーター値: dBFS×10 (例 -600 = -60dB)。32767 は OVER (クリップ) センチネル。
//   無信号時の静止値は -1280。表示レンジ -60..+10dB
//
//   実機検証済みの詳細仕様 (購読プロトコル・全パラメータカタログ・メータータップ表)
//   は docs/device-mapping.md (../urx-router 由来) を参照。

import type { MeterMapping, ParamMapping, ReverseParamEntry } from '../shared/types';

// -----------------------------------------------------------------------------
// ■ ポート ID → ノード ID (portRef 受信時の解決に使用)
// -----------------------------------------------------------------------------

// 出力パッチ・バス入力ソースの選択肢 (バス系 + 入力チャンネルのダイレクト)。
// バスは L/R ペア (偶数 = L / 奇数 = R)、入力チャンネルはフラットな物理入力
// スロット軸 (ステレオペアは2スロット占有) — docs/device-mapping.md §3.1
export const PORT_TO_NODE: Record<number, string> = {
    256: 'bus-stereo', // Stereo Bus L
    257: 'bus-stereo', // Stereo Bus R
    258: 'bus-stream', // Streaming Bus L
    259: 'bus-stream', // Streaming Bus R
    288: 'bus-mix1',   // MIX 1 L
    289: 'bus-mix1',   // MIX 1 R
    290: 'bus-mix2',   // MIX 2 L
    291: 'bus-mix2',   // MIX 2 R
    336: 'bus-mon1',   // MON 1 L
    337: 'bus-mon1',   // MON 1 R
    338: 'bus-mon2',   // MON 2 L
    339: 'bus-mon2',   // MON 2 R
    0: 'in-ch1',       // 入力チャンネル ダイレクト (スロット軸)
    1: 'in-ch2',
    2: 'in-ch34',
    3: 'in-ch34',
    4: 'in-ch56',
    5: 'in-ch56',
    6: 'in-ch78',
    7: 'in-ch78',
    8: 'in-ch910',
    9: 'in-ch910',
};

// 入力チャンネルの入力元 (物理入力ポート)。ステレオペアは偶数=L / 奇数=R で
// 同じノードに解決する
export const INPUT_PORT_TO_NODE: Record<number, string> = {
    0: 'in-port-mic1',
    1: 'in-port-mic2',
    2: 'in-port-mic3',
    3: 'in-port-mic4',
    256: 'in-port-aux',
    257: 'in-port-aux',
    512: 'in-port-usba',
    513: 'in-port-usba',
    514: 'in-port-usbb',
    515: 'in-port-usbb',
    516: 'in-port-usbc',
    517: 'in-port-usbc',
    544: 'in-port-daw12',
    545: 'in-port-daw12',
    546: 'in-port-daw34',
    547: 'in-port-daw34',
    548: 'in-port-daw56',
    549: 'in-port-daw56',
    550: 'in-port-daw78',
    551: 'in-port-daw78',
    552: 'in-port-daw910',
    553: 'in-port-daw910',
    554: 'in-port-daw1112',
    555: 'in-port-daw1112',
    576: 'in-port-usbsub',
    577: 'in-port-usbsub',
    608: 'in-port-sdplay',
    609: 'in-port-sdplay',
    624: 'in-port-hdmi',
    625: 'in-port-hdmi',
};

// -----------------------------------------------------------------------------
// ■ ノード ID → メーターアドレス
// -----------------------------------------------------------------------------
// USB 出力 (MAIN A/B/C, SUB) はパッチ先ソースのメーターを追従表示するために使う。
// 注意: 入力チャンネルは METER_MAPPINGS (100/101 = INPUT タップ) とは別の
// タップ (115/120) を意図的に参照している — 統合しないこと。

export function getMeterAddressForNode(nodeId: string): string | null {
    if (nodeId === 'bus-stereo') return '125:0';
    if (nodeId === 'bus-stream') return '127:0';
    if (nodeId === 'bus-mix1') return '126:0';
    if (nodeId === 'bus-mix2') return '126:2';
    if (nodeId === 'bus-mon1') return '129:0';
    if (nodeId === 'bus-mon2') return '129:2';
    if (nodeId === 'in-ch1') return '115:0';
    if (nodeId === 'in-ch2') return '115:1';
    if (nodeId === 'in-ch34') return '120:0';
    if (nodeId === 'in-ch56') return '120:2';
    if (nodeId === 'in-ch78') return '120:4';
    if (nodeId === 'in-ch910') return '120:6';
    return null;
}

// -----------------------------------------------------------------------------
// ■ portRef パラメータの選択肢ポート集合
// -----------------------------------------------------------------------------

export const MAIN_PORTS: number[] = [256, 258, 288, 290, 336, 338];                    // MAIN OUT のパッチ候補
export const USB_PORTS: number[] = [256, 258, 288, 290, 336, 338, 0, 1, 2, 4, 6, 8];   // USB 出力のパッチ候補
export const INPUT_PORTS: number[] = [                                                  // 入力チャンネルの入力元候補
    0, 1, 2, 3, 256, 257, 512, 513, 514, 515, 516, 517,
    544, 545, 546, 547, 548, 549, 550, 551, 552, 553, 554, 555,
    576, 577, 608, 609, 624, 625,
];

// -----------------------------------------------------------------------------
// ■ PARAM_MAPPINGS: UI 要素 ID → デバイスパラメータアドレス
// -----------------------------------------------------------------------------
// キーは DOM 要素の id。値は { paramId, x, y, type } (+ type 固有の付加情報)。
// broker はこの表から購読リスト・初期取得リスト・逆引きマップを組み立てる。

export const PARAM_MAPPINGS: Record<string, ParamMapping> = {};

// --- 1. モノラル入力チャンネル (CH 1, CH 2) --- y = チャンネル番号 (0, 1)
for (let i = 0; i < 2; i++) {
    const y = i;
    const pfx = `in-ch${i + 1}`;
    Object.assign(PARAM_MAPPINGS, {
        [`${pfx}-knob-gain`]: { paramId: 1, x: 0, y, type: 'gain' },          // アナログゲイン
        [`${pfx}-knob-ch`]: { paramId: 139, x: 0, y, type: 'level_knob' },    // CH フェーダー
        [`${pfx}-knob-pan`]: { paramId: 141, x: 0, y, type: 'pan' },
        [`${pfx}-btn-on`]: { paramId: 140, x: 0, y, type: 'bool' },           // CH ON
        [`${pfx}-btn-tost`]: { paramId: 142, x: 0, y, type: 'bool' },         // TO ST アサイン
        [`${pfx}-knob-mix1`]: { paramId: 146, x: 0, y, type: 'level_knob' },  // MIX1 センド
        [`${pfx}-knob-mix1-pan`]: { paramId: 147, x: 0, y, type: 'pan' },
        [`${pfx}-send-mix1-on`]: { paramId: 148, x: 0, y, type: 'bool' },
        [`${pfx}-send-mix1-pre`]: { paramId: 151, x: 0, y, type: 'bool' },    // PRE/POST
        [`${pfx}-knob-mix2`]: { paramId: 158, x: 0, y, type: 'level_knob' },  // MIX2 センド
        [`${pfx}-knob-mix2-pan`]: { paramId: 159, x: 0, y, type: 'pan' },
        [`${pfx}-send-mix2-on`]: { paramId: 160, x: 0, y, type: 'bool' },
        [`${pfx}-send-mix2-pre`]: { paramId: 163, x: 0, y, type: 'bool' },
        [`${pfx}-send-fx1-pre`]: { paramId: 193, x: 0, y, type: 'bool' },     // FX センド tap (base+0)
        [`${pfx}-knob-fx1`]: { paramId: 194, x: 0, y, type: 'level_knob' },   // FX1 センド
        [`${pfx}-send-fx1-on`]: { paramId: 196, x: 0, y, type: 'bool' },
        [`${pfx}-send-fx2-pre`]: { paramId: 197, x: 0, y, type: 'bool' },
        [`${pfx}-knob-fx2`]: { paramId: 198, x: 0, y, type: 'level_knob' },   // FX2 センド
        [`${pfx}-send-fx2-on`]: { paramId: 200, x: 0, y, type: 'bool' },
        [`${pfx}-dsp-hpf`]: { paramId: 25, x: 0, y, type: 'bool' },           // DSP ブロック
        [`${pfx}-dsp-gate`]: { paramId: 28, x: 0, y, type: 'bool' },
        [`${pfx}-dsp-comp`]: { paramId: 34, x: 0, y, type: 'bool' },
        [`${pfx}-dsp-eq`]: { paramId: 44, x: 0, y, type: 'bool' },
        [`${pfx}-dsp-insfx`]: { paramId: 135, x: 0, y, type: 'insertFx' },
        [`${pfx}-dsp-48v`]: { paramId: 0, x: 0, y, type: 'bool' },            // +48V 表示
        [`${pfx}-ind-src`]: { paramId: 22, x: 0, y, type: 'portRef', ports: INPUT_PORTS }, // 入力元
        [`${pfx}-subtitle`]: { paramId: 18, x: 0, y, type: 'string' },        // チャンネル名
        // CH SETTING カラー (キーはノード要素そのもの — 上辺アクセント色に反映)
        [pfx]: { paramId: 20, x: 0, y, type: 'chColor' }
    } satisfies Record<string, ParamMapping>);
    // Hi-Z は CH 2 のみ
    if (i === 1) PARAM_MAPPINGS['in-ch2-dsp-hiz'] = { paramId: 6, x: 0, y: 1, type: 'bool' };
}

// --- 2. ステレオ入力チャンネル (CH 3/4 〜 9/10) --- y = ペア番号 (0..3)
// D.GAIN の paramId のみペアごとに不連続なので個別指定
const stereoChs = ['34', '56', '78', '910'];
const gainOffsets = [9, 13, 14, 15];
for (let i = 0; i < 4; i++) {
    const y = i;
    const pfx = `in-ch${stereoChs[i]}`;
    Object.assign(PARAM_MAPPINGS, {
        [`${pfx}-knob-gain`]: { paramId: gainOffsets[i]!, x: 0, y: 0, type: 'dgain' },
        [`${pfx}-knob-ch`]: { paramId: 266, x: 0, y, type: 'level_knob' },
        [`${pfx}-knob-pan`]: { paramId: 268, x: 0, y, type: 'pan' },
        [`${pfx}-btn-on`]: { paramId: 267, x: 0, y, type: 'bool' },
        [`${pfx}-btn-tost`]: { paramId: 269, x: 0, y, type: 'bool' },
        [`${pfx}-knob-mix1`]: { paramId: 273, x: 0, y, type: 'level_knob' },
        [`${pfx}-knob-mix1-pan`]: { paramId: 274, x: 0, y, type: 'pan' },
        [`${pfx}-send-mix1-on`]: { paramId: 275, x: 0, y, type: 'bool' },
        [`${pfx}-send-mix1-pre`]: { paramId: 278, x: 0, y, type: 'bool' },
        [`${pfx}-knob-mix2`]: { paramId: 285, x: 0, y, type: 'level_knob' },
        [`${pfx}-knob-mix2-pan`]: { paramId: 286, x: 0, y, type: 'pan' },
        [`${pfx}-send-mix2-on`]: { paramId: 287, x: 0, y, type: 'bool' },
        [`${pfx}-send-mix2-pre`]: { paramId: 290, x: 0, y, type: 'bool' },
        [`${pfx}-send-fx1-pre`]: { paramId: 320, x: 0, y, type: 'bool' },
        [`${pfx}-knob-fx1`]: { paramId: 321, x: 0, y, type: 'level_knob' },
        [`${pfx}-send-fx1-on`]: { paramId: 323, x: 0, y, type: 'bool' },
        [`${pfx}-send-fx2-pre`]: { paramId: 324, x: 0, y, type: 'bool' },
        [`${pfx}-knob-fx2`]: { paramId: 325, x: 0, y, type: 'level_knob' },
        [`${pfx}-send-fx2-on`]: { paramId: 327, x: 0, y, type: 'bool' },
        [`${pfx}-dsp-eq`]: { paramId: 213, x: 0, y, type: 'bool' },
        [`${pfx}-dsp-ducker`]: { paramId: 258, x: 0, y, type: 'bool' },
        [`${pfx}-ind-src`]: { paramId: 209, x: 0, y, type: 'portRef', ports: INPUT_PORTS },
        [`${pfx}-subtitle`]: { paramId: 206, x: 0, y, type: 'string' },
        [pfx]: { paramId: 208, x: 0, y, type: 'chColor' }                     // CH SETTING カラー
    } satisfies Record<string, ParamMapping>);
}

// --- 3. バス・出力・オシレーター ---
Object.assign(PARAM_MAPPINGS, {
    // FX バス (y = 0: FX1 / 1: FX2)
    'bus-fx1-knob-bal': { paramId: 339, x: 0, y: 0, type: 'pan' },
    'bus-fx1-fader-rtn': { paramId: 337, x: 0, y: 0, type: 'level' },
    'bus-fx1-btn-on': { paramId: 338, x: 0, y: 0, type: 'bool' },
    'bus-fx1-btn-tost': { paramId: 340, x: 0, y: 0, type: 'bool' },
    'bus-fx1-dsp-revx': { paramId: 338, x: 0, y: 0, type: 'bool' },
    'bus-fx1-subtitle': { paramId: 333, x: 0, y: 0, type: 'string' },

    'bus-fx2-knob-bal': { paramId: 339, x: 0, y: 1, type: 'pan' },
    'bus-fx2-fader-rtn': { paramId: 337, x: 0, y: 1, type: 'level' },
    'bus-fx2-btn-on': { paramId: 338, x: 0, y: 1, type: 'bool' },
    'bus-fx2-btn-tost': { paramId: 340, x: 0, y: 1, type: 'bool' },
    'bus-fx2-dsp-delay': { paramId: 338, x: 0, y: 1, type: 'bool' },
    'bus-fx2-subtitle': { paramId: 333, x: 0, y: 1, type: 'string' },

    // FX チャンネル → MIX センド (y = FX index)。MIX ごとに 10 パラメータの
    // L/R ブロック (L スロットのみ購読; デバイスが R をリンク)。オフセット:
    // tap +0 / level +1 / BAL +2 / on +3 — docs/device-mapping.md §4.3
    'bus-fx1-send-mix1-pre': { paramId: 342, x: 0, y: 0, type: 'bool' },
    'bus-fx1-knob-mix1': { paramId: 343, x: 0, y: 0, type: 'level_knob' },
    'bus-fx1-knob-mix1-pan': { paramId: 344, x: 0, y: 0, type: 'pan' },
    'bus-fx1-send-mix1-on': { paramId: 345, x: 0, y: 0, type: 'bool' },
    'bus-fx1-send-mix2-pre': { paramId: 352, x: 0, y: 0, type: 'bool' },
    'bus-fx1-knob-mix2': { paramId: 353, x: 0, y: 0, type: 'level_knob' },
    'bus-fx1-knob-mix2-pan': { paramId: 354, x: 0, y: 0, type: 'pan' },
    'bus-fx1-send-mix2-on': { paramId: 355, x: 0, y: 0, type: 'bool' },
    'bus-fx2-send-mix1-pre': { paramId: 342, x: 0, y: 1, type: 'bool' },
    'bus-fx2-knob-mix1': { paramId: 343, x: 0, y: 1, type: 'level_knob' },
    'bus-fx2-knob-mix1-pan': { paramId: 344, x: 0, y: 1, type: 'pan' },
    'bus-fx2-send-mix1-on': { paramId: 345, x: 0, y: 1, type: 'bool' },
    'bus-fx2-send-mix2-pre': { paramId: 352, x: 0, y: 1, type: 'bool' },
    'bus-fx2-knob-mix2': { paramId: 353, x: 0, y: 1, type: 'level_knob' },
    'bus-fx2-knob-mix2-pan': { paramId: 354, x: 0, y: 1, type: 'pan' },
    'bus-fx2-send-mix2-on': { paramId: 355, x: 0, y: 1, type: 'bool' },

    // MIX バス (L/R リンクのため y は 0/2。R 側 y+1 は逆引きマップで補完される)
    'bus-mix1-knob-bal': { paramId: 676, x: 0, y: 0, type: 'pan' },
    'bus-mix1-fader-mst': { paramId: 674, x: 0, y: 0, type: 'level' },
    'bus-mix1-btn-on': { paramId: 675, x: 0, y: 0, type: 'bool' },
    'bus-mix1-btn-tost': { paramId: 677, x: 0, y: 0, type: 'bool' },
    'bus-mix1-dsp-eq': { paramId: 591, x: 0, y: 0, type: 'bool' },
    'bus-mix1-dsp-insfx': { paramId: 671, x: 0, y: 0, type: 'insertFx' },
    'bus-mix1-subtitle': { paramId: 584, x: 0, y: 0, type: 'string' },

    'bus-mix2-knob-bal': { paramId: 676, x: 0, y: 2, type: 'pan' },
    'bus-mix2-fader-mst': { paramId: 674, x: 0, y: 2, type: 'level' },
    'bus-mix2-btn-on': { paramId: 675, x: 0, y: 2, type: 'bool' },
    'bus-mix2-btn-tost': { paramId: 677, x: 0, y: 2, type: 'bool' },
    'bus-mix2-dsp-eq': { paramId: 591, x: 0, y: 2, type: 'bool' },
    'bus-mix2-dsp-insfx': { paramId: 671, x: 0, y: 2, type: 'insertFx' },
    'bus-mix2-subtitle': { paramId: 584, x: 0, y: 2, type: 'string' },

    // モニターバス (y = 0: MON1 / 1: MON2)
    'bus-mon1-btn-on': { paramId: 723, x: 0, y: 0, type: 'bool' },
    'bus-mon1-cue-int': { paramId: 721, x: 0, y: 0, type: 'bool' },
    'bus-mon1-mono': { paramId: 722, x: 0, y: 0, type: 'bool' },
    'bus-mon1-knob-gain': { paramId: 724, x: 0, y: 0, type: 'dgain' },
    'bus-mon2-btn-on': { paramId: 723, x: 0, y: 1, type: 'bool' },
    'bus-mon2-cue-int': { paramId: 721, x: 0, y: 1, type: 'bool' },
    'bus-mon2-mono': { paramId: 722, x: 0, y: 1, type: 'bool' },
    'bus-mon2-knob-gain': { paramId: 724, x: 0, y: 1, type: 'dgain' },

    // STEREO バス / MAIN OUT (同じパラメータを両ノードの UI が共有する)
    'out-main-btn-on': { paramId: 582, x: 0, y: 0, type: 'bool' },
    'out-main-knob-bal': { paramId: 583, x: 0, y: 0, type: 'pan' },
    'bus-stereo-fader-out': { paramId: 581, x: 0, y: 0, type: 'level' },
    'bus-stereo-btn-on': { paramId: 582, x: 0, y: 0, type: 'bool' },
    'bus-stereo-knob-bal': { paramId: 583, x: 0, y: 0, type: 'pan' },
    'bus-stereo-dsp-eq': { paramId: 498, x: 0, y: 0, type: 'bool' },
    'bus-stereo-dsp-insfx': { paramId: 578, x: 0, y: 0, type: 'insertFx' },

    // ヘッドホン (y = 0: PHONES1 / 1: PHONES2)
    'out-ph1-knob-out': { paramId: 725, x: 0, y: 0, type: 'phonesLevel' },
    'out-ph2-knob-out': { paramId: 725, x: 0, y: 1, type: 'phonesLevel' },

    // 出力パッチ / バス入力ソース (portRef)
    'out-main-ind-patch': { paramId: 730, x: 0, y: 0, type: 'portRef', ports: MAIN_PORTS },
    'out-usba-ind-patch': { paramId: 732, x: 0, y: 0, type: 'portRef', ports: USB_PORTS },
    'out-usbb-ind-patch': { paramId: 733, x: 0, y: 0, type: 'portRef', ports: USB_PORTS },
    'out-usbc-ind-patch': { paramId: 734, x: 0, y: 0, type: 'portRef', ports: USB_PORTS },
    'out-usbsub-ind-patch': { paramId: 735, x: 0, y: 0, type: 'portRef', ports: USB_PORTS },
    'bus-stream-ind-src': { paramId: 705, x: 0, y: 0, type: 'portRef', ports: [256, 288, 290] },

    // STREAMING (bus-stream, y = 0): 名前 / DELAY / フレームレート
    // (docs/device-mapping.md §4.4 — 実機確認済み: 名前 702 / DELAY 707・708 / FPS 830)
    'bus-stream-subtitle': { paramId: 702, x: 0, y: 0, type: 'string' },
    'bus-stream-dsp-delay': { paramId: 707, x: 0, y: 0, type: 'bool' },
    'bus-stream-knob-delay': { paramId: 708, x: 0, y: 0, type: 'delayTime' },
    'bus-stream-frame-rate': { paramId: 830, x: 0, y: 0, type: 'frameRate' },
    'bus-mon1-ind-src': { paramId: 719, x: 0, y: 0, type: 'portRef', ports: [288, 290] },
    'bus-mon2-ind-src': { paramId: 719, x: 0, y: 1, type: 'portRef', ports: [288, 290] },

    // バスの CH SETTING カラー (キーはノード要素そのもの — 上辺アクセント色と
    // 下流結線色に反映。docs/device-mapping.md §4.4)。y は各バスの識別スロット:
    // FX = FX index、MIX = L/R ペアの L (MIX1=0 / MIX2=2、R は逆引き補完)、
    // STEREO = 0、STREAMING = 8スロットミラーの先頭。MONITOR にカラーはない。
    'bus-fx1': { paramId: 335, x: 0, y: 0, type: 'chColor' },
    'bus-fx2': { paramId: 335, x: 0, y: 1, type: 'chColor' },
    'bus-mix1': { paramId: 586, x: 0, y: 0, type: 'chColor' },
    'bus-mix2': { paramId: 586, x: 0, y: 2, type: 'chColor' },
    'bus-stereo': { paramId: 496, x: 0, y: 0, type: 'chColor' },
    'bus-stream': { paramId: 704, x: 0, y: 0, type: 'chColor' },

    // グローバル: サンプルレート (ヘッダーのタイトルバー表示、表示のみ)
    'sample-rate': { paramId: 766, x: 0, y: 0, type: 'sampleRate' },

    // オシレーター
    'bus-osc-btn-on': { paramId: 710, x: 0, y: 0, type: 'bool' },
    'bus-osc-knob-level': { paramId: 711, x: 0, y: 0, type: 'level_knob' },
    'bus-osc-knob-freq': { paramId: 713, x: 0, y: 0, type: 'freq' },
    'bus-osc-mode-sine': { paramId: 712, x: 0, y: 0, type: 'oscMode', value: 0 },
    'bus-osc-mode-pink': { paramId: 712, x: 0, y: 0, type: 'oscMode', value: 1 },
    'bus-osc-mode-burst': { paramId: 712, x: 0, y: 0, type: 'oscMode', value: 2 },
    'bus-osc-send-stereo-on': { paramId: 716, x: 0, y: 0, type: 'bool_stereo_pair', rightY: 1 },
    'bus-osc-send-mix1-on': { paramId: 717, x: 0, y: 0, type: 'bool_stereo_pair', rightY: 1 },
    'bus-osc-send-mix2-on': { paramId: 717, x: 0, y: 2, type: 'bool_stereo_pair', rightY: 3 },
    'bus-osc-send-fx1-on': { paramId: 718, x: 0, y: 0, type: 'bool' },
    'bus-osc-send-fx2-on': { paramId: 718, x: 0, y: 1, type: 'bool' }
} satisfies Record<string, ParamMapping>);

// -----------------------------------------------------------------------------
// ■ CH SETTING カラーパレット (chColor 型の値の解釈)
// -----------------------------------------------------------------------------
// broker が保持するのはパレット index (配列位置がそのまま index)。hex は
// urx-router がダークテーマ向けに調整した代表値 (デバイスは色名しか公開しない)。
// index 10 = Off — ノード上辺をカテゴリ既定色に戻す。

export const CH_COLOR_PALETTE: readonly { name: string; hex: string }[] = [
    { name: 'Blue', hex: '#4a78c0' },
    { name: 'Orange', hex: '#e8913a' },
    { name: 'Yellow', hex: '#d9b441' },
    { name: 'Purple', hex: '#8e6fc0' },
    { name: 'Cyan', hex: '#3fa6a0' },
    { name: 'Magenta', hex: '#c0628f' },
    { name: 'Red', hex: '#d9534f' },
    { name: 'Green', hex: '#5c9e64' },
    { name: 'Light Green', hex: '#8ec46a' },
    { name: 'White', hex: '#d8dce0' },
];

/** パレット index → hex。Off (10) や未知の index は null (カテゴリ色に戻す)。 */
export function chColorToHex(index: number): string | null {
    return CH_COLOR_PALETTE[index]?.hex ?? null;
}

// -----------------------------------------------------------------------------
// ■ REVERSE_PARAM_MAP: 通知アドレス "{paramId}:{x}:{y}" → 対象 UI 要素の逆引き
// -----------------------------------------------------------------------------
// 1 アドレスが複数要素に対応することがあるため配列。L/R リンクや SSMCS 版
// パラメータの別アドレスもここで補完する。

export const REVERSE_PARAM_MAP: Record<string, ReverseParamEntry[]> = {};
{
    const addReverse = (key: string, entry: ReverseParamEntry): void => {
        if (!REVERSE_PARAM_MAP[key]) REVERSE_PARAM_MAP[key] = [];
        REVERSE_PARAM_MAP[key].push(entry);
    };
    for (const [elId, spec] of Object.entries(PARAM_MAPPINGS)) {
        addReverse(`${spec.paramId}:${spec.x}:${spec.y}`, { elId, type: spec.type });

        // ステレオ出力の L/R リンクペア (Level, ON, Balance, EQ, INS FX,
        // MIX カラー): R 側 (y+1) の通知でも同じ UI を更新する
        if ([674, 675, 676, 591, 671, 586].includes(spec.paramId)) {
            addReverse(`${spec.paramId}:${spec.x}:${spec.y + 1}`, { elId, type: spec.type });
        }

        // 出力パッチセレクタ (MAIN OUT 730 / USB 732-735) は L/R の2スロット構成
        // (y=0/1、書き込みは両方 — docs/device-mapping.md §4.4)。既定購読は L のみ
        // だが、R 側 (y+1) の通知も同じチップに解決する。R の値は R 側 port id で
        // 届くが PORT_TO_NODE が L/R 両方を同じノードへ引くので表示は一致する
        if ([730, 732, 733, 734, 735].includes(spec.paramId)) {
            addReverse(`${spec.paramId}:${spec.x}:${spec.y + 1}`, { elId, type: spec.type });
        }

        // オシレーターセンドの L/R ペア
        if (spec.type === 'bool_stereo_pair') {
            addReverse(`${spec.paramId}:${spec.x}:${spec.rightY}`, { elId, type: spec.type });
        }

        // ステレオ入力チャンネルの D.GAIN も R 側通知を受ける
        if (spec.type === 'dgain' && elId.startsWith('in-ch')) {
            addReverse(`${spec.paramId}:${spec.x}:${spec.y + 1}`, { elId, type: spec.type });
        }

        // COMP/EQ は SSMCS モーフィング版のアドレスでも通知される (論理反転)
        if (spec.paramId === 34) { // COMP_ON mono
            addReverse(`94:0:${spec.y}`, { elId, type: 'bool_ssmcs' }); // SSMCS_COMP_ON
        }
        if (spec.paramId === 44) { // EQ_ON mono
            addReverse(`106:0:${spec.y}`, { elId, type: 'bool_ssmcs' }); // SSMCS_EQ_ON
        }
    }
}

// -----------------------------------------------------------------------------
// ■ METER_MAPPINGS: UI メーター要素 ID → メーターアドレス
// -----------------------------------------------------------------------------
// USB 出力のメーターはここには載せず、パッチ先に追従して動的に更新する
// (broker handleMeterUpdate + getMeterAddressForNode)

export const METER_MAPPINGS: Record<string, MeterMapping> = {
    'in-ch1-meter': { meterId: 100, x: 0 },   // INPUT タップ (全 DSP 前、常時有効)
    'in-ch2-meter': { meterId: 100, x: 1 },
    'in-ch34-meter': { meterId: 101, x: 0 },  // ステレオ INPUT タップ
    'in-ch34-meter-r': { meterId: 101, x: 1 },
    'in-ch56-meter': { meterId: 101, x: 2 },
    'in-ch56-meter-r': { meterId: 101, x: 3 },
    'in-ch78-meter': { meterId: 101, x: 4 },
    'in-ch78-meter-r': { meterId: 101, x: 5 },
    'in-ch910-meter': { meterId: 101, x: 6 },
    'in-ch910-meter-r': { meterId: 101, x: 7 },
    'bus-mix1-meter': { meterId: 126, x: 0 },
    'bus-mix1-meter-r': { meterId: 126, x: 1 },
    'bus-mix2-meter': { meterId: 126, x: 2 },
    'bus-mix2-meter-r': { meterId: 126, x: 3 },
    'bus-stereo-meter': { meterId: 125, x: 0 },
    'bus-stereo-meter-r': { meterId: 125, x: 1 },
    'bus-fx1-meter': { meterId: 118, x: 0 },
    'bus-fx1-meter-r': { meterId: 118, x: 1 },
    'bus-fx2-meter': { meterId: 118, x: 2 },
    'bus-fx2-meter-r': { meterId: 118, x: 3 },
    // PHONES 1/2 のメーターは専用 meterId 未確認のため未登録。
    // PHONES LEVEL を操作しながら受信メッセージを観測して確認後に追加する。
    'bus-mon1-meter': { meterId: 129, x: 0 }, // PHONES 1 と共用
    'bus-mon1-meter-r': { meterId: 129, x: 1 },
    'bus-mon2-meter': { meterId: 129, x: 2 }, // PHONES 2 と共用
    'bus-mon2-meter-r': { meterId: 129, x: 3 },
    'bus-stream-meter': { meterId: 127, x: 0 },   // 確認済み: meters.ts bus.stream
    'bus-stream-meter-r': { meterId: 127, x: 1 },
};

// USB 出力の動的メーター追従のために追加購読するアドレス群
// (METER_MAPPINGS と重複していても購読は無害)
export const EXTRA_METERS: string[] = [
    '125:0', '125:1',                             // STEREO
    '127:0',                                      // STREAM
    '126:0', '126:1', '126:2', '126:3',           // MIX 1/2
    '129:0', '129:1', '129:2', '129:3',           // MON 1/2
    '115:0', '115:1',                             // CH 1/2 (ダイレクト用タップ)
    '120:0', '120:1', '120:2', '120:3', '120:4', '120:5', '120:6', '120:7', // CH 3/4..9/10
    '131:0', '131:1',
];

// メーター通知アドレス "{meterId}:{x}" → UI 要素 ID の逆引き。
// メータータップ切替 (src/data/meter-taps.ts) が METER_MAPPINGS を書き換えた
// 後に再構築する。
export const REVERSE_METER_MAP: Record<string, string[]> = {};
export function rebuildReverseMeterMap(): void {
    for (const key of Object.keys(REVERSE_METER_MAP)) {
        delete REVERSE_METER_MAP[key];
    }
    for (const [elId, spec] of Object.entries(METER_MAPPINGS)) {
        const key = `${spec.meterId}:${spec.x}`;
        if (!REVERSE_METER_MAP[key]) REVERSE_METER_MAP[key] = [];
        REVERSE_METER_MAP[key].push(elId);
    }
}
rebuildReverseMeterMap();
