# Accountant API Endpoints

This file lists every backend endpoint available to the Accountant section.

Default API base: `/api/v1/accountant`

Legacy alias: `/api/accountant`

Authentication header for protected routes:

```http
Authorization: Bearer <access_token>
Content-Type: application/json
```

All Accountant routes require an authenticated user with `role = accountant`, or a Super Admin override. Records are scoped to the accountant's organization where an organization is present. The Accountant backend does not grant user, role, permission, system, security, HR, Manager, or Secretary management access.

List endpoints support the existing pagination and filter query parameters where applicable: `page`, `limit`, `q`, `search`, `sortBy`, `sortDirection`, `dateFrom`, and `dateTo`.

## Complete Endpoint Matrix

| Method | API v1 endpoint | Legacy alias | Purpose |
| --- | --- | --- | --- |
| GET | `/api/v1/accountant/scope` | `/api/accountant/scope` | Return organization scope and Accountant navigation |
| GET | `/api/v1/accountant/dashboard` | `/api/accountant/dashboard` | Return payroll, bills, expenses, purchases, vendors, payment, queue, and report metrics |
| GET | `/api/v1/accountant/dashboard/stats` | `/api/accountant/dashboard/stats` | Return Accountant dashboard metric counts only |
| GET | `/api/v1/accountant/profile` | `/api/accountant/profile` | Return Accountant profile and linked employee record |
| PATCH | `/api/v1/accountant/profile` | `/api/accountant/profile` | Update safe self-profile fields only |
| PUT | `/api/v1/accountant/profile` | `/api/accountant/profile` | Alias for updating safe self-profile fields |
| GET | `/api/v1/accountant/employment-record` | `/api/accountant/employment-record` | Return Accountant self employment record, documents, salary assignments, and payment references |
| GET | `/api/v1/accountant/employment-record/documents` | `/api/accountant/employment-record/documents` | Return Accountant self documents |
| PATCH | `/api/v1/accountant/employment-record` | `/api/accountant/employment-record` | Update safe self-service fields only |
| PUT | `/api/v1/accountant/employment-record` | `/api/accountant/employment-record` | Alias for updating safe self-service fields |
| GET | `/api/v1/accountant/settings` | `/api/accountant/settings` | Return personal preferences |
| PATCH | `/api/v1/accountant/settings` | `/api/accountant/settings` | Update personal preferences only |
| GET | `/api/v1/accountant/help-center` | `/api/accountant/help-center` | Return Accountant workflow help mapped to backend routes |
| GET | `/api/v1/accountant/attendance/locations` | `/api/accountant/attendance/locations` | List assigned active GPS check-in locations without exposing precise coordinates |
| GET | `/api/v1/accountant/attendance/status` | `/api/accountant/attendance/status` | Return current server-side GPS check-in availability and policy |
| POST | `/api/v1/accountant/attendance/check-in` | `/api/accountant/attendance/check-in` | Submit a fresh browser location reading for backend geofence verification |
| GET | `/api/v1/accountant/attendance/history` | `/api/accountant/attendance/history` | List the authenticated accountant's GPS check-ins |
| GET | `/api/v1/accountant/payroll` | `/api/accountant/payroll` | List payroll mirror records |
| GET | `/api/v1/accountant/payroll/dashboard` | `/api/accountant/payroll/dashboard` | Return payroll finance metrics |
| GET | `/api/v1/accountant/payroll/periods` | `/api/accountant/payroll/periods` | List payroll periods |
| GET | `/api/v1/accountant/payroll/runs` | `/api/accountant/payroll/runs` | List payroll runs |
| GET | `/api/v1/accountant/payroll/runs/:id` | `/api/accountant/payroll/runs/:id` | Get one payroll run |
| GET | `/api/v1/accountant/payroll/runs/:id/items` | `/api/accountant/payroll/runs/:id/items` | List payroll run items |
| GET | `/api/v1/accountant/payroll/payments` | `/api/accountant/payroll/payments` | List payroll payment rows |
| GET | `/api/v1/accountant/payroll/payslips` | `/api/accountant/payroll/payslips` | List payslips |
| GET | `/api/v1/accountant/payroll/deductions` | `/api/accountant/payroll/deductions` | List employee deductions |
| POST | `/api/v1/accountant/payroll/deductions` | `/api/accountant/payroll/deductions` | Create an employee deduction |
| PATCH | `/api/v1/accountant/payroll/deductions/:id` | `/api/accountant/payroll/deductions/:id` | Update an employee deduction |
| GET | `/api/v1/accountant/salary-implementations` | `/api/accountant/salary-implementations` | List salary adjustments awaiting implementation |
| POST | `/api/v1/accountant/salary-implementations` | `/api/accountant/salary-implementations` | Create a salary implementation record |
| PATCH | `/api/v1/accountant/salary-implementations/:id/implement` | `/api/accountant/salary-implementations/:id/implement` | Mark salary implementation as completed |
| GET | `/api/v1/accountant/purchase-requests` | `/api/accountant/purchase-requests` | List purchase requests visible to finance |
| GET | `/api/v1/accountant/purchase-orders` | `/api/accountant/purchase-orders` | List purchase orders visible to finance |
| POST | `/api/v1/accountant/purchase-orders/:id/payments` | `/api/accountant/purchase-orders/:id/payments` | Record a purchase order payment |
| GET | `/api/v1/accountant/bills` | `/api/accountant/bills` | List bills |
| POST | `/api/v1/accountant/bills` | `/api/accountant/bills` | Create a bill |
| GET | `/api/v1/accountant/bills/:id` | `/api/accountant/bills/:id` | Get one bill |
| PATCH | `/api/v1/accountant/bills/:id` | `/api/accountant/bills/:id` | Update one bill |
| POST | `/api/v1/accountant/bills/:id/payments` | `/api/accountant/bills/:id/payments` | Record a bill payment |
| GET | `/api/v1/accountant/invoices` | `/api/accountant/invoices` | List invoices |
| POST | `/api/v1/accountant/invoices` | `/api/accountant/invoices` | Create an invoice |
| PATCH | `/api/v1/accountant/invoices/:id` | `/api/accountant/invoices/:id` | Update an invoice |
| GET | `/api/v1/accountant/expenses` | `/api/accountant/expenses` | List expenses |
| POST | `/api/v1/accountant/expenses/:id/reimburse` | `/api/accountant/expenses/:id/reimburse` | Record an expense reimbursement |
| GET | `/api/v1/accountant/vendors` | `/api/accountant/vendors` | List vendor directory |
| GET | `/api/v1/accountant/vendors/:id` | `/api/accountant/vendors/:id` | Get one vendor |
| GET | `/api/v1/accountant/payments` | `/api/accountant/payments` | List unified payment register |
| POST | `/api/v1/accountant/payments` | `/api/accountant/payments` | Record a manual or general payment |
| PATCH | `/api/v1/accountant/payments/:id/reconcile` | `/api/accountant/payments/:id/reconcile` | Reconcile a manual or general payment |
| GET | `/api/v1/accountant/payments/export` | `/api/accountant/payments/export` | Export payment register CSV |
| GET | `/api/v1/accountant/reports` | `/api/accountant/reports` | Return financial report summaries |
| GET | `/api/v1/accountant/reports/summary` | `/api/accountant/reports/summary` | Return summary totals only |
| GET | `/api/v1/accountant/reports/export` | `/api/accountant/reports/export` | Export finance report CSV |
| GET | `/api/v1/accountant/notifications` | `/api/accountant/notifications` | List Accountant notifications |
| PATCH | `/api/v1/accountant/notifications/:id/read` | `/api/accountant/notifications/:id/read` | Mark one notification as read |
| GET | `/api/v1/accountant/audit-logs` | `/api/accountant/audit-logs` | List finance-scoped operational audit logs |

## Notes For Frontend

- Use `/api/v1/accountant` for new frontend work.
- `/api/accountant` remains mounted as a legacy alias for the same routes.
- Export endpoints return `text/csv`.
- Mutating routes return the standard JSON response shape: `{ success, message, data, meta }`.
- Missing scoped records return `404` with stable error codes such as `BILL_NOT_FOUND`, `PAYMENT_NOT_FOUND`, or `VENDOR_NOT_FOUND`.
