/**
 * Media for the example world, all hot-linked from the web (nothing is bundled):
 *   · images: Wikimedia Commons — public-domain paintings and CC0 museum photos (The Met Open Access);
 *   · music:  Kevin MacLeod (incompetech.com), licensed under Creative Commons: By Attribution 4.0
 *             (https://creativecommons.org/licenses/by/4.0/). Attribution is shown with the preview.
 * The sources can change or go away; the UI falls back to monograms / silence when they do.
 */
import type { BgmTrack } from '../../src/types.js';

export interface ImageCredit { url: string; title: string; artist: string; license: string; source: string }
export const IMAGES = {
  capital: { url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/1/14/Jan_van_der_Heyden_-_The_New_Town_Hall_in_Amsterdam_-_WGA11400.jpg/960px-Jan_van_der_Heyden_-_The_New_Town_Hall_in_Amsterdam_-_WGA11400.jpg', title: "Jan van der Heyden - The New Town Hall in Amsterdam - WGA11400", artist: "Jan van der Heyden", license: 'Public domain', source: 'https://commons.wikimedia.org/wiki/File:Jan_van_der_Heyden_-_The_New_Town_Hall_in_Amsterdam_-_WGA11400.jpg' },
  tavern: { url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/6/64/David_Teniers_%28II%29_-_Tavern_Scene_-_WGA22082.jpg/960px-David_Teniers_%28II%29_-_Tavern_Scene_-_WGA22082.jpg', title: "David Teniers (II) - Tavern Scene - WGA22082", artist: "David Teniers the Younger", license: 'Public domain', source: 'https://commons.wikimedia.org/wiki/File:David_Teniers_(II)_-_Tavern_Scene_-_WGA22082.jpg' },
  palace: { url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/d/db/Alexander_Nasmyth_-_A_View_of_Tantallon_Castle_-_WGA16442.jpg/960px-Alexander_Nasmyth_-_A_View_of_Tantallon_Castle_-_WGA16442.jpg', title: "Alexander Nasmyth - A View of Tantallon Castle - WGA16442", artist: "Alexander Nasmyth", license: 'Public domain', source: 'https://commons.wikimedia.org/wiki/File:Alexander_Nasmyth_-_A_View_of_Tantallon_Castle_-_WGA16442.jpg' },
  lower_town: { url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/3/3e/Gustave_Dor%C3%A9_-_Wentworth_Street_Whitechapel_-_London%2C_a_Pilgrimage.jpg/960px-Gustave_Dor%C3%A9_-_Wentworth_Street_Whitechapel_-_London%2C_a_Pilgrimage.jpg', title: "Gustave Doré - Wentworth Street Whitechapel - London, a Pilgrimage", artist: "Gustave Doré", license: 'Public domain', source: 'https://commons.wikimedia.org/wiki/File:Gustave_Dor%C3%A9_-_Wentworth_Street_Whitechapel_-_London,_a_Pilgrimage.jpg' },
  warehouse: { url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/4/48/John_Atkinson_Grimshaw_%281836-1893%29_-_Liverpool_Docks_by_Night_-_WAG_10328_-_Walker_Art_Gallery.jpg/960px-John_Atkinson_Grimshaw_%281836-1893%29_-_Liverpool_Docks_by_Night_-_WAG_10328_-_Walker_Art_Gallery.jpg', title: "John Atkinson Grimshaw (1836-1893) - Liverpool Docks by Night - WAG 10328 - Walker Art Gallery", artist: "John Atkinson Grimshaw", license: 'Public domain', source: 'https://commons.wikimedia.org/wiki/File:John_Atkinson_Grimshaw_(1836-1893)_-_Liverpool_Docks_by_Night_-_WAG_10328_-_Walker_Art_Gallery.jpg' },
  fog_marsh: { url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/1/15/Jacob_Isaacksz_van_Ruisdael_-_A_Marsh_in_a_Forest_at_Dusk_-_Google_Art_Project.jpg/960px-Jacob_Isaacksz_van_Ruisdael_-_A_Marsh_in_a_Forest_at_Dusk_-_Google_Art_Project.jpg', title: "Jacob Isaacksz van Ruisdael - A Marsh in a Forest at Dusk - Google Art Project", artist: "Jacob van Ruisdael", license: 'Public domain', source: 'https://commons.wikimedia.org/wiki/File:Jacob_Isaacksz_van_Ruisdael_-_A_Marsh_in_a_Forest_at_Dusk_-_Google_Art_Project.jpg' },
  marsh_hut: { url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/6/6d/Th%C3%A9odore_Rousseau_-_The_Farm_%28Cottage_at_the_Edge_of_a_Marsh%29_-_1955.849_-_Clark_Art_Institute.tiff/lossy-page1-960px-Th%C3%A9odore_Rousseau_-_The_Farm_%28Cottage_at_the_Edge_of_a_Marsh%29_-_1955.849_-_Clark_Art_Institute.tiff.jpg', title: "Théodore Rousseau - The Farm (Cottage at the Edge of a Marsh) - 1955.849 - Clark Art Institute.tiff", artist: "Théodore Rousseau", license: 'Public domain', source: 'https://commons.wikimedia.org/wiki/File:Th%C3%A9odore_Rousseau_-_The_Farm_(Cottage_at_the_Edge_of_a_Marsh)_-_1955.849_-_Clark_Art_Institute.tiff' },
  erin: { url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/d/d3/Dante_Gabriel_Rossetti_-_Joan_of_Arc_%281882%29.jpg/500px-Dante_Gabriel_Rossetti_-_Joan_of_Arc_%281882%29.jpg', title: "Dante Gabriel Rossetti - Joan of Arc (1882)", artist: "Dante Gabriel Rossetti", license: 'Public domain', source: 'https://commons.wikimedia.org/wiki/File:Dante_Gabriel_Rossetti_-_Joan_of_Arc_(1882).jpg' },
  mira: { url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/c/c2/Bartolomeo_Veneto_-_Woman_Playing_a_Lute_-_WGA01353.jpg/500px-Bartolomeo_Veneto_-_Woman_Playing_a_Lute_-_WGA01353.jpg', title: "Bartolomeo Veneto - Woman Playing a Lute - WGA01353", artist: "Bartolomeo Veneto", license: 'Public domain', source: 'https://commons.wikimedia.org/wiki/File:Bartolomeo_Veneto_-_Woman_Playing_a_Lute_-_WGA01353.jpg' },
  ash: { url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a9/Field_Armor_of_King_Henry_VIII_of_England_%28reigned_1509%E2%80%9347%29_MET_DT205962.jpg/500px-Field_Armor_of_King_Henry_VIII_of_England_%28reigned_1509%E2%80%9347%29_MET_DT205962.jpg', title: "Field Armor of King Henry VIII of England (reigned 1509–47) MET DT205962", artist: "The Metropolitan Museum of Art", license: 'CC0', source: 'https://commons.wikimedia.org/wiki/File:Field_Armor_of_King_Henry_VIII_of_England_(reigned_1509%E2%80%9347)_MET_DT205962.jpg' },
  cassius: { url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/1/11/Rembrandt_Harmensz_van_Rijn_-_Man_in_Armour_-_Google_Art_Project.jpg/500px-Rembrandt_Harmensz_van_Rijn_-_Man_in_Armour_-_Google_Art_Project.jpg', title: "Rembrandt Harmensz van Rijn - Man in Armour - Google Art Project", artist: "Rembrandt", license: 'Public domain', source: 'https://commons.wikimedia.org/wiki/File:Rembrandt_Harmensz_van_Rijn_-_Man_in_Armour_-_Google_Art_Project.jpg' },
  ember_bishop: { url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/5/5c/Cardinal_Fernando_Ni%C3%B1o_de_Guevara_%281541%E2%80%931609%29_MET_DT854.jpg/500px-Cardinal_Fernando_Ni%C3%B1o_de_Guevara_%281541%E2%80%931609%29_MET_DT854.jpg', title: "Cardinal Fernando Niño de Guevara (1541–1609) MET DT854", artist: "El Greco", license: 'CC0', source: 'https://commons.wikimedia.org/wiki/File:Cardinal_Fernando_Ni%C3%B1o_de_Guevara_(1541%E2%80%931609)_MET_DT854.jpg' },
  grave_hound: { url: 'https://upload.wikimedia.org/wikipedia/commons/e/ef/Houn-53_-_The_coal-black_Hound_%28Hound_of_Baskervilles%29.jpg', title: "Houn-53 - The coal-black Hound (Hound of Baskervilles)", artist: "Sidney Paget", license: 'Public domain', source: 'https://commons.wikimedia.org/wiki/File:Houn-53_-_The_coal-black_Hound_(Hound_of_Baskervilles).jpg' },
  rat_king: { url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/9/9b/Rattenk%C3%B6nig_c1683.jpg/500px-Rattenk%C3%B6nig_c1683.jpg', title: "Rattenkönig c1683", artist: "佚名", license: 'Public domain', source: 'https://commons.wikimedia.org/wiki/File:Rattenk%C3%B6nig_c1683.jpg' },
  cult_zealot: { url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/2/23/Francisco_de_Goya_y_Lucientes_-_A_Procession_of_Flagellants_-_WGA10086.jpg/500px-Francisco_de_Goya_y_Lucientes_-_A_Procession_of_Flagellants_-_WGA10086.jpg', title: "Francisco de Goya y Lucientes - A Procession of Flagellants - WGA10086", artist: "Francisco Goya", license: 'Public domain', source: 'https://commons.wikimedia.org/wiki/File:Francisco_de_Goya_y_Lucientes_-_A_Procession_of_Flagellants_-_WGA10086.jpg' },
  iron_sword: { url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/8/8b/Hand_and_a_Half_Sword_MET_DP-15647-005.jpg/500px-Hand_and_a_Half_Sword_MET_DP-15647-005.jpg', title: "Hand and a Half Sword MET DP-15647-005", artist: "The Metropolitan Museum of Art", license: 'CC0', source: 'https://commons.wikimedia.org/wiki/File:Hand_and_a_Half_Sword_MET_DP-15647-005.jpg' },
  round_shield: { url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/2/2e/Shield_Depicting_the_Conversion_of_Saint_Paul_MET_DT293353.jpg/500px-Shield_Depicting_the_Conversion_of_Saint_Paul_MET_DT293353.jpg', title: "Shield Depicting the Conversion of Saint Paul MET DT293353", artist: "The Metropolitan Museum of Art", license: 'CC0', source: 'https://commons.wikimedia.org/wiki/File:Shield_Depicting_the_Conversion_of_Saint_Paul_MET_DT293353.jpg' },
  healing_draught: { url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/4/41/Glass_flask_MET_DP108415.jpg/500px-Glass_flask_MET_DP108415.jpg', title: "Glass flask MET DP108415", artist: "The Metropolitan Museum of Art", license: 'CC0', source: 'https://commons.wikimedia.org/wiki/File:Glass_flask_MET_DP108415.jpg' },
  sealed_letter: { url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/5/51/Ter_Borch_Sealing.jpg/500px-Ter_Borch_Sealing.jpg', title: "Ter Borch Sealing", artist: "Gerard ter Borch", license: 'Public domain', source: 'https://commons.wikimedia.org/wiki/File:Ter_Borch_Sealing.jpg' },
  grey_mare: { url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/8/8c/George_Stubbs_A_Grey_Horse_1793.jpg/500px-George_Stubbs_A_Grey_Horse_1793.jpg', title: "George Stubbs A Grey Horse 1793", artist: "George Stubbs", license: 'Public domain', source: 'https://commons.wikimedia.org/wiki/File:George_Stubbs_A_Grey_Horse_1793.jpg' },
  lute: { url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/4/41/Lute_MET_DP168843.jpg/500px-Lute_MET_DP168843.jpg', title: "Lute MET DP168843", artist: "Wendelin Tieffenbrucker", license: 'CC0', source: 'https://commons.wikimedia.org/wiki/File:Lute_MET_DP168843.jpg' },
} satisfies Record<string, ImageCredit>;

/** Square face crops (percent of the picture) for avatars, as media fragments on the thumbnail link. */
const CROPS: Partial<Record<keyof typeof IMAGES, [number, number, number, number]>> = {
  erin: [40, 5, 40, 35.1], mira: [20, 9, 36, 27.2], ash: [30, 3, 40, 30.5], cassius: [42, 18, 46, 34.7],
  ember_bishop: [30, 3, 34, 21.7], grave_hound: [40, 24, 40, 29.6], rat_king: [40, 20, 50, 64], cult_zealot: [52, 40, 26, 42],
};
/** Wikimedia serves fixed widths: swap the width in a thumbnail link (originals stay as they are). */
const sized = (url: string, width: number) => url.replace(/\/((?:lossy-page1-)?)\d+px-/u, `/$1${width}px-`);
/** Full picture (立绘 / scene / item photo). */
export const art = (k: keyof typeof IMAGES): string => sized(IMAGES[k].url, 960);
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
