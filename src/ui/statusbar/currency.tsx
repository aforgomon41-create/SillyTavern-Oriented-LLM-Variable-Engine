/**
 * Built-in currency icons. Currency names are decided by the model per world, so they are matched
 * by keyword (simplified / traditional Chinese, English, symbols); unknown names get a generic coin.
 * Coins and notes keep their material colours in every skin (they are illustrations, not UI chrome).
 */
import * as React from 'react';

export type CurrencyKind = 'gold' | 'silver' | 'copper' | 'wen' | 'liang' | 'usd' | 'cny' | 'jpy' | 'lingshi' | 'coin';
const RULES: [CurrencyKind, RegExp][] = [
  // 修仙: spirit stones, graded 下品 / 中品 / 上品 / 极品 (checked first: 「灵石」 never means a coin)
  ['lingshi', /灵石|靈石|灵晶|靈晶|仙石|元石|spirit ?stones?/iu],
  ['liang', /银两|銀兩|两银|兩銀|白银|白銀|碎银|碎銀|银子|銀子|银锭|銀錠|元宝|元寶|sycee|tael/iu],
  ['usd', /美元|美金|美刀|usd|dollar|\$/iu],
  ['jpy', /日元|日圓|日币|日幣|円|jpy|yen/iu],
  ['gold', /金币|金幣|金元|金子|金锭|金錠|金块|金塊|gold|\bgp\b/iu],
  ['silver', /银币|銀幣|银元|銀元|silver|\bsp\b/iu],
  ['copper', /铜币|銅幣|铜板|銅板|铜元|銅元|copper|\bcp\b/iu],
  ['wen', /^文$|铜钱|銅錢|文钱|文錢|通宝|通寶|制钱|制錢/u],
  ['cny', /人民币|人民幣|rmb|cny|元|块钱|塊錢/iu],
];
export function currencyKind(name: string): CurrencyKind {
  return RULES.find(([, re]) => re.test(name))?.[0] ?? 'coin';
}

const METAL: Record<'gold' | 'silver' | 'copper' | 'wen' | 'coin', [string, string, string]> = {
  // light, base, rim
  gold: ['#fff1a8', '#e2b42c', '#9a6d0b'],
  silver: ['#ffffff', '#c3cad3', '#76808c'],
  copper: ['#f6c59d', '#c67a45', '#7e4220'],
  wen: ['#e9cf8a', '#b08a3e', '#6b4f1c'],
  coin: ['#f2e3b8', '#c9a75a', '#80652a'],
};
const NOTE: Record<'usd' | 'cny' | 'jpy', [string, string, string]> = {
  usd: ['#5f9e6e', '#2f6b45', '$'],
  cny: ['#d9574b', '#9c2b22', '¥'],
  jpy: ['#9a8a6a', '#5c4f36', '円'],
};

/** Spirit-stone grade → crystal colours (light, base, deep, glow); the usual 修仙 reading: 下品 jade, 中品 azure, 上品 violet, 极品 gold. */
const LINGSHI: Record<'low' | 'mid' | 'high' | 'top', [string, string, string, string]> = {
  low: ['#e6fff1', '#5fcf94', '#1f7a4f', '#7dffb8'],
  mid: ['#e6f9ff', '#4fb8e6', '#1b5f8f', '#7fe0ff'],
  high: ['#f3eaff', '#9b7be8', '#4b2f99', '#c9a8ff'],
  top: ['#fffbe6', '#f0c94a', '#9a6b0b', '#ffe58a'],
};
export function lingshiGrade(name: string): keyof typeof LINGSHI {
  return /极品|極品|仙品|top/iu.test(name) ? 'top' : /上品|high/iu.test(name) ? 'high' : /中品|mid/iu.test(name) ? 'mid' : 'low';
}

export function CurrencyIcon({ name, size = 20 }: { name: string; size?: number }) {
  const kind = currencyKind(name), id = React.useId().replace(/:/gu, '');
  const common = { width: size, height: size, viewBox: '0 0 20 20', 'aria-hidden': true, 'data-solve': 'currency-icon', 'data-kind': kind } as const;
  if (kind === 'usd' || kind === 'cny' || kind === 'jpy') {
    const [light, dark, mark] = NOTE[kind];
    return (
      <svg {...common}>
        <rect x="1" y="4.5" width="18" height="11" rx="1.6" fill={light} stroke={dark} strokeWidth="1" />
        <rect x="2.8" y="6.2" width="14.4" height="7.6" rx=".8" fill="none" stroke="#ffffff" strokeOpacity=".55" strokeWidth=".7" />
        <circle cx="10" cy="10" r="3.3" fill={dark} fillOpacity=".25" />
        <text x="10" y="12.6" textAnchor="middle" fontSize={kind === 'jpy' ? 6.4 : 7.4} fontWeight="700" fill="#ffffff" fontFamily="system-ui, sans-serif">{mark}</text>
      </svg>
    );
  }
  if (kind === 'lingshi') {
    // spirit stone: an elongated faceted crystal with an inner glow and a glint
    const grade = lingshiGrade(name), [light, base, deep, glow] = LINGSHI[grade];
    return (
      <svg {...common} data-grade={grade}>
        <defs>
          <radialGradient id={`${id}g`} cx=".5" cy=".5" r=".5"><stop offset="0" stopColor={glow} stopOpacity=".55" /><stop offset="1" stopColor={glow} stopOpacity="0" /></radialGradient>
          <linearGradient id={`${id}l`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={light} /><stop offset="1" stopColor={base} /></linearGradient>
          <linearGradient id={`${id}r`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={base} /><stop offset="1" stopColor={deep} /></linearGradient>
        </defs>
        <circle cx="10" cy="10.2" r="9.6" fill={`url(#${id}g)`} />
        <path d="M10 1.4 15 5.4v9.2l-5 4-5-4V5.4z" fill={`url(#${id}r)`} stroke={deep} strokeWidth=".8" strokeLinejoin="round" />
        <path d="M10 1.4 5 5.4v9.2l5 4z" fill={`url(#${id}l)`} />
        <path d="M10 4.2 12.6 6.3v7.2L10 15.7 7.4 13.5V6.3z" fill={light} fillOpacity=".38" />
        <path d="M5 5.4 10 7.4l5-2M10 7.4v11.2" fill="none" stroke={deep} strokeOpacity=".45" strokeWidth=".6" strokeLinejoin="round" />
        <path d="M7.4 6.2 9.2 5" stroke="#ffffff" strokeWidth=".9" strokeLinecap="round" strokeOpacity=".9" />
        <path d="M16.2 2.2l.45 1.15 1.15.45-1.15.45-.45 1.15-.45-1.15-1.15-.45 1.15-.45z" fill="#ffffff" />
      </svg>
    );
  }
  if (kind === 'liang') {
    // silver ingot (sycee): boat-shaped base with a domed centre
    return (
      <svg {...common}>
        <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffffff" /><stop offset="1" stopColor="#a9b1bb" /></linearGradient></defs>
        <path d="M1.2 9.2c1.6.4 2.6 1.3 3.4 2.4h10.8c.8-1.1 1.8-2 3.4-2.4-.3 3.9-3.6 6.6-8.8 6.6S1.5 13.1 1.2 9.2z" fill={`url(#${id})`} stroke="#6f7884" strokeWidth=".9" strokeLinejoin="round" />
        <ellipse cx="10" cy="10.6" rx="3.6" ry="3.4" fill={`url(#${id})`} stroke="#6f7884" strokeWidth=".9" />
        <path d="M8.2 9.3c.6-.6 1.4-.8 2.3-.6" stroke="#ffffff" strokeWidth=".8" fill="none" strokeLinecap="round" />
      </svg>
    );
  }
  const [light, base, rim] = METAL[kind];
  return (
    <svg {...common}>
      <defs><radialGradient id={id} cx=".35" cy=".3" r=".8"><stop offset="0" stopColor={light} /><stop offset=".6" stopColor={base} /><stop offset="1" stopColor={rim} /></radialGradient></defs>
      {kind === 'wen' ? (
        // square-holed cash coin
        <>
          <path fillRule="evenodd" d="M10 1.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17zM7.6 7.6v4.8h4.8V7.6z" fill={`url(#${id})`} stroke={rim} strokeWidth=".9" />
          <rect x="6.6" y="6.6" width="6.8" height="6.8" fill="none" stroke={rim} strokeWidth=".7" />
          <circle cx="10" cy="10" r="6.9" fill="none" stroke={rim} strokeOpacity=".6" strokeWidth=".6" />
        </>
      ) : (
        <>
          <circle cx="10" cy="10" r="8.5" fill={`url(#${id})`} stroke={rim} strokeWidth=".9" />
          <circle cx="10" cy="10" r="6.2" fill="none" stroke={rim} strokeOpacity=".55" strokeWidth=".7" strokeDasharray={kind === 'coin' ? undefined : '1.2 .9'} />
          {kind === 'coin' ? <text x="10" y="12.8" textAnchor="middle" fontSize="7.5" fontWeight="700" fill={rim}>{[...name][0]}</text>
            : <path d="M10 6.6l1 2.1 2.3.3-1.7 1.6.4 2.3-2-1.1-2 1.1.4-2.3-1.7-1.6 2.3-.3z" fill={rim} fillOpacity=".55" />}
        </>
      )}
    </svg>
  );
}

/** Money list: icon, name, amount (or a natural-language description). */
export function CurrencyList({ entries, label }: { entries: [string, unknown][]; label?: string }) {
  return (
    <ul data-solve="currency" aria-label={label}>
      {entries.map(([name, amount]) => (
        <li key={name} data-text={typeof amount === 'number' ? undefined : ''}>
          <CurrencyIcon name={name} />
          <span data-solve-part="name">{name}</span>
          {typeof amount === 'number' ? <b data-solve-part="amount">{amount.toLocaleString('zh-CN')}</b> : <span data-solve-part="text">{String(amount)}</span>}
        </li>
      ))}
    </ul>
  );
}
