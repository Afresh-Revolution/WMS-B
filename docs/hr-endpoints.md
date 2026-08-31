# HR API Endpoints

This file lists the backend endpoints available to the HR section.

Default API base: `/api/v1/hr`

Legacy alias: `/api/hr`

Authentication header for protected routes:

```http
Authorization: Bearer <access_token>
Content-Type: application/json
```

All HR routes require an authenticated user with `role = hr` and the specific HR permission required for the action. Records are scoped to the authenticated user's organization where an organization is present.

HR is a specialized Human Resources role. HR routes do not provide role management, permission management, user access management, system/security settings, integrations, finance, payroll, manager task, target, or unrestricted audit-log controls. Those responsibilities belong to the authorized higher-level administration or operational modules.

List endpoints support pagination and filtering through query parameters such as `page`, `limit`, `q`, `search`, `sortBy`, `sortDirection`, `dateFrom`, and `dateTo`.

## Dashboard

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/hr/dashboard` | Return HR people metrics, queues, recommendations, documents, recent HR activity, and navigation |
| GET | `/api/v1/hr/dashboard/stats` | Return HR dashboard metric groups only |

## HR Profile, Settings, Help, And Notifications

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/hr/profile` | Return the authenticated HR user's profile and linked employee summary |
| PATCH | `/api/v1/hr/profile` | Update safe HR self-profile fields only |
| PUT | `/api/v1/hr/profile` | Alias for updating safe HR self-profile fields |
| GET | `/api/v1/hr/settings` | Return HR self-service preferences and notification preferences |
| PATCH | `/api/v1/hr/settings` | Update HR self-service preferences without system, role, permission, security, or access-control settings |
| GET | `/api/v1/hr/help-center` | Return HR help-center sections mapped to HR backend workflows |
| GET | `/api/v1/hr/notifications` | List notifications for the authenticated HR user |
| PATCH | `/api/v1/hr/notifications/:id/read` | Mark one HR notification as read |

## Employees

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/hr/employees` | List organization employees |
| POST | `/api/v1/hr/employees` | Create an employee record through the shared staff system without creating system access, roles, or direct permissions |
| GET | `/api/v1/hr/employees/:id` | Get full HR employee profile, including documents, leave, salary, discipline, and HR notes. Attendance/performance data is returned only when explicitly permissioned |
| PUT | `/api/v1/hr/employees/:id` | Update employee HR information without changing system access, roles, or permissions |
| PATCH | `/api/v1/hr/employees/:id/status` | Change employee status with audit logging |

## Employee Exit

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/hr/employee-exits` | List employee exit records with filtering and pagination |
| POST | `/api/v1/hr/employee-exits` | Create an employee exit process |
| GET | `/api/v1/hr/employee-exits/:id` | Get one employee exit record |
| PATCH | `/api/v1/hr/employee-exits/:id` | Update an employee exit record |
| PATCH | `/api/v1/hr/employee-exits/:id/approve` | Approve a pending employee exit |
| PATCH | `/api/v1/hr/employee-exits/:id/complete` | Complete an approved employee exit and update the employee status to `EXITED` |
| PATCH | `/api/v1/hr/employee-exits/:id/cancel` | Cancel an employee exit |
| PATCH | `/api/v1/hr/employee-exits/:id/reject` | Reject an employee exit |

## Onboarding

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/hr/onboarding` | List onboarding records |
| POST | `/api/v1/hr/onboarding` | Create onboarding record with optional tasks and documents |
| GET | `/api/v1/hr/onboarding/:id` | Get onboarding record with tasks and documents |
| PUT | `/api/v1/hr/onboarding/:id` | Update onboarding status/stage |
| POST | `/api/v1/hr/onboarding/:id/tasks` | Add onboarding task |
| PATCH | `/api/v1/hr/onboarding/tasks/:id` | Update or complete onboarding task |

## Confirmations

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/hr/confirmations` | List explicit and computed confirmation requests |
| PATCH | `/api/v1/hr/confirmations/:id/approve` | Confirm an employee |
| PATCH | `/api/v1/hr/confirmations/:id/extend` | Extend probation |
| PATCH | `/api/v1/hr/confirmations/:id/not-confirm` | Mark confirmation as not confirmed / returned |

## Leave

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/hr/leave` | List organization leave requests |
| GET | `/api/v1/hr/leave/:id` | Get one leave request with employee, balance, and history context |
| POST | `/api/v1/hr/leave` | Create leave request for HR or an employee |
| PATCH | `/api/v1/hr/leave/:id/approve` | Approve leave through the shared leave system |
| PATCH | `/api/v1/hr/leave/:id/reject` | Reject leave through the shared leave system |

## Promotions

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/hr/promotions` | List promotion requests and recommendations |
| POST | `/api/v1/hr/promotions` | Create promotion request |
| PATCH | `/api/v1/hr/promotions/:id/approve` | Approve promotion and update employee history where applicable |
| PATCH | `/api/v1/hr/promotions/:id/reject` | Reject promotion |

## Salary Increments

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/hr/salary-adjustments` | List salary adjustment records |
| POST | `/api/v1/hr/salary-adjustments` | Create salary adjustment |
| PATCH | `/api/v1/hr/salary-adjustments/:id/approve` | Approve salary adjustment |
| PATCH | `/api/v1/hr/salary-adjustments/:id/reject` | Reject salary adjustment |
| GET | `/api/v1/hr/salary-increments` | Alias for salary adjustments |
| POST | `/api/v1/hr/salary-increments` | Alias for creating salary increments |
| PATCH | `/api/v1/hr/salary-increments/:id/approve` | Alias for approving salary increments |
| PATCH | `/api/v1/hr/salary-increments/:id/reject` | Alias for rejecting salary increments |

## Documents

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/hr/documents` | List employee documents |
| POST | `/api/v1/hr/documents` | Upload/register employee document metadata |
| GET | `/api/v1/hr/documents/missing` | List employees missing required documents |
| GET | `/api/v1/hr/documents/expiring` | List documents expiring within the configured day window |
| GET | `/api/v1/hr/documents/expired` | List expired documents |
| PATCH | `/api/v1/hr/documents/:id/verify` | Verify or reject a document |
| DELETE | `/api/v1/hr/documents/:id` | Soft-delete a document |

## NYSC And Interns

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/hr/nysc-interns/dashboard` | Return NYSC and intern HR dashboard counts |
| GET | `/api/v1/hr/nysc-interns/reports/summary` | Return NYSC and intern HR report summary |
| GET | `/api/v1/hr/nysc-interns` | List NYSC and intern profiles |
| POST | `/api/v1/hr/nysc-interns` | Create an NYSC or intern profile |
| GET | `/api/v1/hr/nysc-interns/:id` | Get one NYSC or intern profile with placement details |
| PATCH | `/api/v1/hr/nysc-interns/:id` | Update an NYSC or intern profile |
| POST | `/api/v1/hr/nysc-interns/:id/supervisor` | Assign a placement supervisor |
| POST | `/api/v1/hr/nysc-interns/:id/department` | Change placement department |
| POST | `/api/v1/hr/nysc-interns/:id/extend` | Extend a placement |
| POST | `/api/v1/hr/nysc-interns/:id/complete` | Complete a placement |
| POST | `/api/v1/hr/nysc-interns/:id/terminate` | Terminate a placement |
| POST | `/api/v1/hr/nysc-interns/:id/exit` | Process placement exit |
| GET | `/api/v1/hr/nysc-interns/:id/documents` | List placement documents |
| POST | `/api/v1/hr/nysc-interns/:id/documents` | Upload/register placement document metadata |
| GET | `/api/v1/hr/nysc-interns/:id/reviews` | List placement reviews |
| POST | `/api/v1/hr/nysc-interns/:id/reviews` | Record placement review |
| GET | `/api/v1/hr/nysc-interns/:id/attendance` | List placement attendance |
| POST | `/api/v1/hr/nysc-interns/:id/attendance` | Record placement attendance |
| GET | `/api/v1/hr/nysc-interns/:id/history` | List placement history |
| POST | `/api/v1/hr/nysc-interns/:id/convert-to-employee` | Convert a placement profile to an employee record |

## Discipline

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/hr/discipline` | List disciplinary cases |
| POST | `/api/v1/hr/discipline` | Create disciplinary case |
| PUT | `/api/v1/hr/discipline/:id` | Update disciplinary case |
| PATCH | `/api/v1/hr/discipline/:id/resolve` | Resolve disciplinary case |
| PATCH | `/api/v1/hr/discipline/:id/close` | Close resolved disciplinary case |

## Requests

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/hr/approval-queue` | Return centralized HR approval queue |
| GET | `/api/v1/hr/returned-requests` | List returned HR requests |
| PATCH | `/api/v1/hr/requests/:type/:id/return` | Return a leave, promotion, salary, onboarding, confirmation, document, or discipline request |

## Reports And Audit

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/hr/reports` | Return HR employee, onboarding, leave, promotion, salary, document, confirmation, discipline, employee exit, NYSC/intern, and HR activity reports. Attendance summaries are included only when explicitly permissioned |
| GET | `/api/v1/hr/audit-logs` | List scoped HR operational audit logs |

## Not Exposed In HR

The HR API intentionally does not expose role creation/editing, permission assignment, user access management, system/security settings, integration configuration, finance/procurement/payroll administration, Manager task management, target management, or unrestricted audit-log deletion/export controls.
