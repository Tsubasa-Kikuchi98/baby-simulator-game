// 教育カードと豆知識（§8）。文言・出典は仕様書のものをそのまま使う。実装者は追加・変更しない。

export const DISCLAIMER = '公的資料の要約であり、すべての危険を網羅するものではありません';

export const cards = {
  battery: {
    id: 'battery',
    title: 'ボタン電池は「短時間」が勝負',
    body: 'ボタン電池の誤飲事故は生後6か月〜2歳に多く起きています。飲み込むと電気分解でアルカリが生じて消化管を傷つけ、コイン形リチウム電池では30分〜2時間ほどで潰瘍ができると報告されています。電池を使う製品ごと、手の届かない場所へ。',
    source: '出典：日本中毒情報センター「ボタン電池による小児の事故」／製品評価技術基盤機構（NITE）「電池の誤飲」／国民生活センター 報道発表 2024年7月31日'
  },
  burn: {
    id: 'burn',
    title: 'やけどの多くは「つかまり立ち」と「コード」から',
    body: '医療機関から消費者庁に寄せられた情報では、2020年12月までの約10年間に、炊飯器や電気ケトルなどによる2歳以下のやけど事故が333件ありました。ケトルのコードを引っ張って倒す、炊飯器につかまり立ちして転倒するといった事例が報告されています。転倒時に湯がこぼれにくい製品を選び、コードごと手の届かない場所へ。',
    source: '出典：政府広報オンライン「乳幼児のやけど事故にご注意を！」／こども家庭庁「こどもを事故から守る！事故防止ハンドブック」／消費者庁 子ども安全メール Vol.645（2024年2月7日）'
  },
  combo: {
    id: 'combo',
    title: '「カバーをしたから安心」ではない',
    body: 'ヘアピンや鍵など、身近な金属をコンセントに差し込んで感電・やけどをした事故が医療機関から報告されています（約6年間で約30件）。件数はやけどや誤飲より少ないものの、家庭用の100Vでも心臓に影響する恐れがあります。危険な場所を塞ぐことと、危険になり得る小物を床に置かないことは、別々の対策です。',
    source: '出典：消費者庁 子ども安全メール Vol.568（2021年10月18日）／日本経済新聞 2017年4月3日（消費者庁への取材）'
  },
  summary: {
    id: 'summary',
    title: '今日できるチェックリスト',
    bullets: [
      'コンセントにカバー、床に金属の小物を置かない',
      '電気ケトル・炊飯器はコードごと手の届かない場所へ',
      'ボタン電池を使う製品はフタが開かないか確認',
      '洗剤・化粧品は高い棚へ',
      '遊べるおもちゃがある部屋は、危険への探索が減ります'
    ],
    body: 'このゲームは、起きて動いている赤ちゃんの事故だけを扱っています。睡眠中の事故については、こども家庭庁の事故防止ハンドブックを参照してください。',
    source: ''
  }
};

// 豆知識。verified:false のものは出典確認が済むまで表示しない（pickTip が除外し、warnUnverifiedTips が警告する）。
export const tips = [
  { id: 'tip_crawl_age', text: 'ハイハイを始める時期は個人差が大きく、生後7〜10か月ごろが多いとされます。この時期から行動範囲が急に広がります。', source: '厚生労働省 乳幼児身体発育調査（ハイハイの通過率）', verified: false },
  { id: 'tip_battery_age', text: 'ボタン電池の誤飲は生後6か月〜2歳に多く、2歳を過ぎると「鼻に入れる」事故の方が増えます。', source: '日本中毒情報センター「ボタン電池による小児の事故」', verified: true },
  { id: 'tip_battery_time', text: 'コイン形リチウム電池は、飲み込んでから30分〜2時間ほどで消化管に潰瘍を作ると報告されています。', source: '製品評価技術基盤機構（NITE）「電池の誤飲」', verified: true },
  { id: 'tip_battery_package', text: '2018年に国内の電池業界で、誤飲防止パッケージが採用されています。古い電池の保管にも注意。', source: '国民生活センター 報道発表 2024年7月31日', verified: true },
  { id: 'tip_kettle_lock', text: '転倒時に湯がこぼれにくい電気ケトルでも、ロックをかけていないと湯がこぼれた事例が報告されています。', source: '消費者庁 子ども安全メール Vol.645（2024年2月7日）', verified: true },
  { id: 'tip_kettle_floor', text: '電気ケトルを床に直接置く習慣は、こどもが触れて転倒させる事故の背景として挙げられています。', source: '消費者庁 コラム Vol.11「転倒時に湯漏れしにくい電気ケトルの使用を!」', verified: true },
  { id: 'tip_outlet_metal', text: 'コンセントの感電事故で差し込まれた物は、ヘアピン・鍵・クリップなど身近な金属が多いと報告されています。', source: '消費者庁 子ども安全メール Vol.568（2021年10月18日）／日本経済新聞 2017年4月3日', verified: true },
  { id: 'tip_outlet_wet', text: '唾液や汗で濡れた手は電気を通しやすく、こどもがコンセントに触れる危険を高めます。', source: '消費者庁 子ども安全メール Vol.568', verified: true },
  { id: 'tip_skin', text: 'こどもの皮膚は大人より薄く、同じ温度の湯でも深いやけどになりやすいとされています。', source: '消費者庁 子ども安全メール Vol.645', verified: true },
  { id: 'tip_home', text: '交通事故を除くと、こどもの事故の発生場所は家庭内がほとんどを占めます。', source: '消費者庁「子どもの不慮の事故の発生傾向」（2022年3月23日、人口動態調査より）', verified: true },
  { id: 'tip_habituation', text: '乳児は同じ刺激に繰り返し触れると反応が弱まり（馴化）、新しい刺激には注意が戻ります。同じおもちゃに飽きるのはこの性質です。', source: '発達心理学の一般的知見（馴化・脱馴化パラダイム）', verified: false },
  { id: 'tip_object_permanence', text: '生後8〜9か月ごろから「見えなくなった物もそこにある」と理解し始め、物を取り上げられることへの抗議が強くなるとされます。', source: '発達心理学の一般的知見（対象の永続性）', verified: false },
  { id: 'tip_environment', text: '事故予防の資料では、「見守り」より「環境を変える」対策（ゲート・ロック・配置の変更）が優先して勧められています。', source: 'こども家庭庁「こどもを事故から守る！事故防止ハンドブック」', verified: true }
];

// verified:false の豆知識を列挙する（ビルド時・起動時の警告に使う）
export function unverifiedTips() {
  return tips.filter(t => !t.verified);
}

// 表示可能（verified:true）な豆知識から、shownIds に無いものを rng で 1 件選ぶ。
// 全部出し切っていたら shownIds をリセットして選び直す。shownIds は呼び出し側が保持・更新する。
export function pickTip(rng, shownIds) {
  const pool = tips.filter(t => t.verified);
  let candidates = pool.filter(t => !shownIds.includes(t.id));
  if (candidates.length === 0) {
    shownIds.length = 0;
    candidates = pool;
  }
  const picked = candidates[Math.floor(rng() * candidates.length)];
  shownIds.push(picked.id);
  return picked;
}
