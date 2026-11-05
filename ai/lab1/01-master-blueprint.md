# Lab 1 · Промпт 01 — Master Blueprint проєкту

Вхідний документ, яким задавався контекст усього проєкту для AI-агента (дослівно, без змін; оригінал російською). На його основі агент генерував README, spec.md, ADR 0001–0003 та каркас `src/`.

```text
Master Blueprint: License & Config Hub (Backend & Gateway)

1. Контекст и глобальная цель проекта

Проект представляет собой модульный бэкенд-сервис License & Config Hub, предназначенный для сопровождения десктопного ПО компьютерного зрения (нейросетевой детекции объектов).

Основное десктопное приложение вынесено за рамки данного репозитория и разрабатывается автономно. В рамках данного курса создается веб-платформа с витриной тарифов и онлайн-продажей лицензий (checkout / обработка платежных вебхуков), управлением пользовательскими конфигурациями и шлюз авторизации для клиентского лоадера (Loader Gateway).

Ключевой функционал:

Витрина и онлайн-продажа: Выбор тарифного плана (30 / 90 / 365 дней), оформление покупки (checkout), обработка платежных вебхуков и автоматическая генерация лицензионного ключа для покупателя.

Кабинет пользователя: Регистрация/вход (опционально по email), покупка и привязка лицензионного ключа, загрузка и выгрузка JSON-профилей конфигураций (чувствительность, разрешения, пресеты сглаживания).

Админ-панель: Просмотр реестра лицензионных ключей, статусов активации, привязанных HWID оборудования и email владельцев (если привязан).

Loader Gateway (Handshake API): Легковесный сетевой шлюз для клиентского лоадера. Принимает пару { license_key, hwid }, выполняет атомарную привязку при первой активации и возвращает статус доступа (200 OK или ошибки авторизации).

2. Архитектурный стиль и стек технологий

Архитектурный паттерн: Модульный монолит (Modular Monolith) с чистым разделением слоев: Transport (Controller/Routes) -> Domain/Service -> Data Access (Repository).

Runtime: Node.js (v20+ LTS).

Язык: TypeScript в строгом режиме ("strict": true, без any).

Web Framework: Fastify (минимальные накладные расходы, встроенная схема валидации JSON Schema, идеальная база под нагрузочное тестирование в Лабе 5).

База данных: PostgreSQL.

ORM/Query Builder: Drizzle ORM (дает полный контроль над SQL, наглядное решение проблемы N+1 и простой запуск EXPLAIN ANALYZE).

Тестирование: Vitest (unit & integration), Testcontainers (для изоляции PostgreSQL в тестах), Stryker Mutator (мутационное тестирование).

Качество кода: ESLint, Prettier, Husky, lint-staged, commitlint (Conventional Commits).

3. Модель предметной области (Domain Entities)

erDiagram
    USERS ||--o{ LICENSES : "owns / purchases"
    USERS ||--o{ USER_CONFIGS : manages

    USERS {
        uuid id PK
        string email UK "nullable"
        string password_hash "nullable"
        string role "USER | ADMIN"
        datetime created_at
    }

    LICENSES {
        uuid id PK
        string key UK "Format: APP-XXXX-YYYY-ZZZZ"
        string hwid "nullable, binds on activation"
        string status "UNACTIVATED | ACTIVE | BANNED | EXPIRED"
        uuid user_id FK "nullable"
        datetime activated_at "nullable"
        datetime expires_at
        datetime created_at
    }

    USER_CONFIGS {
        uuid id PK
        uuid user_id FK
        string name "Profile name"
        jsonb payload "Raw configuration data"
        datetime updated_at
    }


4. Карта модулей (Bounded Contexts)

src/
├── modules/
│   ├── auth/          # Регистрация, сессии, JWT, роли (User/Admin)
│   ├── licenses/      # Витрина тарифов, онлайн-продажа (checkout), генерация ключей, привязка, админский аудит
│   ├── configs/       # Управление JSON-профилями настроек
│   └── loader/        # Критический шлюз handshake (высоконагруженный API)
├── shared/
│   ├── db/            # Подключение к Postgres, схемы Drizzle, миграции
│   ├── errors/        # Доменные ошибки и централизованный маппинг в HTTP
│   └── logger/        # Быстрый структурированный логгер (Pino)
└── app.ts             # Сборка сервера, регистрация плагинов Fastify


5. Протокол Loader Handshake (/api/v1/loader/handshake)

Запрос:

POST /api/v1/loader/handshake HTTP/1.1
Content-Type: application/json

{
  "license_key": "APP-9821-FA23-9011",
  "hwid": "CPU-BFEBFBFF000906EA-DISK-1A2B3C4D"
}


Алгоритм обработки:

Валидация формата: Проверка регулярным выражением формата ключа и строки HWID.

Поиск ключа:

Ключ не существует $\rightarrow$ 404 Not Found (KEY_NOT_FOUND).

Ключ заблокирован или просрочен $\rightarrow$ 403 Forbidden (KEY_BANNED / KEY_EXPIRED).

Первичная привязка (hwid === null):

В атомарной транзакции устанавливается привязка текущего hwid, статус переводится в ACTIVE, выставляется метка activated_at.

Ответ: 200 OK { "status": "OK", "action": "BOUND", "expires_at": "..." }.

Повторный запуск (hwid !== null):

Если incoming_hwid === license.hwid $\rightarrow$ 200 OK { "status": "OK", "action": "AUTHENTICATED" }.

Если incoming_hwid !== license.hwid $\rightarrow$ 403 Forbidden (HWID_MISMATCH).

6. Системные стандарты разработки

Идемпотентность и ACID: Все операции изменения лицензий и сессий изолированы транзакциями.

Отсутствие бизнес-логики в контроллерах: Контроллер принимает запрос, валидирует схему через Fastify JSON-Schema и передает в Service.

Строгая типизация: Никаких неявных типов any или неотловленных null/undefined.

Контракт версионирования: Все роуты начинаются с /api/v1/. Сервер обязан отдавать свой commit SHA по адресу /version.
```
