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

## Decision 3: Публічний provider-neutral контракт Payments та розрив циклу Orders ↔ Payments

**Problem:** `CheckoutController` та `OrderService` напряму імпортували `payments/internal/StripeClient.ts`, а `StripeClient` у відповідь імпортував `orders/internal/orderMutations.ts`, утворюючи циклічну залежність і витік деталей Stripe.

**Evidence:** Імпорт `StripePayload` у `src/checkout/CheckoutController.ts:3`, `StripeClient` у `src/orders/OrderService.ts:4` та виклик `markOrderPaid` у `src/payments/internal/StripeClient.ts:2,18`.

**Decision:** Створити публічний сервіс `PaymentService.authorize` (`src/payments/PaymentService.ts`) із provider-neutral типами та видалити зворотний імпорт `orders/internal` зі `StripeClient`.

**Why:** Це забезпечує information hiding для адаптера провайдера та встановлює однонапрямлений dependency direction (`Orders → Payments`).

**Alternative:** Передавати callback-функцію оновлення замовлення всередину `StripeClient`.

**Why rejected:** Callback ускладнює потік керування та залишає відповідальність за стан замовлення всередині платіжного клієнта замість `OrderService`.

**Trade-off:** З'явився додатковий шар мапінгу запиту в `PaymentService`, але інтеграція нових провайдерів тепер не торкається `Checkout` і `Orders`.

**Verification:** Проведено рефакторинг імпортів; усі функціональні та інтеграційні тести `CheckoutController` проходять без доступу до `payments/internal`.

## Decision 4: Ownership залишків та атомарна операція reserve в Inventory

**Problem:** `OrderService` напряму читав і записував `database.stock` у циклі, через що нестача другого товару залишала перший товар уже списаним.

**Evidence:** Прямі виклики `database.stock.get` та `database.stock.set` у циклі `src/orders/OrderService.ts:14-24` і відкритий метод `updateAvailable` у `src/inventory/StockRepository.ts:8-10`.

**Decision:** Передати виключний ownership залишків модулю `Inventory` через двофазний метод `InventoryService.reserve` (`src/inventory/InventoryService.ts`), який спочатку перевіряє всі позиції, а потім атомарно їх списує.

**Why:** Інваріант `available >= 0` та атомарність резервування захищаються в одному модулі-власнику і не можуть бути обійдені ззовні.

**Alternative:** Виконувати попередню перевірку циклом у `OrderService` перед записом у `StockRepository`.

**Why rejected:** Логіка захисту інваріанта залишків усе одно залишалася б розмазаною в `Orders`, порушуючи межі відповідальності модулів.

**Trade-off:** Для однієї операції резервування виконуються два проходи по списку товарів, що незначно збільшує складність, але гарантує консистентність даних.

**Verification:** Додано тест у `tests/level75.boundaries.test.ts`, який перевіряє відсутність часткового списання при нестачі одного з товарів.

## Decision 5: Детермінований розрахунок вартості (Local reasoning для calculateTotal)

**Problem:** Функція `calculateTotal` залежала від глобального `runtimeConfig`, мутувала переданий масив об'єктів `lines` і записувала дані в глобальний `auditLog`.

**Evidence:** Звернення до `runtimeConfig`, присвоєння `line.lineTotal` та `auditLog.push` у `src/shared/calculateTotal.ts:10-21`.

**Decision:** Зробити `calculateTotal(lines, options)` чистою функцією з явними параметрами `taxRate` і `discountPercent`, без мутації вхідних рядків, перенісши `auditLog` у `CheckoutController`.

**Why:** Результат обчислення тепер повністю визначається вхідними аргументами, що забезпечує local reasoning і просте модульне тестування без глобального стану.

**Alternative:** Клонувати масив `lines` усередині `calculateTotal`, залишивши читання `runtimeConfig`.

**Why rejected:** Клонування прибрало б лише мутацію, але зберегло б приховану залежність від глобальної конфігурації та побічний ефект логування.

**Trade-off:** Викликаючий код (`CheckoutController`) тепер зобов'язаний явно передавати налаштування податків та знижок.

**Verification:** Додано unit-тест у `tests/level75.boundaries.test.ts`, який перевіряє детермінованість, відсутність мутації `lines` та незмінність `auditLog`.

## AI review

- **Корисна пропозиція AI:** Розділити `InventoryService.reserve` на дві фази (спочатку повна валідація наявності всіх позицій з агрегацією дублікатів `productId`, і лише потім запис у репозиторій), що елегантно закрило проблему часткового списання залишків при помилці на другій позиції замовлення.
- **Відхилена пропозиція AI:** AI запропонував створити абстрактний базовий клас `BasePaymentGateway` та фабрику реєстрації провайдерів через dependency injection контейнер уже на рівні 75 балів. Пропозицію відхилено як передчасний overengineering: для поточного обсягу вимог достатньо легкого публічного контракту `PaymentService` без зайвої ієрархії класів.
- **Спосіб перевірки згенерованого рішення:** Запущено всі початкові функціональні тести (`tests/checkout.functional.test.ts`) без зміни їхніх очікувань, після чого написано окремі модульні тести (`tests/payment-status.unit.test.ts`, `tests/level75.boundaries.test.ts`) на граничні випадки та перевірено чистоту імпортів між модулями.