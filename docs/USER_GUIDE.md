# ZPP Gold Trading User Guide

This guide explains how to use ZPP Gold Trading for daily rate setting, buying, inventory control, liquidation, refining, retail sales, customer records, reports, and user administration.

> **Important:** Internet prices are reference inputs. Verify the metal, purity, weight, deductions, buying rate, and payout before confirming a high-value transaction.

## Contents

1. [System overview](#1-system-overview)
2. [Signing in and user roles](#2-signing-in-and-user-roles)
3. [Recommended daily workflow](#3-recommended-daily-workflow)
4. [Dashboard and reports](#4-dashboard-and-reports)
5. [Daily rate setup](#5-daily-rate-setup)
6. [Buying transactions](#6-buying-transactions)
7. [Inventory](#7-inventory)
8. [Liquidation](#8-liquidation)
9. [Refining tracking](#9-refining-tracking)
10. [Limited retail sales](#10-limited-retail-sales)
11. [Customer management](#11-customer-management)
12. [User accounts](#12-user-accounts)
13. [Editing, deleting, and audit safety](#13-editing-deleting-and-audit-safety)
14. [Exports, receipts, and printing](#14-exports-receipts-and-printing)
15. [Troubleshooting](#15-troubleshooting)
16. [Administrator setup](#16-administrator-setup)

## 1. System overview

ZPP Gold Trading is a transaction and inventory ledger for Gold, Silver, and Platinum. Its normal data flow is:

```text
Daily Rate Setup
       ↓
Buying Transaction → Customer record → Inventory
                                       ├─→ Liquidation
                                       ├─→ Refining → New refined inventory item
                                       └─→ Limited Retail Sale
```

Amounts are displayed in Philippine pesos (PHP), and weights are entered in grams.

### Main navigation

| Page | Purpose | Staff | Admin |
|---|---|:---:|:---:|
| Dashboard & reports | View daily/monthly totals | Summary only | Full reports and exports |
| Daily rate setup | View rates and override a grade | Yes | Full rate administration |
| Buying transactions | Record one or more purchased items | Yes | Yes |
| Inventory | Search and view stock | Yes | Full stock actions and edits |
| Liquidation | Manage open buyer batches and record completed sales | No | Yes |
| Refining tracking | Combine processed items into one refined item | No | Yes |
| Limited retail sales | Sell eligible jewelry inventory | No | Yes |
| Customer management | Add, search, and view customers | Yes | Plus edit/delete |
| User accounts | Create and manage logins | No | Yes |

## 2. Signing in and user roles

1. Open the website in a supported browser.
2. Enter your **Username** and **Password**.
3. Select **Sign in**.
4. Check the access badge in the upper-right corner. It shows either **ADMIN ACCESS** or **STAFF ACCESS**.
5. When finished, select **Sign out** at the bottom of the navigation area.

The login session lasts up to 12 hours. If the session expires while the site is open, sign in again before continuing.

### Initial local accounts

On a brand-new database, the application creates these accounts unless different passwords were configured before the first start:

| Role | Username | Initial password |
|---|---|---|
| Admin | `admin` | `Admin@123` |
| Staff | `staff` | `Staff@123` |

Change these passwords before production use. An administrator can reset a password from **User accounts**.

### Staff limitations

Staff may view active rates, override individual grade prices, record purchases, view inventory, and manage customer information. Staff cannot change base-rate formulas, edit or delete existing ledger records, liquidate or refine stock, record retail sales, export administrator reports, or manage user accounts.

## 3. Recommended daily workflow

### Start of day

1. Sign in as an administrator.
2. Open **Daily rate setup**.
3. Confirm the effective date and the latest market-check time.
4. Verify the Gold, Silver, and Platinum buying rates.
5. If required, set today's PHP base rates or grade overrides.
6. Save the day's rate sheet for the audit history.

### During buying operations

1. Open **Buying transactions**.
2. Enter the seller, date, and payment method.
3. Add each item to the current payout.
4. Review the combined total.
5. Confirm the transaction and print a receipt when needed.

Cash on hand carries forward automatically. A new Philippine business date starts with the previous recorded day's final balance instead of resetting to zero. Cash purchases and administrator adjustments made on the new date then update that carried balance.

### Inventory processing

1. Open **Inventory** and filter the relevant stock.
2. Categorize on-hand items as **Available**, **For Refining**, or **On Hold**.
3. Send eligible items to the appropriate next workflow:
   - **Liquidation** to assign stock to an in-transit buyer batch;
   - **Refining tracking** for consolidation into a refined item; or
   - **Limited retail sales** for jewelry sold to a retail buyer.

### End of day

1. Review Dashboard totals and purchase records.
2. Confirm pending liquidation payment statuses.
3. Export any CSV ledgers needed for backup or reconciliation.

## 4. Dashboard and reports

The Dashboard shows:

- number and payout value of today's purchases;
- active inventory amount and weight for the current month;
- number and payout value of the current month's purchases; and
- for administrators, monthly liquidation and retail margins.

Administrators can open these panels under **Dashboard records**:

- **Purchase history:** filter by date, search records, view receipts, group totals by customer, and download a purchase CSV.
- **Liquidation history:** filter by date, search batches, open batch details, review cost/proceeds/profit, and download a liquidation CSV.
- **Liquidation readiness:** view on-hand inventory currently classified as **Available** or **For Refining**.

Select an active report button again to close that report.

To download other ledgers, expand **Export ledger data** and choose Inventory, Liquidation, Refining, Retail sales, Customers, or Rate history.

## 5. Daily rate setup

### Understand the rate hierarchy

For a purchase, the system uses rates in this order:

1. an exact grade override, if one exists;
2. today's configured PHP base and calculation rule; or
3. the active internet-derived base rate.

The Buying page still allows a one-transaction rate adjustment. That transaction-level adjustment does not change the shared Daily Rate Setup.

### Automatic pricing

The administrator view displays PHP-per-gram market prices for Gold, Silver, and Platinum. When automatic updates are enabled, the application checks market pricing every five seconds while the page is open and visible.

To refresh manually, select **Refresh & apply now**. If the price service is unavailable, the current rates remain unchanged.

### Set today's exact base rate (Admin)

1. Select **Edit today's PHP base**.
2. Choose Gold, Silver, or Platinum.
3. Enter the PHP-per-gram base rate.
4. For Silver, also enter the separate 925 basis rate.
5. Review the preview and select **Save today's base rate**.

Gold grades are calculated from the Gold base using saved multipliers. Silver 999 is independent; Silver 900, 800, 75%, and 60% are calculated from the 925 basis. Platinum grades are calculated from the Platinum base using the application's grade rules.

### Change Gold multipliers (Admin)

1. Select **Edit Gold multipliers**.
2. Enter a multiplier for each grade (for example, `0.750` represents 75% of the base).
3. Select **Save multipliers**.

Use **Reset multipliers** only when you intend to restore all original Gold calculation values.

### Override one grade (Admin or Staff)

1. Find the required metal and grade card.
2. Select **Override PHP rate**.
3. Enter the exact PHP-per-gram amount and confirm the field change.
4. The card is marked **overridden**.

The override remains active until someone selects **reset PHP rate**. Resetting returns the grade to its calculated rate.

### Save the rate sheet (Admin)

1. Set the **Effective date**.
2. Enter the name of the person responsible under **Entered by**.
3. Select **Save rate sheet**.

Rates take effect as soon as they are changed. Saving the sheet creates an audit-history snapshot; it is not required to activate the rates.

## 6. Buying transactions

The Buying page supports several items in one customer payout. The in-progress payout is saved as a draft for the signed-in user.

### Cashflow card

The top of the Buying page shows today's live cash position:

- **Cash on hand:** the latest Admin-set physical cash balance minus later purchases paid by Cash;
- **Bought today:** total payouts across all payment methods;
- **Cash paid today:** purchases that reduce physical cash; and
- **Non-cash today:** Bank transfer and GCash purchases, which do not reduce physical cash.

The daily cash-movement strip shows **IN** and **OUT** totals. IN is the sum of manual **Add cash** adjustments. OUT is the sum of purchases paid by Cash plus manual **Deduct cash** adjustments. **Set exact balance** is treated as a reconciliation and is not counted as cash movement.

Select **View cash flow** to open the transaction ledger. Use **Retrieve cashflow date**, **Previous day**, or **Next day** to reopen an older day's saved cash balance, purchases, and Admin adjustments. Historical viewing is read-only and does not replace today's balance. The ledger shows the seller, purchased items, payment method, payout, cash effect, and running balance. Use the search field to match any visible transaction or adjustment text, including seller, item, payment method, amount, action, note, Admin, or time. Each ledger is scrollable and displays up to 50 matching records before showing Previous and Next page controls. Today's balance refreshes approximately every five seconds and immediately after a successful purchase.

Only an administrator can select **Set cash on hand** or **Edit cash on hand**. The editor provides three actions:

- **Set exact balance** replaces the current cash-on-hand figure;
- **Add cash** records incoming physical cash and increases the balance; and
- **Deduct cash** records a manual cash expense or transfer and decreases the balance.

The administrator can attach an optional note to every adjustment. Select **View Admin cash adjustments** from the cashflow modal to open the separate adjustment-history modal. It provides its own search and a scrollable list of up to 50 records before Previous and Next controls appear. The history records the action, amount, resulting balance, note, Admin name, and time. Purchases paid by Cash after the latest adjustment are deducted automatically. Staff can view the same live figures and adjustment history but cannot change the balance.

Select **Reset IN / OUT** and confirm to restart only the daily movement counters at PHP 0. This does not change Cash on Hand, purchase totals, inventory, or earlier audit records. Cash added, deductions, and cash purchases recorded after the reset begin increasing the counters again.

### Step 1: Customer information

1. Enter the customer's name, or leave it blank for a walk-in seller.
2. Confirm the purchase date.
3. Choose **Cash**, **Bank transfer**, or **GCash**.

If the entered name exactly matches an existing customer (ignoring capitalization), the transaction is linked to that customer. A new nonblank name automatically creates a basic customer record.

### Step 2: Add an item

1. Choose **Gold**, **Silver**, or **Platinum**.
2. Choose **Scrap** or **Jewelry**.
3. Choose the karat/purity. For an unlisted value, choose **Custom purity (%)** and enter a value from 0.01 to 100.
4. Enter **Gross weight (g)**.
5. Enter any **Deductions (g)**.

The system calculates:

```text
Net weight = Gross weight − Deductions
Calculated amount = Net weight × Buying rate
```

6. Review the buying rate. You may change it for this item only; select **Use daily rate** to undo that change.
7. Leave **Final payout** blank to use the calculated amount, or enter an agreed amount.
8. Under **More details**, optionally enter the staff name, initial status, and remarks.
9. Select **Add this item**.

### Complete the payout

1. Review every item under **Current payout**.
2. Remove an incorrect item or select **Add another item** as needed.
3. Select **Proceed to payout**.
4. Check the seller, date, payment method, item calculations, total weight, and grand total.
5. Select:
   - **Record only** to save without opening a receipt; or
   - **Confirm & view receipt** to save and open the receipt preview.

After successful confirmation, each purchased item becomes a separate inventory record with its payout carried as inventory cost.

## 7. Inventory

Inventory contains purchased stock and any output created by refining.

### Browse and filter

- Choose a day in the weekly date selector, or select all purchase dates.
- Use the metal tabs to focus on Gold, Silver, or Platinum.
- Search by customer, date, metal, purity, status, staff, or remarks.
- Select **Change filters** to filter by metal, purity, item type, and status.

### Inventory statuses

| Status | Meaning |
|---|---|
| Available | On hand and available for liquidation or retail sale when otherwise eligible |
| For Liquidation | Assigned to an open buyer batch and excluded from Current Inventory |
| For Refining | Available for liquidation or refining |
| On Hold | Kept out of liquidation/refining selection |
| Liquidated | Fully released through a completed liquidation |
| Refined | Consumed as an input to a refining batch |
| Sold | Sold through the retail-sales workflow |

### Administrator stock actions

An administrator can select records and:

- apply a new category to all selected records;
- move selected records into a named Liquidation batch;
- combine eligible records from chosen dates into one liquidation batch;
- send selected **For Refining** records to Refining; or
- edit an individual inventory record.

Liquidation and refining batches contain only one metal. A liquidation selection may include Gold, Silver, and Platinum together; the system automatically separates the selection into one batch per metal.

Creating a Liquidation batch changes each included item to **For Liquidation**. Its weight and carrying cost are preserved, but it is excluded from every Current Inventory list and total until sold or returned.

## 8. Liquidation

### Prepare the batch

1. In **Inventory**, select eligible records or select **Liquidate item** for one record.
2. Select **Move selected to liquidation**.
3. Review the metal, dates, weight, and cost.
4. Continue to the batch details.
5. Confirm or edit the suggested batch name.
6. Assign a buyer and optional notes to each metal batch.
7. Select **Create batch**.

The workflow moves the full available weight of every selected record. Multiple open batches can exist at the same time, and every batch has its own buyer.

### Review open batches

Each batch displays its item breakdown, item count, total weight, and carrying cost. You can select Gold and Silver together; the system automatically creates a separate batch for each metal so every batch can have its own buyer. Use **Edit batch** to change its name, buyer, or notes. Use **Return to Inventory** to restore every item to its previous on-hand status.

When recording a batch sale, enter the final **Total sold** amount. The modal immediately shows the profit or loss and profit margin; positive results are green and losses are red.

### Record the liquidation

1. Open the required batch and select **Record sale**.
2. Confirm the sale date.
3. Choose **Pending**, **Partially Paid**, or **Paid**.
4. Confirm or enter the final **Total sold (PHP)** amount.
5. Add optional final notes.
6. Select **Record liquidation**.

The system allocates the batch proceeds across the selected items, removes their available weight and cost, and assigns an ID such as `L-0001`. Fully released items become **Liquidated**.

## 9. Refining tracking

Only inventory classified as **For Refining** is available here.

1. Choose the metal.
2. Check all input items that will become one refined item.
3. Review total input weight and combined inventory cost.
4. Choose the output purity/karat.
5. Enter the final refined weight returned to inventory.
6. Select **Combine into one item**.
7. Review the confirmation and select **Confirm & create one item**.

The input records become **Refined** with zero available weight. The system creates one new **Available** scrap inventory item. Its cost equals the combined cost of the input items, and its per-gram rate is derived from that carried cost and the output weight.

The current simplified workflow records the refiner as **In-house refining**, uses the current date, and carries zero separate refining charges.

## 10. Limited retail sales

Retail sales are limited to inventory that is both:

- item type **Jewelry**; and
- status **Available** with available weight.

To record a sale:

1. Choose the item.
2. Enter the buyer name, or leave it blank to use **Walk-in**.
3. Confirm the sale date.
4. Enter the sale price.
5. Select **Record sale**.

The entire item's available weight is sold; partial retail sales are not supported. The item becomes **Sold**, and the system calculates margin as sale price minus inventory cost.

Use **Summary** in Retail sales history to open a printable transaction summary.

## 11. Customer management

### Add a customer

1. Enter the customer's name.
2. Add optional contact information and notes.
3. Select **Save customer**.

### Find and review a customer

Use the search field to match a name or contact detail. Select **View history** to see purchases, weights, payouts, and current statuses linked to that customer.

Administrators can edit customer information. If an administrator deletes a customer, historical purchase records remain and keep the saved customer name, but the live customer link is removed.

## 12. User accounts

Only administrators can open this page.

### Create an account

1. Enter the account holder's name.
2. Create a username.
3. Enter a temporary password of at least eight characters.
4. Choose **Staff** or **Admin**.
5. Select **Create account**.

### Manage an account

Select **Edit** beside an account to:

- change the display name;
- change the role;
- enable or disable the account; or
- reset the password.

Usernames cannot be changed. A disabled user loses access on the next server request. You cannot delete the account you are currently using.

## 13. Editing, deleting, and audit safety

Existing-record editing is administrator-only. Use **Edit** beside a record in the relevant history or inventory table.

The system deliberately locks key source fields—such as original metal, purity, purchase weight, rate, and payout—to preserve the audit trail.

Deletion may be blocked when a record is used by a later transaction. Reverse transactions from newest to oldest. For example:

1. delete a retail sale, refining batch, or liquidation that uses the item;
2. verify the stock was restored; and
3. only then delete the original inventory record if still required.

Read every deletion confirmation carefully. A failed server save rolls back sensitive liquidation and refining changes, but users should still verify the ledger after any connection error.

## 14. Exports, receipts, and printing

### Buying receipts

From the purchase confirmation or Purchase history:

1. open **Receipt**;
2. choose 58 mm or 80 mm thermal paper;
3. select **Print receipt**; and
4. confirm the browser's printer and paper settings.

### CSV exports

CSV files download through the browser and can be opened in Excel, Google Sheets, or another spreadsheet program. Available exports include:

- purchase history;
- inventory;
- liquidation history;
- refining history;
- retail sales;
- customers; and
- rate history.

CSV exports reflect the active date range where the report provides date filters.

## 15. Troubleshooting

### “Sign in required” or the login page returns

The session may have expired, the account may have been disabled, or the server may have restarted. Sign in again. Ask an administrator to confirm the account is active if the problem continues.

### Live pricing is unavailable

Keep the current rates unchanged, verify the network connection, and try **Refresh & apply now** again. An administrator can enter today's PHP base manually. Independently verify rates before making a payout.

### “The database changed in another session”

Another user saved a change first. Refresh the browser, verify the latest ledger state, and repeat your change. Do not blindly re-enter a transaction without checking whether it was already recorded.

### A purchased item does not appear in Retail

Confirm that the inventory item type is **Jewelry**, its status is **Available**, and it has available weight.

### An item does not appear in Refining

Confirm that its status is **For Refining** and it has available weight. Items in an open Liquidation batch are excluded automatically.

### A button is missing

Check the access badge. Staff accounts intentionally do not see administrator-only modules or edit controls.

### Changes may not persist

If the site reports a save failure, stop entering new transactions until the server/database connection is restored. Refresh and compare the ledger before trying again.

## 16. Administrator setup

### Run locally

Requirements: a current Node.js version with `node:sqlite` support and npm.

```bash
npm install
npm run build
npm start
```

Open `http://127.0.0.1:4177`.

For development with TypeScript source execution:

```bash
npm install
npm run dev
```

Without remote-database variables, data is stored locally at `data/zpp-gold-trading.db`.

### Environment variables

Copy `.env.example` to `.env.local` and set values appropriate for the environment:

| Variable | Purpose |
|---|---|
| `TURSO_DATABASE_URL` | Turso/libSQL database URL for persistent hosted storage |
| `TURSO_AUTH_TOKEN` | Token for that Turso database |
| `ZPP_UPSTREAM_URL` | Optional deployed ZPP server whose API should be used by localhost |
| `ZPP_SESSION_SECRET` | Secret used to sign login sessions |
| `ZPP_ADMIN_PASSWORD` | Initial Admin password on a new users table |
| `ZPP_STAFF_PASSWORD` | Initial Staff password on a new users table |
| `ZPP_PORT` | Optional local port; defaults to `4177` |

`ZPP_ADMIN_PASSWORD` and `ZPP_STAFF_PASSWORD` only affect the automatically created accounts when the users table is empty. Changing these variables later does not reset an existing account.

### Production checklist

- Use Turso or another configured persistent upstream; Vercel's temporary filesystem is not persistent storage.
- Set a long, random `ZPP_SESSION_SECRET`.
- Replace both initial passwords before the first production start.
- Keep `.env.local`, database tokens, passwords, and database files out of source control.
- Confirm `/api/health` reports the expected database mode and persistence status.
- Test sign-in, rate refresh, one sample purchase, and CSV export before live use.
- Establish a regular database backup and reconciliation process.
