import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

/**
 * Interface language: Ukrainian and English. The choice is kept in localStorage (a per-visitor
 * convenience; without storage the page still works and falls back to the browser language).
 * Every string of the UI lives here — pages never hard-code text.
 */
export type Lang = 'uk' | 'en';
export const LANGS: readonly Lang[] = ['uk', 'en'];

const uk = {
  locale: 'uk-UA',
  nav: {
    guides: 'Гайди',
    plans: 'Тарифи',
    licenses: 'Мої ліцензії',
    account: 'Кабінет',
    signIn: 'Увійти',
    signOut: 'Вийти',
  },
  support: 'Підтримка',
  supportNote: 'Питання, баги, ідеї — пишіть нам у Discord.',
  langLabel: 'Мова',
  hero: {
    title: 'Ліцензії та налаштування в одному місці',
    lead: 'Купуєте ключ, запускаєте програму — і вона працює на вашому пристрої. Без паролів: вхід кодом з пошти.',
    cta: 'Обрати тариф',
    scroll: 'Гортайте',
  },
  showcase: {
    soon: 'Відео з роботою програми — незабаром',
  },
  plans: {
    title: 'Тарифи',
    lead: 'Ліцензія прив’язується до пристрою (HWID) під час першого запуску. Строк іде від активації, а не від покупки.',
    names: { monthly: 'Місяць', quarterly: 'Квартал', yearly: 'Рік' } as Record<string, string>,
    days: (n: number): string => `${n} днів після активації`,
    buy: 'Купити',
    buying: 'Створюємо замовлення…',
  },
  loading: 'Завантаження…',
  login: {
    title: 'Вхід',
    email: 'Email',
    code: 'Код із листа',
    sent: (email: string): string =>
      `Ми надіслали на ${email} лист із кодом і посиланням для входу. Код діє 10 хвилин.`,
    send: 'Надіслати код',
    submit: 'Увійти',
    wait: 'Зачекайте…',
    resendIn: (s: number): string => `Надіслати код ще раз через ${s} с`,
    resend: 'Надіслати код ще раз',
    otherEmail: 'Інший email',
    noPassword: 'Пароль не потрібен. Якщо акаунта ще немає, ми його створимо.',
    checkingLink: 'Перевіряємо посилання…',
    noToken: 'У посиланні немає коду входу. Відкрийте посилання з листа ще раз.',
    newCode: 'Отримати новий код',
  },
  licenses: {
    title: 'Мої ліцензії',
    empty: 'Ліцензій ще немає —',
    choosePlan: 'оберіть тариф',
    key: 'Ключ',
    state: 'Стан',
    device: 'Пристрій (HWID)',
    activated: 'Активовано',
    validUntil: 'Діє до',
    afterActivation: (n: number): string => `${n} дн. від активації`,
    status: {
      UNACTIVATED: 'не активована',
      ACTIVE: 'активна',
      EXPIRED: 'прострочена',
      BANNED: 'заблокована',
    },
  },
  order: {
    title: 'Замовлення',
    summary: 'Тариф',
    created: 'створено',
    pending: 'очікує оплати',
    pendingNote:
      'Оплату підтверджує платіжний провайдер. Його ще не підключено, тож замовлення лишається в цьому стані.',
    refresh: 'Оновити стан',
    paid: 'оплачено',
    yourKey: 'Ваш ключ:',
    toLicenses: 'До моїх ліцензій →',
    failed: 'оплата не пройшла',
    retry: 'спробувати ще раз',
  },
  notFound: { title: 'Сторінку не знайдено', home: 'На головну' },
  guides: {
    title: 'Гайди',
    list: 'Усі гайди',
    videoSoon: 'Відео з’явиться тут',
    notFound: 'Такого гайду немає.',
  },
  account: {
    title: 'Кабінет',
    configsTitle: 'Мої конфіги',
    configsLead:
      'Завантажте .json конфіга з програми, дайте йому назву — і він буде доступний на будь-якому вашому пристрої.',
    file: 'Файл .json',
    name: 'Назва',
    namePlaceholder: 'наприклад, main-profile',
    nameHint: 'Латиниця, цифри, «-» і «_», до 64 символів.',
    upload: 'Зберегти конфіг',
    uploading: 'Зберігаємо…',
    saved: (name: string): string => `Конфіг «${name}» збережено.`,
    badJson: 'Це не JSON: перевірте файл.',
    noConfigs: 'Конфігів ще немає.',
    updated: 'оновлено',
    download: 'Завантажити',
    remove: 'Видалити',
    example: 'Приклад конфіга',
    testCode: 'Тестовий код для входу на localhost: 1111-1111',
  },
  errors: {
    offline: 'Немає зв’язку із сервером. Спробуйте ще раз.',
    INVALID_CODE: 'Код неправильний або застарів. Перевірте лист або надішліть новий код.',
    TOO_MANY_REQUESTS: 'Забагато запитів коду. Зачекайте трохи й спробуйте знову.',
    VALIDATION_ERROR: 'Перевірте email і код: код складається із 6 цифр.',
    FORBIDDEN: 'Запит відхилено. Оновіть сторінку й спробуйте ще раз.',
    UNAUTHENTICATED: 'Сесія завершилась — увійдіть знову.',
    DB_UNAVAILABLE: 'Сервіс тимчасово недоступний. Спробуйте за хвилину.',
    NOT_FOUND: 'Не знайдено.',
  } as Record<string, string>,
};

export type Messages = typeof uk;

const en: Messages = {
  locale: 'en-US',
  nav: {
    guides: 'Guides',
    plans: 'Plans',
    licenses: 'My licenses',
    account: 'Account',
    signIn: 'Sign in',
    signOut: 'Sign out',
  },
  support: 'Support',
  supportNote: 'Questions, bugs, ideas — talk to us on Discord.',
  langLabel: 'Language',
  hero: {
    title: 'Licenses and settings in one place',
    lead: 'Buy a key, launch the app — it just works on your device. No passwords: sign in with a code from your email.',
    cta: 'Choose a plan',
    scroll: 'Scroll',
  },
  showcase: {
    soon: 'A video of the app in action — coming soon',
  },
  plans: {
    title: 'Plans',
    lead: 'A license binds to your device (HWID) on first launch. The term starts at activation, not at purchase.',
    names: { monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' },
    days: (n) => `${n} days after activation`,
    buy: 'Buy',
    buying: 'Creating the order…',
  },
  loading: 'Loading…',
  login: {
    title: 'Sign in',
    email: 'Email',
    code: 'Code from the email',
    sent: (email) =>
      `We sent an email with a code and a sign-in link to ${email}. The code is valid for 10 minutes.`,
    send: 'Send code',
    submit: 'Sign in',
    wait: 'Please wait…',
    resendIn: (s) => `Send the code again in ${s} s`,
    resend: 'Send the code again',
    otherEmail: 'Use another email',
    noPassword: 'No password needed. If you have no account yet, we will create one.',
    checkingLink: 'Checking the link…',
    noToken: 'The link has no sign-in code. Open the link from the email again.',
    newCode: 'Get a new code',
  },
  licenses: {
    title: 'My licenses',
    empty: 'No licenses yet —',
    choosePlan: 'choose a plan',
    key: 'Key',
    state: 'Status',
    device: 'Device (HWID)',
    activated: 'Activated',
    validUntil: 'Valid until',
    afterActivation: (n) => `${n} days from activation`,
    status: {
      UNACTIVATED: 'not activated',
      ACTIVE: 'active',
      EXPIRED: 'expired',
      BANNED: 'banned',
    },
  },
  order: {
    title: 'Order',
    summary: 'Plan',
    created: 'created',
    pending: 'awaiting payment',
    pendingNote:
      'The payment provider confirms the payment. It is not connected yet, so the order stays in this state.',
    refresh: 'Refresh',
    paid: 'paid',
    yourKey: 'Your key:',
    toLicenses: 'To my licenses →',
    failed: 'payment failed',
    retry: 'try again',
  },
  notFound: { title: 'Page not found', home: 'Home' },
  guides: {
    title: 'Guides',
    list: 'All guides',
    videoSoon: 'The video will be here',
    notFound: 'There is no such guide.',
  },
  account: {
    title: 'Account',
    configsTitle: 'My configs',
    configsLead:
      'Upload a .json config from the app and name it — it will be available on any of your devices.',
    file: '.json file',
    name: 'Name',
    namePlaceholder: 'e.g. main-profile',
    nameHint: 'Latin letters, digits, “-” and “_”, up to 64 characters.',
    upload: 'Save config',
    uploading: 'Saving…',
    saved: (name) => `Config “${name}” saved.`,
    badJson: 'This is not JSON: check the file.',
    noConfigs: 'No configs yet.',
    updated: 'updated',
    download: 'Download',
    remove: 'Delete',
    example: 'Example config',
    testCode: 'Test sign-in code on localhost: 1111-1111',
  },
  errors: {
    offline: 'No connection to the server. Please try again.',
    INVALID_CODE: 'The code is wrong or expired. Check the email or request a new code.',
    TOO_MANY_REQUESTS: 'Too many code requests. Wait a little and try again.',
    VALIDATION_ERROR: 'Check the email and the code: the code has 6 digits.',
    FORBIDDEN: 'The request was rejected. Reload the page and try again.',
    UNAUTHENTICATED: 'Your session has ended — please sign in again.',
    DB_UNAVAILABLE: 'The service is temporarily unavailable. Try again in a minute.',
    NOT_FOUND: 'Not found.',
  },
};

const MESSAGES: Record<Lang, Messages> = { uk, en };
const STORAGE_KEY = 'nzeta.lang';

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'uk' || saved === 'en') return saved;
  } catch {
    // storage blocked: fall through to the browser language
  }
  return navigator.language.toLowerCase().startsWith('uk') ? 'uk' : 'en';
}

interface I18nState {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: Messages;
  formatPrice: (cents: number) => string;
  formatDate: (iso: string | null) => string;
}

const I18nContext = createContext<I18nState | null>(null);

export function I18nProvider({ children }: { children: ReactNode }): ReactElement {
  const [lang, setLangState] = useState<Lang>(initialLang);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next: Lang): void => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // the choice lives only for this tab
    }
  }, []);

  const value = useMemo<I18nState>(() => {
    const t = MESSAGES[lang];
    const money = new Intl.NumberFormat(t.locale, { style: 'currency', currency: 'USD' });
    return {
      lang,
      setLang,
      t,
      formatPrice: (cents): string => money.format(cents / 100),
      formatDate: (iso): string =>
        iso === null ? '—' : new Date(iso).toLocaleDateString(t.locale),
    };
  }, [lang, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nState {
  const ctx = useContext(I18nContext);
  if (ctx === null) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}
