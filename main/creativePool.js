'use strict';

/*
 * creativePool.js — Auto Pomodoro 하우스 광고 소재 풀.
 *
 * 전략 원본(SSOT): ../AD_STRATEGY.md 1·7절 (미스터 비스트).
 * 게이트: ./adGate.js — nextCreative(pool) 는 이 풀의 id 배열을 받는다.
 *
 * 데스크톱(Electron)은 외부 광고 네트워크가 없다(AD_STRATEGY 3절) → 전부 house_*.
 * network 소재(c6)는 iOS PomodoroCage 전용이라 이 풀에는 포함하지 않는다.
 *
 * house 소재는 copy[locale] + image 로 앱이 자체 렌더한다(외부 SDK 안 씀).
 * 사람이 확정할 값은 TODO(사람) 표시 — AD_STRATEGY.md 8절.
 */

/** @typedef {'house_cross_promo'|'house_subscription'|'network'} CreativeKind */

const CREATIVE_POOL = [
  {
    id: 'c1_xpromo_everytime',
    kind: 'house_cross_promo',
    weight: 3,
    slotAffinity: [1, 3],
    platforms: ['mac', 'win'],
    copy: {
      ko: '공부 시간표는 챙기는데 수업은 자꾸 놓치죠. 수업 시작 전에 대신 울려주는 앱.',
      en: 'You track your study blocks but still miss class. An app that nudges you before each one starts.',
      ja: '勉強の時間割は組むのに、授業はつい忘れる。開始前に代わりに知らせてくれるアプリ。',
    },
    cta: { ko: '수업 알리미 열기', en: 'Get it', ja: 'アプリを見る' },
    link: 'https://apps.apple.com/kr/app/everytime-reminder/id6774095537',
    image: 'assets/ads/c1_everytime.svg',
  },
  {
    id: 'c2_xpromo_risesync',
    kind: 'house_cross_promo',
    weight: 2,
    slotAffinity: [1, 3],
    platforms: ['mac', 'win'],
    copy: {
      ko: '집중은 일단 일어나야 시작돼요. 억지로라도 깨우는 알람.',
      en: "Focus can't start until you're up. An alarm that actually gets you out of bed.",
      ja: '集中はまず起きてから。無理やりにでも起こすアラーム。',
    },
    cta: { ko: 'RiseSync 보기', en: 'See RiseSync', ja: 'RiseSync を見る' },
    // TODO(사람): RiseSync 스토어 링크 확정 (AD_STRATEGY.md 8절 #2).
    link: 'https://apps.apple.com/app/idRISESYNC_TBD',
    image: 'assets/ads/c2_risesync.svg',
  },
  {
    id: 'c3_sub_irony',
    kind: 'house_subscription',
    weight: 3,
    slotAffinity: [2],
    platforms: ['mac', 'win'],
    copy: {
      ko: '집중 앱에 광고가 거슬리죠. 월 1,200원이면 광고 없이, 조용하게.',
      en: 'Ads in a focus app? Ironic. Go ad-free for about a coffee-sip a month.',
      ja: '集中アプリに広告は邪魔。月120円ほどで広告なし・静かに。',
    },
    cta: { ko: '광고 없애기', en: 'Remove ads', ja: '広告を消す' },
    link: 'app://subscribe',
    image: 'assets/ads/c3_adfree.svg',
  },
  {
    id: 'c4_sub_support',
    kind: 'house_subscription',
    weight: 3,
    slotAffinity: [2],
    platforms: ['mac', 'win'],
    copy: {
      ko: '1인 개발자가 만든 앱이에요. 월 1,200원 구독이 다음 업데이트를 만듭니다.',
      en: 'Built by one developer. Your ~$1/mo keeps the updates coming — and hides the ads.',
      ja: '個人開発のアプリです。月120円ほどの支援が次のアップデートになります。',
    },
    cta: { ko: '구독하고 광고 끄기', en: 'Subscribe & hide ads', ja: '支援して広告オフ' },
    link: 'app://subscribe',
    image: 'assets/ads/c4_support.svg',
  },
  {
    id: 'c5_xpromo_blocker',
    kind: 'house_cross_promo',
    weight: 2,
    slotAffinity: [1, 3],
    platforms: ['mac', 'win'],
    copy: {
      ko: '타이머가 끝나도 유튜브로 샜다면. 쉬는 시간엔 유혹도 같이 잠가요.',
      en: 'Timer ends, and you fall into YouTube anyway? Lock the temptation during breaks too.',
      ja: 'タイマーが終わってもつい動画へ。休憩中は誘惑もロック。',
    },
    cta: { ko: '차단 앱 보기', en: 'See the blocker', ja: 'ブロッカーを見る' },
    // TODO(사람): 4VPN Blocker 스토어 링크 확정 (AD_STRATEGY.md 8절 #2).
    link: 'https://apps.apple.com/app/id4VPNBLOCKER_TBD',
    image: 'assets/ads/c5_blocker.svg',
  },
];

/** AD_STRATEGY.md 4절: 13:00–14:00→1, 14:00–15:30→2, 15:30–17:00→3. */
function slotForNow(now = new Date()) {
  const h = now.getHours() + now.getMinutes() / 60;
  if (h < 14) return 1;
  if (h < 15.5) return 2;
  return 3;
}

function platformKey() {
  if (process.platform === 'darwin') return 'mac';
  if (process.platform === 'win32') return 'win';
  return 'linux';
}

/** slot / platform / 기간(startDate~endDate) / weight 로 후보를 거른 id 배열. */
function eligibleIds(pool, { slot, platform, now = new Date() }) {
  return pool
    .filter((c) => {
      if ((c.weight || 0) <= 0) return false;
      if (Array.isArray(c.platforms) && c.platforms.length && !c.platforms.includes(platform)) return false;
      if (Array.isArray(c.slotAffinity) && c.slotAffinity.length && !c.slotAffinity.includes(slot)) return false;
      if (c.startDate && now < new Date(c.startDate)) return false;
      if (c.endDate && now >= new Date(c.endDate)) return false;
      return true;
    })
    .map((c) => c.id);
}

function byId(pool, id) {
  return pool.find((c) => c.id === id) || null;
}

function copyFor(creative, locale) {
  if (!creative || !creative.copy) return null;
  return creative.copy[locale] || creative.copy.en || Object.values(creative.copy)[0] || null;
}

module.exports = {
  CREATIVE_POOL,
  slotForNow,
  platformKey,
  eligibleIds,
  byId,
  copyFor,
};
