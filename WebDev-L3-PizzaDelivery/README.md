# SUNNYS Pizza 🍕

**Full-stack pizza ordering and delivery management application**  
**OASIS INFOBYTE (OIBSIP) · Web Development · Level 3 · Pizza Delivery**

SUNNYS Pizza is a MERN-stack internship project combining a responsive customer storefront with an administrative workspace. Customers can discover pizzas, configure ingredients, manage a cart, place orders, complete a Razorpay **test-mode** payment flow, and view order progress. Administrators can maintain the catalogue and its images, manage ingredient stock, review orders, and advance fulfilment statuses.

The repository uses **npm workspaces**: `client/` contains the React application, and `server/` contains the Express API, MongoDB models, and background services.

> **Project scope:** Local-development/internship application. This README does not claim a live deployment, production payment certification, or an entirely green end-to-end test run.

## Contents

- [Features](#features)
- [Technology stack](#technology-stack)
- [Architecture and project structure](#architecture-and-project-structure)
- [Getting started](#getting-started)
- [Database setup and seeders](#database-setup-and-seeders)
- [Administrator provisioning](#administrator-provisioning)
- [API reference](#api-reference)
- [Order, payment and inventory lifecycle](#order-payment-and-inventory-lifecycle)
- [Testing and build](#testing-and-build)
- [Images and deployment notes](#images-and-deployment-notes)

## Features

### Customer experience

- Responsive storefront with promotional content, a pizza catalogue, light/dark themes, mobile navigation, and profile views.
- Customer registration, email verification, sign-in, password reset, and account profile updates.
- Pizza customization with a base, sauce, cheese, and optional vegetable toppings. Backend models also support protein toppings for non-vegetarian recipes; the optional seeder must use a compatible model version.
- Ingredient-based prices stored as integer **INR paise**, with availability checks and server-calculated order quotes.
- Cart and checkout, order history, individual order details, and an active-order display.
- Razorpay payment initiation and verification paths, plus customer-room Socket.IO order-update notifications.

### Administration

- Dashboard with aggregate order statistics and order listing/detail views.
- Add, edit, activate, and deactivate catalogue pizzas.
- Upload, replace, and delete pizza images (JPEG, PNG, or WebP; maximum **5 MB**, with file-signature checks).
- View ingredient availability, update stock, and configure low-stock thresholds.
- Move paid orders through permitted fulfilment states; order payment confirmation remains part of the payment workflow.
- Scheduled low-stock checks and email alerts when an administrator email is configured.

### Security and operational safeguards

- Password hashing with bcrypt; JWT authentication in HTTP-only cookies; customer/admin role separation.
- CSRF protection for state-changing requests, CORS and security headers, input validation, and rate limiting.
- Customer-owned order access and customer-scoped idempotency keys for order creation.
- Transaction-based inventory reservations, controlled release/commit, and payment gateway reconciliation logic.
- Expiration sweeps for unpaid reservations, late-payment recovery handling, and graceful server shutdown.

## Technology stack

| Area | Technologies |
| --- | --- |
| Frontend | React 19, JavaScript, Vite 7, Tailwind CSS 4 |
| Backend | Node.js 24, Express 5 |
| Database | MongoDB, Mongoose 9 |
| Authentication/security | bcrypt, JSON Web Tokens, `csrf-csrf`, Helmet, `express-rate-limit`, Zod |
| Payments | Razorpay SDK (test credentials for local checkout) |
| Live updates | Socket.IO |
| Email/automation | Nodemailer, `node-cron` |
| File handling | Multer, filesystem-based pizza image uploads |
| Testing | Vitest, Supertest, React Testing Library, jsdom, MongoDB Memory Server |

## Architecture and project structure

```text
WebDev-L3-PizzaDelivery/
├── client/
│   ├── public/                 # Images and other public storefront assets
│   ├── src/
│   │   ├── api/                # Browser-side API requests
│   │   ├── components/         # Pizza builder, cart, checkout, orders, navigation
│   │   ├── hooks/              # Authentication and UI hooks
│   │   ├── pages/              # Menu, profile and admin views
│   │   ├── utils/              # Cart and other frontend helpers
│   │   └── App.jsx
│   ├── .env.example            # Optional client asset settings (if present)
│   └── vitest.config.js
├── server/
│   ├── src/
│   │   ├── config/             # Environment and email configuration
│   │   ├── db/                 # MongoDB connection
│   │   ├── middleware/         # Authentication, security, error handling
│   │   ├── models/             # User, AuthToken, Ingredient, Pizza, Order
│   │   ├── realtime/           # Authenticated Socket.IO server
│   │   ├── routes/             # health, auth, catalogue, orders, payments, admin
│   │   ├── scripts/            # Admin creation and database seeders
│   │   ├── services/           # Reservations, Razorpay, recovery, stock alerts
│   │   ├── app.js              # Express setup and route registration
│   │   └── index.js            # HTTP/Socket.IO startup and workers
│   └── uploads/pizzas/        # Public catalogue images (if populated)
├── tests/                      # Backend and integration tests
├── .env.example                # Example backend settings (if stored at root)
├── package.json                # Workspace scripts
├── package-lock.json
└── README.md
```

### Data models

| Model | Responsibility |
| --- | --- |
| `User` | Customer/admin accounts, hashed passwords, email verification status, profile information, JWT token version |
| `AuthToken` | Hashed, expiring, single-use email-verification and password-reset tokens |
| `Ingredient` | Ingredient name/category, price in paise, stock, reserved quantity, low-stock threshold, active state |
| `Pizza` | Named preset, category, ingredient references, image URL, active state, computed price and availability |
| `Order` | Customer-owned multi-item order, price snapshots, state, payment identifiers, reservation and gateway metadata |

The included models define ingredient categories `base`, `sauce`, `cheese`, `vegetable`, and `protein`, with protein topping references in `Pizza` and `Order`. The basic vegetarian and vegan recipes use a single cheese reference; the vegan presets specify a **plant-based** cheese ingredient.

## Getting started

### Requirements

- **Node.js 24.x** and npm (`package.json` declares `"node": "^24.0.0"`).
- A running MongoDB instance. **Order/payment inventory transactions require a replica-set-capable MongoDB setup**, including for local development when exercising those flows.
- Razorpay **test** API credentials to exercise the gateway checkout path.
- Email configuration for verification/reset emails and optional admin stock alerts.

### 1. Install packages

From the project root in PowerShell:

```powershell
Set-Location "C:\Users\HomePC\OIBSIP\WebDev-L3-PizzaDelivery"
npm install
```

The absolute path is the original Windows development location; other users should substitute their own cloned project path.

### 2. Configure the server

Create `server/.env` from the backend example. If your example file is in the repository root:

```powershell
Copy-Item .\.env.example .\server\.env
```

If it is stored in `server/`, copy that version instead. Do **not** commit the resulting `.env`.

The backend validates these settings:

| Variable | Use |
| --- | --- |
| `NODE_ENV` | `development`, `test`, or `production` |
| `PORT` | HTTP/Socket.IO listening port; default `5000` |
| `MONGODB_URI` | MongoDB connection string |
| `CLIENT_URL` | Permitted frontend origin, e.g. `http://localhost:5173` |
| `JWT_SECRET` | Private JWT signing secret, **at least 32 characters** |
| `JWT_EXPIRY` | JWT lifetime; default `2h` |
| `CSRF_SECRET` | Private CSRF secret, **at least 32 characters** |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Razorpay credentials; use **test-mode keys** locally |
| `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER`, `EMAIL_PASS`, `EMAIL_FROM` | SMTP/email settings (Ethereal is the development default) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Inputs for the private admin-provisioning script |
| `SEED_DB_NAME` | Explicitly approved local database name for the main and non-vegetarian seeders |

Supply fresh random secrets and your own credentials. Never publish `.env` files or copy placeholder admin passwords into an operational setup.

### 3. Configure client assets (optional)

If the client example is present:

```powershell
Copy-Item .\client\.env.example .\client\.env
```

`VITE_HERO_IMAGE_URL` and `VITE_BANNER_IMAGE_URL` can point to public image/animation assets served by Vite. The frontend uses illustration fallbacks when a configured image is missing or fails to load.

### 4. Start frontend and backend

Open two terminals at the project root:

```powershell
# Terminal 1
npm run dev:server
```

```powershell
# Terminal 2
npm run dev:client
```

Open `http://localhost:5173` for the Vite frontend. By default, the backend listens on port `5000`; `GET http://localhost:5000/health` reports application and database connectivity information. If you change the backend port, verify the frontend's development API/proxy configuration accordingly.

## Database setup and seeders

The project contains **three separate catalogue seeders**. They are not all run by `npm run seed`.

| Seeder | Defines | Invocation behavior |
| --- | --- | --- |
| `seedDatabase.js` | **21 ingredients**: 5 bases, 5 sauces, 3 cheeses, 8 vegetables; **4 vegetarian pizzas** | `npm run seed` attempts insertions/validation against an approved local DB |
| `seedVeganPizzas.js` | **Vegan Mozzarella** and **3 vegan pizzas**: Vegan Garden, Spicy Vegan Delight, Vegan Mediterranean | Dry run by default; `--apply` enables writes |
| `seedNonVegetarianPizzas.js` | **3 protein ingredients** (Chicken, Pepperoni, Sausage) and **3 non-vegetarian pizzas**: BBQ Chicken Supreme, Pepperoni Classic, Meat Lovers Special | Dry run by default; `--apply` enables writes; depends on model support for `protein`/`proteins` |

The main seeder defines Margherita Classic, Veggie Supreme, Mediterranean, and Spicy Veggie. It preserves existing ingredient stock/prices and reports conflicting presets instead of overwriting their recipes.

### Main catalogue (run first)

Set a local, explicitly approved database in `server/.env`, for example:

```dotenv
NODE_ENV=development
MONGODB_URI=mongodb://127.0.0.1:27017/pizzadelivery
SEED_DB_NAME=pizzadelivery
```

Ensure the target is disposable/approved for the demonstration and review existing records before modifying them. The main seeder blocks production, remote MongoDB hosts, and database-name mismatches.

```powershell
npm run seed
```

### Optional vegan and non-vegetarian catalogues

From the **project root**, use the explicit environment-file loader:

```powershell
# Preview proposed operations (no writes)
node --env-file=server/.env server/src/scripts/seedVeganPizzas.js
node --env-file=server/.env server/src/scripts/seedNonVegetarianPizzas.js
```

Only after confirming the connected database, recipes and model compatibility should you intentionally apply a seeder:

```powershell
node --env-file=server/.env server/src/scripts/seedVeganPizzas.js --apply
node --env-file=server/.env server/src/scripts/seedNonVegetarianPizzas.js --apply
```

**Important safety difference:** `seedNonVegetarianPizzas.js` checks development mode, a loopback MongoDB host, the approved `SEED_DB_NAME`, and the actual connection. `seedVeganPizzas.js` does **not** implement the same explicit target allowlist; its `--apply` operates against the configured `MONGODB_URI`. Do not run it with write permissions until you have independently verified that target. Use dry runs and test against disposable data before relying on optional seeders.

## Administrator provisioning

Administrator registration is deliberately **not** exposed as a public sign-up option. The private `createAdmin.js` CLI reads `ADMIN_EMAIL` and `ADMIN_PASSWORD` from the environment, creates a verified admin if missing, and can rotate an existing admin's password (invalidating previous sessions).

After setting private credentials and confirming the intended database:

```powershell
node --env-file=server/.env server/src/scripts/createAdmin.js
```

Customer registration happens through the application and uses email verification; the admin uses the separate sign-in endpoint.

## API reference

The following routes are derived from the Express route modules in `server/src/routes/`. Most customer-facing data endpoints require authentication; mutations additionally require CSRF protection. Administrator endpoints require the admin role.

### Authentication — `/api/auth`

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/csrf-token` | Issue a CSRF token |
| `POST` | `/register` | Create a customer account |
| `POST` | `/verify-email` | Verify email with a one-time token |
| `POST` | `/resend-verification` | Request another verification email |
| `POST` | `/login` | Customer sign-in |
| `POST` | `/admin-login` | Administrator sign-in |
| `POST` | `/logout` | Sign out |
| `GET` | `/me` | Read authenticated account details |
| `PATCH` | `/me` | Update profile fields |
| `POST` | `/forgot-password` | Request a password-reset email |
| `POST` | `/reset-password` | Reset password with a one-time token |

### Catalogue, orders and payments

| Method | Full endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Health and MongoDB connectivity report |
| `GET` | `/api/v1/ingredients` | Active ingredients grouped by category; public response omits stock totals |
| `GET` | `/api/v1/pizzas` | Active, validated pizza presets with server-calculated prices/availability |
| `POST` | `/api/v1/orders/quote` | Price and availability quote without reserving stock |
| `POST` | `/api/v1/orders` | Create customer order with inventory reservation |
| `GET` | `/api/v1/orders` | Paginated current-customer order history |
| `GET` | `/api/v1/orders/:orderId` | Current-customer order details |
| `POST` | `/api/v1/payments/initiate` | Create or safely reuse a Razorpay payment order |
| `POST` | `/api/v1/payments/verify` | Verify payment and reconcile the order/inventory state |

Order creation requires an `Idempotency-Key` HTTP header (16–64 letters, numbers, underscores or hyphens). The quote endpoint accepts lines containing either `pizzaId` or `recipe`; order creation accepts `pizzaId` or `customRecipe`. Both require a quantity. Actual request/response validation is in the corresponding route files.

### Administration — `/api/admin`

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/dashboard/stats` | Dashboard summary |
| `GET` | `/pizzas` | Administrative pizza catalogue |
| `POST` | `/pizzas` | Add a pizza |
| `PUT` | `/pizzas/:pizzaId` | Update a pizza |
| `PATCH` | `/pizzas/:pizzaId/status` | Activate/deactivate a pizza |
| `POST` | `/pizzas/:pizzaId/image` | Upload/replace image |
| `DELETE` | `/pizzas/:pizzaId/image` | Remove image |
| `GET` | `/ingredients` | Inventory details |
| `PATCH` | `/ingredients/:ingredientId/stock` | Update stock |
| `PATCH` | `/ingredients/:ingredientId/threshold` | Change low-stock threshold |
| `GET` | `/orders` | Recent orders |
| `GET` | `/orders/:orderId` | Order details |
| `PATCH` | `/orders/:orderId/status` | Advance eligible order to `in_kitchen` or `sent_to_delivery` |

The image upload field name is `image`. Uploaded catalogue images are served at `/uploads/...` from `server/uploads/` outside tests.

## Order, payment and inventory lifecycle

1. **Quote:** The server calculates prices from ingredients and checks aggregate cart availability without changing stock.
2. **Order creation:** An authenticated customer submits line items and an idempotency key. A MongoDB transaction creates the order and reserves the required quantities.
3. **Reservation hold:** The reservation service uses a **15-minute** hold. A background worker checks for expiration every **30 seconds** and releases eligible unpaid holds.
4. **Payment:** Razorpay initiation is protected by order ownership checks, gateway locks and reconciliation rules. Verification checks the signed payment response and coordinates order state with inventory commitment.
5. **Fulfilment:** Valid progression is `pending_payment` → `received` → `in_kitchen` → `sent_to_delivery`. An unpaid order may become `expired`. The code also contains a controlled recovery path for payments captured after expiry.
6. **Notifications:** The backend emits `order:updated` to the owning customer's Socket.IO room when a supported order status changes. A low-stock scheduler checks inventory hourly by default and can email configured administrators.

Payment sub-statuses in the `Order` model include `pending_gateway`, `created`, `paid`, and `paid_after_expiry`. Captured late-payment cases that cannot safely reserve inventory again can require manual refund review; there is no public refund-management UI established by the reviewed files.

## Testing and build

Backend tests run in **Node**, while frontend component tests use the React/Vite plugin with **jsdom**.

```powershell
# Backend models, APIs and integration suites
npm run test:backend

# Frontend components
npm run test:frontend

# Both (frontend runs only if backend succeeds)
npm test

# Frontend production bundle
npm run build:client
```

Additional scripts include `npm run test:integration`, `npm run test:watch`, and `npm run test:coverage`. The frontend build output is `client/dist/` and should not be committed. The test suite contains negative-path tests that intentionally log validation errors; rely on the final Vitest summary when judging success. No complete passing result is asserted in this document.

## Images and deployment notes

- **Frontend assets:** `client/public/` contains logos, promotional images and optional animated imagery.
- **Catalogue uploads:** `server/uploads/` holds pizza images and may be committed for an internship demo **only after verifying every image is intended for public distribution**.
- **Test isolation:** `server/test-uploads/`, `node_modules/`, coverage, build output and environment secrets are excluded from Git.
- **Persistence:** Hosted deployments should use durable storage for user-generated images rather than relying on an ephemeral local filesystem.
- **Production readiness:** Review trusted proxy settings, CSRF/CORS origins, secrets, SMTP delivery, payment credentials, database transactions, upload retention, and complete regression results before public deployment.

---

**Internship:** OASIS INFOBYTE (OIBSIP) · Web Development Level 3  
**Project:** SUNNYS Pizza — Pizza Delivery Application  
**Declared package license:** ISC (`package.json`)
