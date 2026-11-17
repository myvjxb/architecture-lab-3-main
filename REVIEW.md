# Architecture review

| Principle | Evidence (file:line) | Practical risk | Fix |
|---|---|---|---|
| Information hiding | `src/checkout/CheckoutController.ts:3,18-24` | `CheckoutController` знає внутрішній формат `StripePayload` (переведення суми в центи `Math.round(total * 100)`, структуру `metadata`). При зміні провайдера або його API доведеться змінювати транспортний шар checkout. | Передавати в `OrderService` та `Payments` provider-neutral дані (суму в основних одиницях, валюту, токен, `orderId`), інкапсулювавши формування payload усередині `Payments`. |
| High cohesion | `src/orders/mapPaymentStatus.ts:3-7`, `src/reports/mapPaymentStatus.ts:3-7`, `src/notifications/mapPaymentStatus.ts:3-7` | Логіка перетворення provider-specific статусів Stripe (`succeeded`, `requires_action`) дублюється у трьох різних модулях. Додавання нового статусу (`processing`) або другого провайдера вимагає синхронного редагування кількох незалежних модулів і створює ризик розсинхронізації. | Створити єдину функцію нормалізації статусів у модулі `Payments`, яка повертає стабільний доменний статус системи. |
| Ownership | `src/orders/OrderService.ts:14-24`, `src/inventory/StockRepository.ts:8-10` | `OrderService` напряму читає та перезаписує `database.stock`, а `StockRepository.updateAvailable` дозволяє будь-якому модулю встановити довільне значення залишків. Якщо товар 1 є в наявності, а товару 2 бракує, цикл частково спише залишки перед викиданням помилки, порушивши інваріант `available >= 0` і консистентність даних. | Перенести логіку перевірки та списання залишків у модуль `Inventory` через атомарну операцію `reserve`, закривши прямий запис у `database.stock` ззовні. |
| Dependency direction | `src/orders/OrderService.ts:4`, `src/payments/internal/StripeClient.ts:2,18` | Модуль `Orders` імпортує внутрішній файл `payments/internal/StripeClient.ts`, а `StripeClient` у відповідь імпортує `orders/internal/orderMutations.ts` і мутує замовлення в БД. Утворюється циклічна залежність `Orders ↔ Payments` та подвійний запис статусу замовлення, що ускладнює тестування та ізоляцію модулів. | Видалити імпорт `orders/internal` із `Payments` (повертати результат оплати назовні), а `Orders` перевести на публічний контракт `Payments`. |
| Local reasoning | `src/shared/calculateTotal.ts:1,10-21` | Функція `calculateTotal` неявно читає глобальний `runtimeConfig`, мутує переданий масив об'єктів `lines` (дописуючи `lineTotal`) і пише побічний ефект у глобальний `auditLog`. Неможливо передбачити результат функції лише за її аргументами, а тестування потребує скидання глобального стану. | Передавати `taxRate` та `discountPercent` явними аргументами, обчислювати суму без мутації вхідних об'єктів і винести `auditLog` на рівень оркестрації (`CheckoutController`). |

## Change impact prediction (заповнити до реалізації change request)

**Requirement:** Підтримати новий нормалізований статус оплати `processing` та підготувати систему до підключення другого payment provider без зміни публічного API `CheckoutController` та без витоку provider-specific деталей за межі модуля `Payments`.

**Expected files:**
- `src/payments/normalizePaymentStatus.ts` (новий файл у `Payments` для єдиної нормалізації статусів)
- `src/payments/PaymentService.ts` або публічний контракт `Payments` (для ізоляції `StripeClient`)
- `src/payments/internal/StripeClient.ts` (підтримка `requires_action` / `processing`, видалення виклику `markOrderPaid`)
- `src/orders/OrderService.ts` (використання публічного API `Payments` та атомарного резервування `Inventory`)
- `src/orders/mapPaymentStatus.ts`, `src/reports/mapPaymentStatus.ts`, `src/notifications/mapPaymentStatus.ts` (переведення на нормалізований статус із `Payments` або видалення дубльованого мапінгу)
- `src/inventory/InventoryService.ts` / `src/inventory/StockRepository.ts` (атомарний `reserve`)
- `src/checkout/CheckoutController.ts` та `src/shared/calculateTotal.ts` (очищення від `StripePayload` та глобальних побічних ефектів)

**Modules that should not change:**
- `src/database.ts` (структура сховища `stock` та `orders` залишається незмінною)
- `src/config.ts` (конфігураційні константи за замовчуванням залишаються на місці, змінюється лише спосіб їх передачі)
- Публічний формат відповіді `CheckoutController.checkout` (`{ orderId, status, total, paymentStatus }`) для сценаріїв `paid` та `failed`.

**Actual files changed:**
- `src/payments/normalizePaymentStatus.ts` (створено єдиний нормалізатор статусів провайдера)
- `src/payments/PaymentService.ts` (створено публічний provider-neutral контракт `Payments`)
- `src/payments/internal/StripeClient.ts` (видалено зворотний імпорт `orders/internal`, додано підтримку `requires_action`)
- `src/orders/OrderService.ts` (переведено на `PaymentService` та `InventoryService`, видалено прямий доступ до `database.stock`)
- `src/orders/internal/orderMutations.ts` (видалено через усунення порушення меж між `Payments` та `Orders`)
- `src/orders/mapPaymentStatus.ts`, `src/reports/mapPaymentStatus.ts`, `src/notifications/mapPaymentStatus.ts` (делеговано мапінг у `Payments`)
- `src/inventory/InventoryService.ts` та `src/inventory/StockRepository.ts` (реалізовано атомарний `reserve` і захист інваріанта `available >= 0`)
- `src/shared/calculateTotal.ts` та `src/checkout/CheckoutController.ts` (зроблено `calculateTotal` чистою функцією, прибрано `StripePayload` з контролера)
- `tests/payment-status.unit.test.ts` та `tests/level75.boundaries.test.ts` (додано тести рівнів 60 та 75)

**Difference from prediction and explanation:**
Початковий прогноз повністю підтвердився: ядро бізнес-сховища (`src/database.ts`), конфігурація (`src/config.ts`) та зовнішній формат відповіді `CheckoutController.checkout` не змінилися. Додатково було видалено файл `src/orders/internal/orderMutations.ts`, оскільки після розриву циклічної залежності `Orders ↔ Payments` у ньому відпала потреба.