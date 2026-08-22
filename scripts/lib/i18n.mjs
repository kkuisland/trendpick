// 다국어(ko/en) 문자열·날짜·로케일 설정
import { formatKoDate, formatKoRange } from './util.mjs';

const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const STRINGS = {
  ko: {
    home: '홈',
    latest: '최신 글',
    calendar: '이벤트 캘린더',
    upcomingEvents: '다가오는 이벤트',
    related: '함께 보면 좋은 글',
    toc: '목차',
    faq: '자주 묻는 질문',
    breadcrumbAria: '현재 위치',
    empty: '아직 발행된 글이 없습니다.',
    emptyCategory: '아직 이 카테고리에 글이 없습니다.',
    readingSuffix: '분 읽기',
    readingLong: '분 읽기',
    updated: '업데이트',
    heroBadge: '매일 업데이트되는 트렌드 브리핑',
    calendarTitle: '이벤트 캘린더',
    calendarHeading: '이벤트 캘린더',
    calendarSub: '다가오는 빅 이벤트를 미리 확인하고 준비하세요. 매일 D-Day가 자동으로 갱신됩니다.',
    calendarMore: '캘린더 →',
    tentative: '일정 미확정',
    notFound: '페이지를 찾을 수 없습니다. 주소가 바뀌었거나 삭제된 페이지예요.',
    notFoundTitle: '페이지를 찾을 수 없습니다',
    goHome: '홈으로 가기',
    about: '소개',
    privacy: '개인정보처리방침',
    contact: '문의',
    copyright: '저작권 안내',
    support: '후원하기',
    footerNote:
      '본 사이트의 콘텐츠는 정보 제공을 목적으로 하며, 투자·법률·의료 등 전문적 판단의 근거로 사용될 수 없습니다. 일정과 제도는 변경될 수 있으니 반드시 공식 발표를 함께 확인해 주세요.',
    moneyDisclaimer:
      '이 글은 일반적인 정보 제공을 위한 것으로, 특정 상품의 매수·매도 추천이나 투자 자문이 아닙니다. 투자의 책임은 투자자 본인에게 있습니다.',
    langSwitch: 'English',
    langSwitchAria: 'View in English',
  },
  en: {
    home: 'Home',
    latest: 'Latest',
    calendar: 'Korea Calendar',
    upcomingEvents: 'Upcoming in Korea',
    related: 'Related reading',
    toc: 'Contents',
    faq: 'Frequently asked questions',
    breadcrumbAria: 'Breadcrumb',
    empty: 'No posts published yet.',
    emptyCategory: 'No posts in this category yet.',
    readingSuffix: ' min read',
    readingLong: ' min read',
    updated: 'Updated',
    heroBadge: 'Korea explained, updated daily',
    calendarTitle: 'Korea Event Calendar',
    calendarHeading: 'Korea Event Calendar',
    calendarSub:
      'Holidays, sporting events and product launches in Korea — with a live countdown updated every day.',
    calendarMore: 'Calendar →',
    tentative: 'date not confirmed',
    notFound: 'We could not find that page. It may have moved or been removed.',
    notFoundTitle: 'Page not found',
    goHome: 'Go to homepage',
    about: 'About',
    privacy: 'Privacy Policy',
    contact: 'Contact',
    copyright: 'Copyright',
    support: 'Support',
    footerNote:
      'Content on this site is for general information only and is not professional financial, legal or medical advice. Dates and regulations can change — always confirm with the official announcement.',
    moneyDisclaimer:
      'This article is general information only and is not investment advice or a recommendation to buy or sell any security.',
    langSwitch: '한국어',
    langSwitchAria: '한국어로 보기',
  },
};

/** 로케일별 날짜 표기 */
export function formatDate(dateStr, locale = 'ko', { weekday = false, year = true } = {}) {
  if (!dateStr) return '';
  if (locale !== 'en') return formatKoDate(dateStr, { weekday, year });
  const [y, m, d] = dateStr.split('-').map(Number);
  let s = `${MONTHS_EN[m - 1]} ${d}`;
  if (year) s += `, ${y}`;
  if (weekday) {
    const dow = new Date(dateStr + 'T00:00:00Z').getUTCDay();
    s = `${DAY_EN[dow]}, ${s}`;
  }
  return s;
}

export function formatRange(start, end, locale = 'ko') {
  if (locale !== 'en') return formatKoRange(start, end);
  if (!end || end === start) return formatDate(start, 'en', { weekday: true });
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  return `${formatDate(start, 'en')} – ${formatDate(end, 'en', { year: !sameYear })}`;
}

/**
 * 로케일별 config 뷰를 만든다.
 * en 로케일은 config.i18n.en 의 site/categories 로 치환하고 /en 경로 접두사를 갖는다.
 */
export function localizedConfig(config, code) {
  const i18n = config.i18n || {};
  const override = code === 'ko' ? null : i18n[code];
  const site = override?.site ? { ...config.site, ...override.site } : { ...config.site };
  const categories = override?.categories || config.categories;
  const prefix = code === 'ko' ? '' : `/${code}`;
  return {
    ...config,
    site,
    categories,
    locale: {
      code,
      lang: code,
      prefix,
      ogLocale: code === 'en' ? 'en_US' : 'ko_KR',
      t: STRINGS[code] || STRINGS.ko,
      // 로케일별 콘텐츠 디렉터리 (ko 는 기존 경로 유지)
      contentDir: code === 'ko' ? ['content', 'posts'] : ['content', code, 'posts'],
      pagesDir: code === 'ko' ? ['content', 'pages'] : ['content', code, 'pages'],
    },
  };
}

/** 활성화된 로케일 코드 목록 (ko 는 항상 첫 번째) */
export function localeCodes(config) {
  const extra = Object.keys(config.i18n || {}).filter((k) => k !== 'ko');
  return ['ko', ...extra];
}
