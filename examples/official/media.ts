/**
 * Media for the example world, all hot-linked from the web (nothing is bundled):
 *   · images: いらすとや（https://www.irasutoya.com/, みふねたかし）— one consistent cute style. Free to use under
 *             its terms (https://www.irasutoya.com/p/terms.html); a commercial product may use at most 20 of them.
 *   · music:  Kevin MacLeod (incompetech.com), licensed under Creative Commons: By Attribution 4.0
 *             (https://creativecommons.org/licenses/by/4.0/). Attribution is shown with the preview.
 * The sources can change or go away; the UI falls back to monograms / silence when they do.
 */
import type { BgmTrack } from '../../src/types.js';

export interface ImageCredit { url: string; title: string; artist: string; license: string; source: string }
export const IMAGES = {
  capital: { url: "https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEgvC_a-um4CNxuFhfmzQxUwmTUsb6thSXjGLvwT0re3cScYV1Nqnq4RnjVuVBzISic4aeoksgln8c8CgbUvLF8pLb5gbQilOcG9N9z6O9yIaA0HykFTGsCtWvuQzOGjQJ9MHdFa3L1JKO9T/s800/bg_machi_seiyou.jpg", title: "西洋家屋のイラスト（背景素材）", artist: 'みふねたかし（いらすとや）', license: 'いらすとや利用規約', source: "https://www.irasutoya.com/2017/06/blog-post_557.html" },
  tavern: { url: "https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEhdK9yS6y7_5H5Mc2kdlS3ENSMBkuJxTGMRhKzsTVY9X0n9jcHsKo4K6dsoZlm1m1D8uWqG71yVHe_YbQp3TbBoXZyjKqliPYr1bOkkBvAc47zo8EO9tXCZdhfR6_dR4F3HvXvLJHple9y6/s800/kura_sakagura.png", title: "酒蔵・酒樽のイラスト", artist: 'みふねたかし（いらすとや）', license: 'いらすとや利用規約', source: "https://www.irasutoya.com/2013/06/blog-post_8215.html" },
  palace: { url: "https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEhV4ne6RBTSMIGPg5fEAfMUOGNEyYozuwOxpdgpE2TTZ5lO5kaTGqwz0ADUEP63KBqu-kgBiLqt311KaNbyRFGiW1GbxTfmCQ-SkhQX8X6MRriZA-YDC6iTOym9I6O7ThW_4gL5fQmBsZs/s800/castle.png", title: "お城・キャッスルのイラスト（西洋）", artist: 'みふねたかし（いらすとや）', license: 'いらすとや利用規約', source: "https://www.irasutoya.com/2013/04/blog-post_4581.html" },
  lower_town: { url: "https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEhv6SL9k6cgUxnPweciVeYghiDTx7CzuDaxbPoaiSqXHD0y1BZL1b-EpJZOMGrpm4nmLjxoNbvRyf19ED0ZI0OMQJS9ybUXwU3bs_bjaexBN46aFFA7yENqGb6N31Bzib9A1iOtw-F-v68/s800/building_boroya.png", title: "ボロボロの家・ボロ屋のイラスト", artist: 'みふねたかし（いらすとや）', license: 'いらすとや利用規約', source: "https://www.irasutoya.com/2013/11/blog-post_3.html" },
  warehouse: { url: "https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEhzpXi5kbyS2W5R1DE3e3wWbcMvbge1ZhtKlbCIrehI1EOLtBk8Js52Qtx5b39n3ZIS3GYHQiLlhFyARqUDbNE1T3PgwATzS8oW4DyNlbMqwfHaSmfMMbnHJ7Xs9d5iVgffvIcgvTBAYsP0/s800/building_naya_souko.png", title: "納屋のイラスト", artist: 'みふねたかし（いらすとや）', license: 'いらすとや利用規約', source: "https://www.irasutoya.com/2020/12/blog-post_353.html" },
  fog_marsh: { url: "https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEgZEWyXUpjBqMxsMpx0grR7l7Gwukgu7vQKxQEYhs047PNbXqDuukOsUi0PvGcYcEnDcScu-hAOju83JfwOvpvFYZodhtkol1p7pR5Ge3eeS-ksA3Tnm3o3qup1ruuglvb5xjX13t_4w2E/s800/ike_numa.png", title: "沼のイラスト", artist: 'みふねたかし（いらすとや）', license: 'いらすとや利用規約', source: "https://www.irasutoya.com/2018/04/blog-post_105.html" },
  marsh_hut: { url: "https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEhWyOmbFy9TaFocOWzffY45PkFIRUYGxLcMhC7ifSbyNLHQ6-WVlUZv0nfViGoHzt25dU-tVBZQUZm7KzeXZe21GDIXxvIp_mqsY_0OSwlcyHu-iXxm9kNpCb9v-zBkpFkJVtDFjd1064c/s800/building_akiya.png", title: "空き家のイラスト", artist: 'みふねたかし（いらすとや）', license: 'いらすとや利用規約', source: "https://www.irasutoya.com/2015/07/blog-post_0.html" },
  erin: { url: "https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEijiMpSsJETMRhYaPHoV8f48Tl_JVLNXI3gs7k2oBFLSzBwJctrPhLfYPMzFQM73rE0e3Hb3-X2PRPd_lRmZqvGNyaais4UBUSHpVEtl7Qa54k6ourLj0RsAzpGZvbFaD4Th9-5xo3qdBCP/s800/game_yuusya_woman.png", title: "勇者のイラスト（女性）", artist: 'みふねたかし（いらすとや）', license: 'いらすとや利用規約', source: "https://www.irasutoya.com/2016/07/blog-post_464.html" },
  mira: { url: "https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEhVDIfUs7QE62rEKdrDHKqLLCare0Ose1Hh3bOTWgXxMq5JjVUeDyz_InJM5Kv6ICKbWOs-btskxjTV4T3QdVYeWCxShtHVSkcsUbmCDbj8OvUYZCDK7gfngV6OoMZZlPA30br09XIH2B3a/s800/music_ginyuu_shijin.png", title: "吟遊詩人のイラスト", artist: 'みふねたかし（いらすとや）', license: 'いらすとや利用規約', source: "https://www.irasutoya.com/2020/01/blog-post_827.html" },
  ash: { url: "https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEgpH0Y9E9csVoeDb6SLSj5s1WR54Rl4qVsVRfheetjUFFz7u_vMf-yr92woafC9SKoOW9vyQ6_Df2EO_M4PKgub97fQFtyZH7AFJeiNZGVILoc49X2r3beLEEuSmTfbf-MY91o2cUbN4ICe/s800/fantasy_dullahan.png", title: "デュラハンのイラスト", artist: 'みふねたかし（いらすとや）', license: 'いらすとや利用規約', source: "https://www.irasutoya.com/2017/05/blog-post_90.html" },
  cassius: { url: "https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEjcgT8TL2SiRiqRsN3cGG7NNm-ldZoC_EHhaS8pp9MHQmEwvYMs88Q7ZSMJQWFaIuBghN59e6z9vPd_EBojeohXfECj5g6NIioEYZz1N-egzpq2aiHBZBBZWxVjUivSCOhZcrrf5eNxL5k/s800/knight.png", title: "ナイト・騎士のイラスト", artist: 'みふねたかし（いらすとや）', license: 'いらすとや利用規約', source: "https://www.irasutoya.com/2013/03/blog-post_19.html" },
  ember_bishop: { url: "https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEgVKbAoh602DLDmz1n8CekGya4iodnmPR5C7FAIBUWzxt-m6UCOWTW1NsB6llbnne6fdme0RGH1xFghJZuVqo_9OL1x5AO89ps_wa1iNgue1tJeaC2NCf_QRcqWSfepW2CxHr_hWtZv0MQ/s800/mahoutsukai_necromancer.png", title: "ネクロマンサーのイラスト", artist: 'みふねたかし（いらすとや）', license: 'いらすとや利用規約', source: "https://www.irasutoya.com/2017/11/blog-post_96.html" },
  grave_hound: { url: "https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEgVXwxK1lAFc-cbypF5oQlrDbxiNalR7ZUl4xI2ApjbtXC-JukFzniG0U7nQz0y5eLxifIzzlT6MIwjwjtEoeLanO7_plBr7ScOfl0rYZVLUpQj_S_EAQv37YDkkYwlaPZS6T3dUTHGPqI/s800/dog_belgian_groenendael.png", title: "ベルジアングローネンダールのイラスト（犬）", artist: 'みふねたかし（いらすとや）', license: 'いらすとや利用規約', source: "https://www.irasutoya.com/2018/05/blog-post_51.html" },
  rat_king: { url: "https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEjwprK481i5TnDiZmeMqzcxTNSnKTlhxbIJIn6BR0OIsApcqMxavgtTXtXwSkqiG_qoJn0UOyI2Jwk2xBTDpmXg8s6bHHHqO7qcLO6NdLbm-ZWOrKWerUrPKtkFf4i5Cty2O1clb4f-1nAA/s800/monogatari_kurumiwariningyou_nezumi.png", title: "ねずみの王様のイラスト（くるみ割り人形）", artist: 'みふねたかし（いらすとや）', license: 'いらすとや利用規約', source: "https://www.irasutoya.com/2020/05/blog-post_54.html" },
  cult_zealot: { url: "https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEgGnkssTEHN0FsUNg1IrVU0pVLmjiluQvW7JPSQrCTc4Ih1hg_8tOWh6l3bRjXAcvlUXOd6W9gR-fOzIjXBCD1i0g6l5dDghr9mrv3n21INrJjLS-YXR50tvcAZIHpb1RFU2rBTcvmWIVY/s800/cult_kyoudan.png", title: "怪しい儀式のイラスト", artist: 'みふねたかし（いらすとや）', license: 'いらすとや利用規約', source: "https://www.irasutoya.com/2014/07/blog-post_2394.html" },
  iron_sword: { url: "https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEj0CIWjLQY8inI-VhyvhJQN3EW21acN011cW4wMwkHF0gwoZZXzbUitCLbzo_2FrKdHBV-4gJkMVhHo_ZA1Ivp4pC-oN_8SgO_RNqDBdHEBlvqvJt5CrNJSShzbWTeU9jY5u7o6DQQjLeVH/s800/game_ken.png", title: "剣のイラスト", artist: 'みふねたかし（いらすとや）', license: 'いらすとや利用規約', source: "https://www.irasutoya.com/2015/01/blog-post_45.html" },
  round_shield: { url: "https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEhBrYnTupqv4MfMmJDj9CisiSnJ8kpzTl_QLN4unWY0HCb59PHtj3SbZL1HljP5W3JmnOkggW18gkOCTEploWJTyU20DzeoajVDkEr51DKvDmWJ0rG_lzYmjV2JDKu1xQinThIzBGn7D9Rq/s800/game_tate.png", title: "盾のイラスト", artist: 'みふねたかし（いらすとや）', license: 'いらすとや利用規約', source: "https://www.irasutoya.com/2015/01/blog-post_73.html" },
  healing_draught: { url: "https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEhScbz2ehHwS8jhHsG4LQ40jNK5Jk1XIOEQXe9rnsgnoKOw9KdjYMby59b5qcTZtcVLaCWoH4KX1QzHbKYaKMedCchWPRheKxKc4Ig1th_MyMWyZkcaMjDg0qSr2B04Fh53L08hND4Lwj7Z/s800/medical_bannouyaku.png", title: "万能薬のイラスト", artist: 'みふねたかし（いらすとや）', license: 'いらすとや利用規約', source: "https://www.irasutoya.com/2016/04/blog-post_643.html" },
  sealed_letter: { url: "https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEjW9r-WWKCJc2CBcJ45QsLIlQLeQ24ha8vTQsKJHZ5RwmPIjmxEk29V3L9RGLqCABSj-F0yz26e-47GBav5SHK2fIaW6oRz0ddP8p6NhLh5-CsWVTjWPKvu2V0pE_WMev8h9uAgDM3-nnhD/s800/envelope_fuurou.png", title: "シーリングワックスのイラスト", artist: 'みふねたかし（いらすとや）', license: 'いらすとや利用規約', source: "https://www.irasutoya.com/2019/10/blog-post_49.html" },
  grey_mare: { url: "https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEjuhnPp7V4brbjH0cJTCcgfoM08WGRmAh2RSOjjvHsgLpJPXK7B9tQKbkNDNtDtE8y31wOEnAj9mfAFGDfiN-t4pLn2i1RqQHwBmslaCLDvf_Mpoi9SuTQUqU0R9tVrutNIf0rJvrql16A/s800/animal_horse_thoroughbred_white.png", title: "サラブレッドのイラスト（芦毛）", artist: 'みふねたかし（いらすとや）', license: 'いらすとや利用規約', source: "https://www.irasutoya.com/2015/11/blog-post_255.html" },
  lute: { url: "https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEgQmo-6klc7v7Xrwbqtx1H87-qriathidhCj6FJVEtmp5xbkCyS_GkXxbTk0x5hGi5atJE3z_nU5WMJ7NWRILx-FJB88dwfI-TCJnHm6mKcb3pax9SG8v1QvAkFHo8LpW2vo6tX_sWvcFQ/s800/music_mandolin.png", title: "マンドリンのイラスト", artist: 'みふねたかし（いらすとや）', license: 'いらすとや利用規約', source: "https://www.irasutoya.com/2015/05/blog-post_30.html" },
} satisfies Record<string, ImageCredit>;

/** Square face crops (percent of the picture) for avatars, as media fragments on the thumbnail link. */
const CROPS: Partial<Record<keyof typeof IMAGES, [number, number, number, number]>> = {
  erin: [36, 2, 40, 40], mira: [30, 2, 40, 40], ash: [35, 2, 42, 41.6], cassius: [12, 2, 45, 36.2],
  ember_bishop: [18, 24, 38, 38], grave_hound: [62, 4, 36, 36], rat_king: [10, 5, 80, 80], cult_zealot: [32, 8, 40, 35.6],
};
/** Blogger serves any size: swap the size segment (`/s800/` or `=s800`) in the link. */
const sized = (url: string, width: number) => url.replace(/([/=])s\d+(\/|$)/u, `$1s${width}$2`);
/** Full picture (立绘 / scene / item photo). */
export const art = (k: keyof typeof IMAGES): string => sized(IMAGES[k].url, 800);
/** Thumbnail: a small copy, cropped to the face where a crop is known. */
export const thumb = (k: keyof typeof IMAGES): string => {
  const c = CROPS[k];
  return sized(IMAGES[k].url, 330) + (c ? `#xywh=percent:${c.join(',')}` : '');
};

const MUSIC_BASE = 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/';
/** Library: places point at a track by id; the rest are picked by scene mood. */
export const MUSIC: BgmTrack[] = [
  { id: 'minstrel_guild', title: 'Minstrel Guild · Kevin MacLeod', url: MUSIC_BASE + 'Minstrel%20Guild.mp3', moods: ["日常"] },
  { id: 'lord_of_the_land', title: 'Lord of the Land · Kevin MacLeod', url: MUSIC_BASE + 'Lord%20of%20the%20Land.mp3', moods: [] },
  { id: 'sneaky_snitch', title: 'Sneaky Snitch · Kevin MacLeod', url: MUSIC_BASE + 'Sneaky%20Snitch.mp3', moods: [] },
  { id: 'dark_fog', title: 'Dark Fog · Kevin MacLeod', url: MUSIC_BASE + 'Dark%20Fog.mp3', moods: [] },
  { id: 'village_consort', title: 'Village Consort · Kevin MacLeod', url: MUSIC_BASE + 'Village%20Consort.mp3', moods: ["日常"] },
  { id: 'volatile_reaction', title: 'Volatile Reaction · Kevin MacLeod', url: MUSIC_BASE + 'Volatile%20Reaction.mp3', moods: ["紧张"] },
  { id: 'five_armies', title: 'Five Armies · Kevin MacLeod', url: MUSIC_BASE + 'Five%20Armies.mp3', moods: ["战斗"] },
  { id: 'heartbreaking', title: 'Heartbreaking · Kevin MacLeod', url: MUSIC_BASE + 'Heartbreaking.mp3', moods: ["悲伤"] },
  { id: 'lasting_hope', title: 'Lasting Hope · Kevin MacLeod', url: MUSIC_BASE + 'Lasting%20Hope.mp3', moods: ["浪漫"] },
  { id: 'crypto', title: 'Crypto · Kevin MacLeod', url: MUSIC_BASE + 'Crypto.mp3', moods: ["神秘"] },
  { id: 'celtic_impulse', title: 'Celtic Impulse · Kevin MacLeod', url: MUSIC_BASE + 'Celtic%20Impulse.mp3', moods: ["欢快"] },
  { id: 'darkling', title: 'Darkling · Kevin MacLeod', url: MUSIC_BASE + 'Darkling.mp3', moods: ["恐怖"] },
];
export const MUSIC_CREDIT = 'Music by Kevin MacLeod (incompetech.com), licensed under Creative Commons: By Attribution 4.0 License';
