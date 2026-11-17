# Decision log

## Decision 1: Централізація нормалізації платіжних статусів у модулі Payments

**Problem:** Логіка перетворення статусів відповіді Stripe дублювалася у трьох різних модулях (`Orders`, `Reports`, `Notifications`), прив'язуючи кожен із них до структури `StripeResponse` та створюючи ризик розсинхронізації.

**Evidence:** Ідентичні функції `mapPaymentStatus` у `src/orders/mapPaymentStatus.ts:3-7`, `src/reports/mapPaymentStatus.ts:3-7` та `src/notifications/mapPaymentStatus.ts:3-7` перевіряли `response.state === "succeeded"`.

**Decision:** Винести мапінг статусів в єдину функцію `normalizePaymentStatus` усередині модуля `Payments`, додавши підтримку доменного статусу `processing`.

**Why:** Це підвищує cohesion модуля `Payments` та локалізує знання про назви статусів провайдера в одному місці.

**Alternative:** Винести `mapPaymentStatus` у папку `src/shared/`.

**Why rejected:** Модуль `shared` не повинен знати про специфіку платіжних провайдерів, інакше виникає зворотна залежність загального коду від `Payments`.

**Trade-off:** Споживачі тепер імпортують функцію з `Payments`, що створює явну залежність від публічного API платіжного модуля.

**Verification:** Додано unit-тести у `tests/payment-status.unit.test.ts` для статусів `paid`, `processing`, `failed` та інтеграційний тест у `CheckoutController`.

## Decision 2: Безпечна обробка невідомого статусу провайдера (fail-safe fallback)

**Problem:** При підключенні нових платіжних шлюзів або оновленні API провайдера система може отримати невідомий текстовий статус, який не передбачений поточною логікою.

**Evidence:** У початковому `src/orders/mapPaymentStatus.ts:6` будь-який статус, окрім `succeeded` та `requires_action`, неявно повертав `"failed"`, але це не було зафіксовано як явний контракт нормалізації.

**Decision:** У `normalizePaymentStatus` (`src/payments/normalizePaymentStatus.ts:4-15`) явно визначити `default` гілку `switch`, яка повертає `"failed"` для будь-якого невідомого значення.

**Why:** Такий fail-safe підхід гарантує, що замовлення ніколи не перейде у статус `confirmed` без підтвердженого списання коштів.

**Alternative:** Викидати виняток (`throw new Error`) при отриманні невідомого статусу.

**Why rejected:** Необроблений виняток зламав би контракт `CheckoutController`, який для неуспішних оплат повертає об'єкт із `status: "payment_pending"`, а не падає з помилкою.

**Trade-off:** Тимчасовий невідомий проміжний статус може бути зафіксований як `failed`, вимагаючи повторної спроби оплати.

**Verification:** Перевірено unit-тестом на передачу довільних рядків (`"unexpected_gateway_code"`, `""`) у `tests/payment-status.unit.test.ts`.