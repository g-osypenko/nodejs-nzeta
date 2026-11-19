import type { Lang } from './i18n';

/**
 * Guides shown on /guides. Placeholders until the real guides are uploaded — then this list (or a
 * CMS/markdown source) is replaced; the page only needs `slug`, a title and blocks per language.
 * A block is a paragraph of text or a video (a file in web/public/media/ or an embed URL).
 */
export type GuideBlock =
  { kind: 'text'; text: string } | { kind: 'video'; src: string | null; caption?: string };

export interface Guide {
  slug: string;
  title: Record<Lang, string>;
  blocks: Record<Lang, GuideBlock[]>;
}

export const GUIDES: readonly Guide[] = [
  {
    slug: 'getting-started',
    title: { uk: 'Перші кроки', en: 'Getting started' },
    blocks: {
      uk: [
        { kind: 'video', src: null },
        {
          kind: 'text',
          text: 'Купіть ліцензію, завантажте програму й увійдіть кодом з пошти. Під час першого запуску ключ прив’яжеться до цього пристрою.',
        },
      ],
      en: [
        { kind: 'video', src: null },
        {
          kind: 'text',
          text: 'Buy a license, download the app and sign in with the code from your email. On first launch the key binds to this device.',
        },
      ],
    },
  },
  {
    slug: 'configs',
    title: { uk: 'Конфіги', en: 'Configs' },
    blocks: {
      uk: [
        {
          kind: 'text',
          text: 'Конфіг — це .json з налаштуваннями програми. Збережіть його в кабінеті, і він буде доступний на будь-якому вашому пристрої.',
        },
        { kind: 'video', src: null },
      ],
      en: [
        {
          kind: 'text',
          text: 'A config is a .json with the app settings. Save it in your account and it is available on any of your devices.',
        },
        { kind: 'video', src: null },
      ],
    },
  },
  {
    slug: 'new-device',
    title: { uk: 'Новий пристрій', en: 'New device' },
    blocks: {
      uk: [
        {
          kind: 'text',
          text: 'Ліцензія працює на одному пристрої. Щоб перенести її, напишіть у підтримку — ми скинемо прив’язку.',
        },
      ],
      en: [
        {
          kind: 'text',
          text: 'A license works on one device. To move it, contact support — we will reset the binding.',
        },
      ],
    },
  },
];
