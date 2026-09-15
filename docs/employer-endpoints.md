# Employer / Staff Directory API Endpoints

This file lists the backend endpoints available to the Super Admin employer/staff directory section.

Default API base: `/api/v1/employers`

Authentication header:

```http
Authorization: Bearer <access_token>
Content-Type: application/json
```

All `/api/v1/employers` routes require an authenticated user with `role = superadmin`.

These endpoints manage staff directory records across employees, interns, NYSC members, admins, managers, and other staff. They can also create dashboard login accounts when `systemAccess.createAccount` is enabled.

## Query Support

List endpoints support:

```text
page
limit
q
search
sort
sortBy
order
sortDirection
dateFrom
dateTo
view
staffType
staff_type
employmentType
employment_type
department
departmentId
position
positionId
status
location
branch
branchId
manager
managerId
role
```

`view=list` returns list-friendly metadata; otherwise the backend defaults to `grid`.

## Staff Types

Supported `staffType` values:

```text
employee
intern
nysc
admin
manager
other_staff
```

`nysc_member` is accepted and normalized to `nysc`.

Storage collections used internally:

| Staff type | Collection |
| --- | --- |
| `employee` | `employees` |
| `intern` | `interns` |
| `nysc` | `nysc_members` |
| `admin` | `staff_members` |
| `manager` | `staff_members` |
| `other_staff` | `staff_members` |

## Directory

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/employers` | List staff directory records with search, filters, pagination, and dynamic filter metadata |
| POST | `/api/v1/employers` | Create one staff record and optionally create a login account |
| GET | `/api/v1/employers/export` | Export the filtered staff directory as CSV |
| POST | `/api/v1/employers/import` | Preview or confirm bulk staff import |
| POST | `/api/v1/employers/bulk` | Run a bulk action against multiple staff records |

`GET /api/v1/employers` response shape:

```json
{
  "success": true,
  "message": "Staff directory loaded.",
  "data": [
    {
      "id": "staff_id",
      "staffType": "employee",
      "profilePhoto": null,
      "avatar": {
        "initials": "JD"
      },
      "fullName": "John Doe",
      "employeeId": "EMP-001",
      "jobPosition": "Backend Engineer",
      "department": "Software Engineering",
      "location": "Lagos",
      "email": "john.doe@example.com",
      "phone": "123",
      "employmentType": "Full-time",
      "status": "active",
      "branch": null,
      "manager": null,
      "role": "employee",
      "dateJoined": "2026-09-08T00:00:00.000Z",
      "actions": ["view", "edit", "suspend", "deactivate", "reset-password"]
    }
  ],
  "meta": {
    "page": 1,
    "limit": 25,
    "total": 1,
    "totalPages": 1,
    "view": "grid",
    "filters": {
      "departments": [],
      "positions": [],
      "statuses": [],
      "employmentTypes": [],
      "locations": [],
      "branches": [],
      "managers": [],
      "roles": [],
      "staffTypes": [],
      "departmentCategories": []
    }
  }
}
```

## Create Staff

```http
POST /api/v1/employers
Authorization: Bearer <superadmin_access_token>
Content-Type: application/json
```

```json
{
  "staffType": "employee",
  "personalInformation": {
    "firstName": "John",
    "middleName": "A.",
    "lastName": "Doe",
    "email": "john.doe@example.com",
    "phone": "08030000000",
    "gender": "Male",
    "dateOfBirth": "1995-04-10",
    "address": "Lagos",
    "state": "Lagos",
    "lga": "Ikeja",
    "country": "Nigeria",
    "profilePhoto": "https://example.com/photo.jpg"
  },
  "employmentInformation": {
    "employeeId": "EMP-001",
    "jobTitle": "Backend Engineer",
    "positionId": "position_id",
    "department": "Software Engineering",
    "departmentId": "department_id",
    "managerId": "manager_staff_id",
    "employmentType": "Full-time",
    "employmentStartDate": "2026-09-08",
    "location": "Lagos",
    "branchId": "branch_id",
    "status": "active"
  },
  "financialInformation": {
    "salary": 250000,
    "salaryStructure": "Monthly",
    "bankName": "Bank Name",
    "accountNumber": "0123456789",
    "accountName": "John Doe"
  },
  "emergencyContact": {
    "name": "Jane Doe",
    "phone": "08030000001",
    "relationship": "Sibling"
  },
  "systemAccess": {
    "createAccount": true,
    "email": "john.doe@example.com",
    "initialPassword": "password123",
    "role": "employee",
    "permissions": []
  },
  "documents": [
    {
      "name": "Employment Contract",
      "type": "Contract",
      "fileUrl": "https://example.com/contract.pdf",
      "visibility": "restricted"
    }
  ]
}
```

Create response:

```json
{
  "success": true,
  "message": "Person created.",
  "data": {
    "id": "staff_id",
    "staffType": "employee",
    "userId": "login_user_id",
    "fullName": "John Doe",
    "employeeId": "EMP-001",
    "email": "john.doe@example.com",
    "role": "employee",
    "status": "active"
  },
  "meta": {}
}
```

When `systemAccess.createAccount`, `systemAccess.email`, `systemAccess.username`, `systemAccess.initialPassword`, or `systemAccess.password` is provided, the backend creates a login account. The password must be at least 8 characters.

## Create Intern Or NYSC Record

For interns:

```json
{
  "staffType": "intern",
  "personalInformation": {
    "firstName": "Chidi",
    "lastName": "Eze",
    "email": "chidi.intern@example.com",
    "phone": "08030000002"
  },
  "employmentInformation": {
    "internId": "INT-001",
    "institution": "Covenant University",
    "course": "Software Engineering",
    "departmentId": "department_id",
    "supervisorId": "employee_id",
    "startDate": "2026-09-08",
    "endDate": "2026-12-08",
    "workLocation": "Lagos Office",
    "status": "active"
  },
  "systemAccess": {
    "createAccount": true,
    "email": "chidi.intern@example.com",
    "initialPassword": "password123",
    "role": "nysc_intern"
  }
}
```

For NYSC:

```json
{
  "staffType": "nysc",
  "personalInformation": {
    "firstName": "Amina",
    "lastName": "Bello",
    "email": "amina.nysc@example.com"
  },
  "employmentInformation": {
    "nyscId": "NYSC-001",
    "stateCode": "LA/26A/1234",
    "callUpNumber": "NYSC/ABU/2026/123456",
    "institution": "Ahmadu Bello University",
    "course": "Computer Science",
    "departmentId": "department_id",
    "ppa": "Afresh",
    "startDate": "2026-09-08",
    "expectedEndDate": "2027-09-08",
    "status": "active"
  },
  "systemAccess": {
    "createAccount": true,
    "email": "amina.nysc@example.com",
    "initialPassword": "password123",
    "role": "nysc_intern"
  }
}
```

## Staff Profile

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/employers/:id` | Get one staff profile bundle |
| PATCH | `/api/v1/employers/:id` | Update one staff record |

`GET /api/v1/employers/:id` returns:

```json
{
  "overview": {},
  "personalInformation": {},
  "employment": {
    "current": {},
    "employmentHistory": [],
    "departmentHistory": [],
    "positionHistory": [],
    "managerHistory": []
  },
  "department": "Software Engineering",
  "attendance": [],
  "leave": [],
  "salary": null,
  "salaryHistory": [],
  "promotions": [],
  "tasks": [],
  "targets": [],
  "meetings": [],
  "performance": null,
  "documents": [],
  "discipline": [],
  "activity": {},
  "loginSecurity": {
    "lastLogin": null,
    "activeSessions": [],
    "failedLoginAttempts": [],
    "passwordLastChanged": null,
    "twoFactorStatus": "disabled",
    "accountStatus": "active"
  }
}
```

`PATCH /api/v1/employers/:id` accepts direct field updates for the stored staff record, for example:

```json
{
  "phone": "08030000999",
  "jobTitle": "Senior Backend Engineer",
  "departmentId": "new_department_id",
  "department": "Platform Engineering",
  "status": "active"
}
```

## Staff Status Actions

| Method | Endpoint | Purpose |
| --- | --- | --- |
| POST | `/api/v1/employers/:id/deactivate` | Set staff status to `inactive`, revoke sessions, and inactivate linked login account |
| POST | `/api/v1/employers/:id/activate` | Set staff status to `active` |
| POST | `/api/v1/employers/:id/suspend` | Set staff status to `suspended`, revoke sessions, and suspend linked login account |
| POST | `/api/v1/employers/:id/terminate` | Set staff status to `terminated`, revoke sessions, and inactivate linked login account |

Example:

```json
{
  "reason": "Policy review"
}
```

Terminate requires this confirmation:

```json
{
  "confirmation": "TERMINATE STAFF",
  "reason": "End of contract"
}
```

If confirmation is missing, the endpoint returns:

```json
{
  "success": false,
  "message": "Operation failed",
  "error": {
    "code": "CONFIRMATION_REQUIRED",
    "details": {
      "confirmation": "TERMINATE STAFF"
    }
  }
}
```

## Staff Assignment Actions

| Method | Endpoint | Purpose |
| --- | --- | --- |
| POST | `/api/v1/employers/:id/transfer` | Transfer staff to another department, branch, or location |
| POST | `/api/v1/employers/:id/department` | Alias for department/branch/location transfer |
| POST | `/api/v1/employers/:id/manager` | Change manager or supervisor |
| POST | `/api/v1/employers/:id/promote` | Change position/job title and optionally salary |
| POST | `/api/v1/employers/:id/role` | Change linked dashboard role and direct permissions |

Transfer payload:

```json
{
  "departmentId": "department_id",
  "department": "Software Engineering",
  "branchId": "branch_id",
  "branch": "Lagos HQ",
  "location": "Lagos",
  "workLocation": "Lagos Office"
}
```

Manager payload:

```json
{
  "managerId": "manager_staff_id",
  "manager": "Manager Name",
  "supervisorId": "supervisor_staff_id"
}
```

Promotion payload:

```json
{
  "positionId": "position_id",
  "position": "Senior Engineer",
  "jobTitle": "Senior Backend Engineer",
  "salary": 350000
}
```

Role payload:

```json
{
  "role": "hod",
  "permissions": ["dashboard:view", "departments.view"]
}
```

## Login Security Actions

| Method | Endpoint | Purpose |
| --- | --- | --- |
| POST | `/api/v1/employers/:id/reset-password` | Reset the linked login account password and require password reset |
| POST | `/api/v1/employers/:id/force-logout` | Revoke active sessions for the linked login account |
| GET | `/api/v1/employers/:id/login-history` | List login history for the linked login account |

Reset password payload:

```json
{
  "password": "newPassword123"
}
```

Password must be at least 8 characters.

## Documents

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/employers/:id/documents` | List documents attached to the staff record |
| POST | `/api/v1/employers/:id/documents` | Upload/register document metadata for the staff record |

Create document payload:

```json
{
  "name": "Contract",
  "type": "Contract",
  "fileUrl": "https://example.com/contract.pdf",
  "expiryDate": "2027-09-08",
  "visibility": "restricted",
  "status": "active"
}
```

## Activity

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/employers/:id/activity` | List profile, status, department, manager, role, password, document, and other staff activity |

Activity supports normal pagination and search filters.

## Import

Preview import:

```http
POST /api/v1/employers/import
```

```json
{
  "rows": [
    {
      "staffType": "employee",
      "firstName": "John",
      "lastName": "Doe",
      "email": "john.doe@example.com",
      "employeeId": "EMP-001",
      "department": "Software Engineering",
      "jobTitle": "Backend Engineer"
    }
  ]
}
```

Confirm import:

```json
{
  "confirm": true,
  "rows": [
    {
      "staffType": "employee",
      "fullName": "John Doe",
      "email": "john.doe@example.com",
      "employeeId": "EMP-001",
      "department": "Software Engineering",
      "jobTitle": "Backend Engineer"
    }
  ]
}
```

Without `confirm: true`, the backend returns a preview and does not create records.

## Bulk Actions

```http
POST /api/v1/employers/bulk
```

```json
{
  "ids": ["staff_id_1", "staff_id_2"],
  "action": "suspend",
  "payload": {
    "reason": "Security review"
  }
}
```

Supported bulk actions are the same staff actions handled by the backend, including:

```text
activate
deactivate
suspend
terminate
transfer
department
manager
promote
role
change-salary
```

Bulk deactivate requires:

```json
{
  "ids": ["staff_id_1", "staff_id_2"],
  "action": "deactivate",
  "confirmation": "BULK DEACTIVATE",
  "payload": {
    "reason": "Org cleanup"
  }
}
```

## Export

```http
GET /api/v1/employers/export?staffType=employee&department=Software%20Engineering
```

The response is CSV with:

```text
Content-Type: text/csv; charset=utf-8
Content-Disposition: attachment; filename="staff-directory.csv"
```

## Error Responses

Missing staff record:

```json
{
  "success": false,
  "message": "Operation failed",
  "error": {
    "code": "STAFF_NOT_FOUND",
    "details": {}
  }
}
```

Invalid reset password:

```json
{
  "success": false,
  "message": "Operation failed",
  "error": {
    "code": "INVALID_PASSWORD",
    "details": {
      "minLength": 8
    }
  }
}
```

## Notes For Frontend

- Use `POST /api/v1/employers` when Super Admin adds a user/staff member and assigns a role.
- Put the dashboard role in `systemAccess.role`.
- Use `systemAccess.createAccount: true` and `systemAccess.initialPassword` to create login access.
- Use `staffType: "intern"` or `staffType: "nysc"` for non-employee placement-style staff in the staff directory.
- For the newer NYSC/Intern placement lifecycle, use `/api/v1/nysc-interns`.
- For the NYSC/Intern self-service dashboard, use `/api/v1/intern`.
