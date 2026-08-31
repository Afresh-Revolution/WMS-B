# Accountant API Endpoints

This file lists the backend endpoints available to the Accountant section.

Default API base: `/api/v1/accountant`

Legacy alias: `/api/accountant`

Authentication header for protected routes:

```http
Authorization: Bearer <access_token>
Content-Type: application/json
```

All Accountant routes require an authenticated user with `role = accountant` or Super Admin override. Records are scoped to the accountant's organization where an organization is present. The Accountant backend does not grant user, role, permission, system, security, HR, Manager, or Secretary management access.

List endpoints support `page`, `limit`, `q`, `search`, `sortBy`, `sortDirection`, `dateFrom`, and `dateTo`.

## Scope And Dashboard

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/accountant/scope` | Return organization scope and Accountant navigation |
| GET | `/api/v1/accountant/dashboard` | Return payroll, bills, expenses, purchases, vendors, payment, queue, and report metrics |
| GET | `/api/v1/accountant/dashboard/stats` | Return Accountant dashboard metric counts only |

## Profile, Employment Record, Settings

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/accountant/profile` | Return Accountant profile and linked employee record |
| PATCH | `/api/v1/accountant/profile` | Update safe self-profile fields only |
| PUT | `/api/v1/accountant/profile` | Alias for updating safe self-profile fields |
| GET | `/api/v1/accountant/employment-record` | Return Accountant self employment record, documents, salary assignments, and payment references |
| GET | `/api/v1/accountant/employment-record/documents` | Return Accountant self documents |
| PATCH | `/api/v1/accountant/employment-record` | Update safe self-service fields only |
| PUT | `/api/v1/accountant/employment-record` | Alias for updating safe self-service fields |
| GET | `/api/v1/accountant/settings` | Return personal preferences |
| PATCH | `/api/v1/accountant/settings` | Update personal preferences only |
| GET | `/api/v1/accountant/help-center` | Return Accountant workflow help mapped to backend routes |

## Payroll And Salary

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/accountant/payroll` | List payroll mirror records |
| GET | `/api/v1/accountant/payroll/dashboard` | Return payroll finance metrics |
| GET | `/api/v1/accountant/payroll/periods` | List payroll periods |
| GET | `/api/v1/accountant/payroll/runs` | List payroll runs |
| GET | `/api/v1/accountant/payroll/runs/:id` | Get one payroll run |
| GET | `/api/v1/accountant/payroll/runs/:id/items` | List payroll run items |
| GET | `/api/v1/accountant/payroll/payments` | List payroll payment rows |
| GET | `/api/v1/accountant/payroll/payslips` | List payslips |
| GET | `/api/v1/accountant/payroll/deductions` | List employee deductions |
| POST | `/api/v1/accountant/payroll/deductions` | Create an employee deduction |
| PATCH | `/api/v1/accountant/payroll/deductions/:id` | Update an employee deduction |
| GET | `/api/v1/accountant/salary-implementations` | List salary adjustments awaiting implementation |
| POST | `/api/v1/accountant/salary-implementations` | Create a salary implementation record |
| PATCH | `/api/v1/accountant/salary-implementations/:id/implement` | Mark salary implementation as completed |

## Purchases, Bills, Invoices, Expenses

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/accountant/purchase-requests` | List purchase requests visible to finance |
| GET | `/api/v1/accountant/purchase-orders` | List purchase orders visible to finance |
| POST | `/api/v1/accountant/purchase-orders/:id/payments` | Record a purchase order payment |
| GET | `/api/v1/accountant/bills` | List bills |
| POST | `/api/v1/accountant/bills` | Create a bill |
| GET | `/api/v1/accountant/bills/:id` | Get one bill |
| PATCH | `/api/v1/accountant/bills/:id` | Update one bill |
| POST | `/api/v1/accountant/bills/:id/payments` | Record a bill payment |
| GET | `/api/v1/accountant/invoices` | List invoices |
| POST | `/api/v1/accountant/invoices` | Create an invoice |
| PATCH | `/api/v1/accountant/invoices/:id` | Update an invoice |
| GET | `/api/v1/accountant/expenses` | List expenses |
| POST | `/api/v1/accountant/expenses/:id/reimburse` | Record an expense reimbursement |

## Vendors, Payments, Reports

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/accountant/vendors` | List vendor directory |
| GET | `/api/v1/accountant/vendors/:id` | Get one vendor |
| GET | `/api/v1/accountant/payments` | List unified payment register |
| POST | `/api/v1/accountant/payments` | Record a manual/general payment |
| PATCH | `/api/v1/accountant/payments/:id/reconcile` | Reconcile a manual/general payment |
| GET | `/api/v1/accountant/payments/export` | Export payment register CSV |
| GET | `/api/v1/accountant/reports` | Return financial report summaries |
| GET | `/api/v1/accountant/reports/summary` | Return summary totals only |
| GET | `/api/v1/accountant/reports/export` | Export finance report CSV |

## Notifications And Audit

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/accountant/notifications` | List Accountant notifications |
| PATCH | `/api/v1/accountant/notifications/:id/read` | Mark one notification as read |
| GET | `/api/v1/accountant/audit-logs` | List finance-scoped operational audit logs |

## Legacy Alias

The same endpoints are also mounted under `/api/accountant`. For example:

| API v1 endpoint | Legacy alias |
| --- | --- |
| `/api/v1/accountant/dashboard` | `/api/accountant/dashboard` |
| `/api/v1/accountant/payments` | `/api/accountant/payments` |
| `/api/v1/accountant/bills/:id/payments` | `/api/accountant/bills/:id/payments` |
