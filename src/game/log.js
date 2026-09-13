// できごとログの文言（CONTRACT §8.3）。effect → { text, tone } | null。
// 短い日常語の一文。恐怖を煽らない。DOM・乱数は使わない。
import { findObject } from './objects.js';

const label = (state, id, fallback = 'なにか') => {
  const o = findObject(state, id);
  return o && o.label ? o.label : fallback;
};

// 収納先の名前：object id（store レシピの相手）または wall.model（高い場所）
function placeLabel(state, into, fallback = '高い場所') {
  if (into == null) return fallback;
  const o = findObject(state, into);
  if (o && o.label) return o.label;
  const walls = (state.stage && state.stage.walls) || [];
  for (const w of walls) if (w.model === into) return w.label || fallback;
  return fallback;
}

// 訪問者の名前（state.visitors から）
function visitorType(state, id) {
  for (const v of state.visitors || []) if (v.id === id) return v.type || 'uncle';
  return null;
}
function visitorLabel(state, id, fallback = 'おじさん') {
  for (const v of state.visitors || []) if (v.id === id) return v.label || fallback;
  return fallback;
}

// 口に入れる物の呼び名（§11.1, §11.4）：ingestible な toy は「ジグソーパズルの小さなピース」
function mouthName(obj, fallback = 'なにか') {
  if (!obj) return fallback;
  if (obj.kind === 'toy' && obj.riskLabel) return `${obj.label}の${obj.riskLabel}`;
  return obj.label || fallback;
}

// 満足度の増減を「+25」「−15」の形に
function signed(amount) {
  const n = Math.round(Math.abs(amount));
  return amount < 0 ? `−${n}` : `+${n}`;
}

// 通常ヒヤリの動詞（accident ごと）。分からなければ「に手が届いた」
function hiyariVerb(accident) {
  switch (accident) {
    case '誤飲': return 'を口に入れそうになった！';
    case '転落': return 'から落ちそうになった！';
    case '打撲': return 'にぶつかりそうになった！';
    case '指はさみ': return 'に指をはさみそうになった！';
    case 'やけど': return 'に触りそうになった！';
    case '窒息': return 'をかぶりそうになった！';
    case '転倒': return 'ですべって転びそうになった！';
    default: return 'に手が届いた！';
  }
}

// 「拾って捨てる」→「拾って捨てた」「片付ける」→「片付けた」
function pastTense(fix) {
  if (!fix) return '片付けた';
  if (/る$/.test(fix)) return fix.replace(/る$/, 'た');
  return `${fix}した`;
}

export function describeEvent(effect, state) {
  if (!effect) return null;
  const p = effect.payload || {};
  const obj = findObject(state, effect.objectId);
  const name = obj && obj.label ? obj.label : null;
  switch (effect.type) {
    case 'hiyari': {
      if (p.combo) return null; // combo_hiyari 側で 1 件だけ出す
      if (!obj) return { text: '危ないものに手が届いた！', tone: 'bad' };
      if (p.mouth) return { text: `${mouthName(obj)}を飲み込んだ！（誤飲）`, tone: 'bad' }; // 口に入れていた物（§11.1）
      const acc = obj.accident ? `（${obj.accident}）` : '';
      if (obj.climbable) return { text: `${obj.label}から落ちた！${acc}`, tone: 'bad' }; // 登っていて転落（§10.1）
      return { text: `${obj.label}${hiyariVerb(obj.accident)}${acc}`, tone: 'bad' };
    }
    case 'combo_hiyari': {
      const toy = label(state, p.toyId, 'おもちゃ');
      const hz = name || '危ないところ';
      let text = `${toy}を持って${hz}へ！`;
      if (p.ignoresFix) text += ` ${obj && obj.fix ? obj.fix : '対策'}をしていても危険`;
      return { text, tone: 'bad' };
    }
    case 'play_start':
      return { text: `${name || 'おもちゃ'}で遊んでいる！`, tone: 'good' };
    case 'play_done':
      return { text: `${name || 'おもちゃ'}で遊んで満足（${signed(p.amount ?? 0)}）`, tone: 'good' };
    case 'fixed': {
      if (p.via === 'goods') return { text: `${label(state, p.goodsId, '安全グッズ')} → ${name || '危ないところ'}。すぐに対策できた`, tone: 'good' };
      if (p.via === 'high') return { text: `${name || '危ないもの'}を${placeLabel(state, p.into)}の上へ移した。届かない`, tone: 'good' };
      if (p.via === 'store') return { text: `${name || '危ないもの'}を${placeLabel(state, p.into, '収納')}に収納した`, tone: 'good' };
      // 長押し廃止（§9.1）後はここには来ないが、他経路の fixed のために残す
      if (obj && obj.fix) return { text: `${obj.label}を対策した（${obj.fix}）`, tone: 'good' };
      return { text: `${name || '危ないところ'}を対策した`, tone: 'good' };
    }
    case 'removed': {
      if (!obj) return null;
      if (p.merged) return null; // toy_merged 側で出す
      if (obj.kind === 'item') return { text: `${obj.label}を${pastTense(obj.fix)}`, tone: 'good' };
      if (obj.kind === 'toy') return { text: `${obj.label}を片付けた`, tone: 'info' };
      return null;
    }
    case 'trashed': {
      // 容れ物に捨てた（§9.4）：「ボタン電池をゴミ箱に捨てた」
      const kind = p.kind || (obj && obj.kind);
      return { text: `${name || 'それ'}を${placeLabel(state, p.into, 'ゴミ箱')}に捨てた`, tone: kind === 'item' ? 'good' : 'info' };
    }
    case 'stored': {
      // 高い場所に片付けた（§9.4）：「ボールを棚の上に片付けた」
      const kind = p.kind || (obj && obj.kind);
      return { text: `${name || 'それ'}を${placeLabel(state, p.into)}の上に片付けた`, tone: kind === 'item' ? 'good' : 'info' };
    }
    case 'toy_merged': {
      const a = label(state, p.a, 'おもちゃ');
      const b = label(state, p.b, 'おもちゃ');
      return { text: `${a} × ${b} → ${name || '新しいおもちゃ'}ができた！`, tone: 'good' };
    }
    case 'recipe_ng':
      return { text: `${label(state, p.a, 'それ')}は${name || 'そこ'}には使えない`, tone: 'info' };
    case 'bored': {
      const sec = p.until != null ? Math.max(0, Math.round(p.until - state.elapsed)) : null;
      return { text: `${name || 'おもちゃ'}に飽きた${sec != null ? `（${sec}秒）` : ''}`, tone: 'info' };
    }
    case 'unbored':
      return { text: `${name || 'おもちゃ'}にまた興味が出た`, tone: 'info' };
    case 'drop':
      if (p.reason === 'takeaway') return null; // takeaway 側で出す
      if (p.reason === 'pickup') return null;   // 抱き上げで口の物が落ちた（§11.1）。pickup 側で出す
      return { text: `${name || 'おもちゃ'}を手放した`, tone: 'info' };
    case 'no_toy':
      return p.active ? { text: '遊べるおもちゃがない。退屈している', tone: 'bad' } : null;
    case 'pickup':
      return { text: `抱き上げられた（満足度 ${signed(p.amount ?? 0)}）`, tone: 'bad' };
    case 'takeaway':
      if (p.mouth) return { text: `${mouthName(findObject(state, p.toyId))}を取り上げた（満足度 ${signed(p.amount ?? 0)}）。ぐずる`, tone: 'bad' };
      return { text: `${label(state, p.toyId, 'おもちゃ')}を取り上げられた（満足度 ${signed(p.amount ?? 0)}）`, tone: 'bad' };
    case 'fuss_start':
      return { text: 'ぐずっている。危険なものに向かいやすい', tone: 'bad' };
    case 'respawn':
      return { text: `${name || 'あぶないもの'}がまた出てきた`, tone: 'bad' };
    // ---- ソファ登り（§10.1）----
    case 'climb_start':
      return { text: `${name || '家具'}に登った。ごきげん`, tone: 'info' };
    case 'climb_end':
      return { text: `${name || '家具'}から降りた`, tone: 'info' };
    case 'climb_fall_safe':
      return { text: `${name || '家具'}から落ちたが、${obj && obj.fix ? obj.fix : 'マット'}の上で無事`, tone: 'good' };
    // ---- 訪問者（§10.2）----
    case 'visitor_enter':
      return { text: `${visitorLabel(state, effect.objectId)}が入ってきた`, tone: 'info' };
    case 'visitor_drop':
      return { text: `${visitorLabel(state, p.visitorId)}が${name || 'なにか'}を床に落とした`, tone: 'bad' };
    case 'visitor_leave':
      if (visitorType(state, effect.objectId) === 'cat') return { text: `${visitorLabel(state, effect.objectId, 'ねこ')}は出て行った`, tone: 'info' };
      return { text: `${visitorLabel(state, effect.objectId)}は気にせず出て行った`, tone: 'info' };
    // ---- 誤飲の猶予（§11.1, §11.4）----
    case 'mouth_start':
      return { text: `${mouthName(obj)}を口に入れそう！`, tone: 'bad' };
    case 'mouth_release':
      return { text: `${mouthName(obj)}を手放した。危なかった`, tone: 'info' };
    // ---- 高い場所の容量（§11.2）----
    case 'high_full':
      return { text: `${placeLabel(state, p.into)}はもう置けない（${p.capacity ?? '?'}個まで）`, tone: 'info' };
    // ---- 猫（§11.5）----
    case 'cat_take':
      return { text: `${visitorLabel(state, p.visitorId, 'ねこ')}が${name || 'なにか'}をくわえた`, tone: 'bad' };
    case 'cat_drop':
      return { text: `${visitorLabel(state, p.visitorId, 'ねこ')}が${name || 'なにか'}を赤ちゃんのそばに置いた`, tone: 'bad' };
    // ---- ステージ3（§12）----
    case 'activate':
      return { text: `${name || 'それ'}が熱くなった！`, tone: 'bad' };
    case 'zone_enter':
      return { text: `赤ちゃんが${name || '危ないところ'}に入った`, tone: 'bad' };
    case 'placement_warn':
      if (p.active) return { text: `${p.label || 'それ'}：踏み台になっている！`, tone: 'bad' };
      return { text: `${label(state, p.moverId)}を${name || 'そこ'}から離した`, tone: 'good' };
    case 'sibling_busy':
      return { text: `${visitorLabel(state, p.visitorId, 'お兄ちゃん')}に${name || 'おもちゃ'}を渡した`, tone: 'good' };
    case 'sibling_free':
      return { text: `${visitorLabel(state, p.visitorId, 'お兄ちゃん')}が${name || 'おもちゃ'}に飽きた`, tone: 'bad' };
    case 'stage_clear':
      return { text: 'クリア！', tone: 'good' };
    case 'stage_fail':
      return { text: 'ヒヤリ3回で失敗', tone: 'bad' };
    default:
      return null;
  }
}

export const LOG_MAX = 200;

// effects を state.log に追記する（describeEvent が null のものは無視）。from 以降の要素だけを見る
export function appendLog(state, effects, from = 0) {
  for (let i = from; i < effects.length; i++) {
    const d = describeEvent(effects[i], state);
    if (!d) continue;
    state.log.push({ t: state.elapsed, kind: effects[i].type, text: d.text, tone: d.tone });
  }
  if (state.log.length > LOG_MAX) state.log.splice(0, state.log.length - LOG_MAX);
  return effects.length;
}
