create extension if not exists "pgcrypto";

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  username text unique,
  password_hash text not null,
  role text not null default 'employee',
  status text not null default 'active',
  permissions jsonb not null default '[]'::jsonb,
  failed_login_count integer not null default 0,
  force_password_reset boolean not null default false,
  password_changed_at timestamptz,
  password_expires_at timestamptz,
  locked_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists user_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  full_name text not null,
  phone text,
  photo_file_id uuid,
  notification_preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists roles (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text,
  is_system boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists permissions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  module text not null,
  action text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists role_permissions (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references roles(id),
  permission_id uuid not null references permissions(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (role_id, permission_id)
);

create table if not exists user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  role_id uuid not null references roles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, role_id)
);

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  refresh_token_hash text not null unique,
  status text not null default 'active',
  device text,
  user_agent text,
  ip_address inet,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists login_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  status text not null,
  reason text,
  device text,
  user_agent text,
  ip_address inet,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists failed_logins (
  id uuid primary key default gen_random_uuid(),
  email text,
  user_id uuid references users(id),
  reason text,
  device text,
  user_agent text,
  ip_address inet,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists employers (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  registration_number text,
  tax_information jsonb not null default '{}'::jsonb,
  company_email text,
  phone text,
  website text,
  logo_file_id uuid,
  address text,
  working_hours jsonb not null default '{}'::jsonb,
  currency text,
  timezone text,
  company_policies jsonb not null default '{}'::jsonb,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists branches (
  id uuid primary key default gen_random_uuid(),
  employer_id uuid references employers(id),
  name text not null,
  address text,
  location text,
  status text not null default 'active',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists departments (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid references branches(id),
  name text not null,
  code text not null unique,
  description text,
  hod_id uuid references employees(id),
  assistant_hod_id uuid references employees(id),
  head_employee_id uuid references employees(id),
  location text,
  email text,
  phone text,
  logo_file_id uuid,
  color text,
  working_hours jsonb not null default '{}'::jsonb,
  budget numeric(14,2),
  status text not null default 'active',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists positions (
  id uuid primary key default gen_random_uuid(),
  department_id uuid references departments(id),
  title text not null,
  level text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists employees (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  employee_id text not null unique,
  full_name text not null,
  email text,
  phone text,
  photo_file_id uuid,
  department_id uuid references departments(id),
  position_id uuid references positions(id),
  manager_id uuid references employees(id),
  employment_type text,
  hire_date date,
  salary numeric(14,2),
  status text not null default 'active',
  bank_information jsonb not null default '{}'::jsonb,
  emergency_contact jsonb not null default '{}'::jsonb,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists employee_documents (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references employees(id),
  staff_id uuid,
  staff_type text,
  document_id text unique,
  file_id uuid,
  file_url text,
  type text,
  name text,
  uploaded_by uuid references users(id),
  uploaded_date timestamptz,
  expiry_date date,
  visibility text not null default 'restricted',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists employee_profiles (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null unique references employees(id),
  first_name text,
  middle_name text,
  last_name text,
  gender text,
  date_of_birth date,
  address text,
  state text,
  lga text,
  country text,
  emergency_contact jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists staff_members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  staff_type text not null,
  staff_id text unique,
  full_name text not null,
  email text,
  phone text,
  department_id uuid references departments(id),
  position_id uuid references positions(id),
  branch_id uuid references branches(id),
  manager_id uuid references employees(id),
  location text,
  employment_type text,
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists employee_departments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  department_id uuid not null references departments(id),
  assigned_by uuid references users(id),
  starts_at date,
  ends_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists employee_managers (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  manager_id uuid references employees(id),
  manager_type text,
  assigned_by uuid references users(id),
  starts_at date,
  ends_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists employment_history (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null,
  staff_type text not null,
  event text not null,
  old_value jsonb,
  new_value jsonb,
  actor_id uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists department_history (
  id uuid primary key default gen_random_uuid(),
  department_id uuid references departments(id),
  staff_id uuid,
  staff_type text,
  action text,
  old_value jsonb,
  new_value jsonb,
  actor_id uuid references users(id),
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists department_activity_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references users(id),
  department_id uuid not null references departments(id),
  action text not null,
  old_value jsonb,
  new_value jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists department_documents (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references departments(id),
  name text not null,
  type text,
  file_id uuid,
  file_url text,
  uploaded_by uuid references users(id),
  version text,
  visibility text not null default 'restricted',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists employee_department_history (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references employees(id),
  staff_id uuid,
  previous_department_id uuid references departments(id),
  new_department_id uuid references departments(id),
  reason text,
  approved_by uuid references users(id),
  effective_date timestamptz,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists position_history (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null,
  staff_type text not null,
  old_value jsonb,
  new_value jsonb,
  actor_id uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists manager_history (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null,
  staff_type text not null,
  old_value jsonb,
  new_value jsonb,
  actor_id uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists employee_activity_logs (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid,
  staff_type text,
  actor_id uuid references users(id),
  action text not null,
  old_value jsonb,
  new_value jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists interns (
  id uuid primary key default gen_random_uuid(),
  intern_id text not null unique,
  name text not null,
  institution text,
  course text,
  field_of_study text,
  department_id uuid references departments(id),
  supervisor_id uuid references employees(id),
  position_id uuid references positions(id),
  start_date date,
  end_date date,
  status text not null default 'pending',
  phone text,
  email text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists intern_documents (
  id uuid primary key default gen_random_uuid(),
  intern_id uuid not null references interns(id),
  file_id uuid,
  type text,
  name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists nysc_members (
  id uuid primary key default gen_random_uuid(),
  nysc_id text not null unique,
  state_code text,
  call_up_number text,
  name text not null,
  institution text,
  course text,
  department_id uuid references departments(id),
  ppa text,
  supervisor_id uuid references employees(id),
  start_date date,
  end_date date,
  status text not null default 'pending',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists nysc_documents (
  id uuid primary key default gen_random_uuid(),
  nysc_member_id uuid not null references nysc_members(id),
  file_id uuid,
  type text,
  name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists nysc_postings (
  id uuid primary key default gen_random_uuid(),
  nysc_member_id uuid not null references nysc_members(id),
  ppa text,
  start_date date,
  end_date date,
  status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists leave_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  description text,
  default_days numeric(8,2) not null default 0,
  paid boolean not null default true,
  requires_document boolean not null default false,
  requires_approval boolean not null default true,
  carry_forward_allowed boolean not null default false,
  max_carry_forward_days numeric(8,2) not null default 0,
  status text not null default 'active',
  policy jsonb not null default '{}'::jsonb,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists leave_policies (
  id uuid primary key default gen_random_uuid(),
  leave_type_id uuid not null references leave_types(id),
  annual_days numeric(8,2) not null default 0,
  accrual_method text not null default 'YEARLY',
  minimum_notice_days integer not null default 0,
  maximum_consecutive_days numeric(8,2),
  carry_forward_enabled boolean not null default false,
  max_carry_forward_days numeric(8,2) not null default 0,
  half_day_enabled boolean not null default true,
  weekend_counted boolean not null default false,
  holiday_counted boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (leave_type_id)
);

create table if not exists leave_balances (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  leave_type_id uuid not null references leave_types(id),
  year integer not null,
  allocated_days numeric(8,2) not null default 0,
  carried_forward_days numeric(8,2) not null default 0,
  accrued_days numeric(8,2) not null default 0,
  used_days numeric(8,2) not null default 0,
  pending_days numeric(8,2) not null default 0,
  remaining_days numeric(8,2) not null default 0,
  balance numeric(8,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, leave_type_id, year)
);

create table if not exists leave_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  leave_type_id uuid not null references leave_types(id),
  start_date date not null,
  end_date date not null,
  duration numeric(8,2) not null default 0,
  calendar_days numeric(8,2) not null default 0,
  duration_type text not null default 'FULL_DAY',
  note text,
  reason text,
  status text not null default 'PENDING',
  submitted_at timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  cancelled_at timestamptz,
  withdrawn_at timestamptz,
  approved_by uuid references users(id),
  rejected_by uuid references users(id),
  cancelled_by uuid references users(id),
  withdrawn_by uuid references users(id),
  rejection_reason text,
  cancellation_reason text,
  withdrawal_reason text,
  decided_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists leave_approvals (
  id uuid primary key default gen_random_uuid(),
  leave_request_id uuid not null references leave_requests(id),
  approver_id uuid not null references users(id),
  workflow_step_id uuid,
  status text not null default 'PENDING',
  comment text,
  approved_at timestamptz,
  rejected_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists leave_attachments (
  id uuid primary key default gen_random_uuid(),
  leave_request_id uuid not null references leave_requests(id),
  file_id uuid,
  file_url text,
  name text,
  type text,
  uploaded_by uuid references users(id),
  status text not null default 'active',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists holidays (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  date date not null unique,
  description text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists leave_history (
  id uuid primary key default gen_random_uuid(),
  leave_request_id uuid references leave_requests(id),
  employee_id uuid references employees(id),
  actor_id uuid references users(id),
  action text not null,
  status text,
  old_value jsonb,
  new_value jsonb,
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists approval_workflows (
  id uuid primary key default gen_random_uuid(),
  leave_type_id uuid references leave_types(id),
  leave_request_id uuid references leave_requests(id),
  name text not null,
  status text not null default 'active',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists approval_workflow_steps (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references approval_workflows(id),
  leave_request_id uuid references leave_requests(id),
  step_order integer not null,
  approver_type text not null,
  approver_employee_id uuid references employees(id),
  status text not null default 'PENDING',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists salary_structures (
  id uuid primary key default gen_random_uuid(),
  name text,
  description text,
  currency text not null default 'NGN',
  status text not null default 'ACTIVE',
  created_by uuid references users(id),
  employee_id uuid references employees(id),
  basic_salary numeric(14,2) not null default 0,
  allowances jsonb not null default '[]'::jsonb,
  deductions jsonb not null default '[]'::jsonb,
  effective_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists salary_history (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  previous_salary numeric(14,2),
  new_salary numeric(14,2),
  effective_from date,
  approved_by uuid references users(id),
  old_salary numeric(14,2),
  reason text,
  changed_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists salary_components (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  component_type text not null default 'EARNING',
  calculation_type text not null default 'FIXED',
  default_value numeric(14,2) not null default 0,
  is_taxable boolean not null default true,
  is_pensionable boolean not null default false,
  is_active boolean not null default true,
  category text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists salary_structure_components (
  id uuid primary key default gen_random_uuid(),
  salary_structure_id uuid not null references salary_structures(id),
  component_id uuid not null references salary_components(id),
  override_value numeric(14,2),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (salary_structure_id, component_id)
);

create table if not exists employee_salary_assignments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  salary_structure_id uuid not null references salary_structures(id),
  effective_from date not null,
  effective_to date,
  base_salary numeric(14,2) not null default 0,
  currency text not null default 'NGN',
  status text not null default 'ACTIVE',
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists salary_increments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  current_salary numeric(14,2),
  increment_amount numeric(14,2),
  percentage numeric(8,2),
  new_salary numeric(14,2),
  reason text,
  effective_date date,
  status text not null default 'pending',
  approved_by uuid references users(id),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists promotions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  current_position_id uuid references positions(id),
  new_position_id uuid references positions(id),
  current_salary numeric(14,2),
  new_salary numeric(14,2),
  department_id uuid references departments(id),
  reason text,
  effective_date date,
  status text not null default 'pending',
  approved_by uuid references users(id),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists promotion_history (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid references promotions(id),
  employee_id uuid references employees(id),
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists meeting_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  description text,
  requires_location boolean not null default false,
  requires_virtual_link boolean not null default false,
  status text not null default 'active',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists meeting_rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  building text,
  branch_id uuid references branches(id),
  capacity integer not null default 0,
  location text,
  equipment jsonb not null default '[]'::jsonb,
  status text not null default 'active',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists meetings (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  date date,
  start_time time,
  end_time time,
  duration_minutes integer not null default 0,
  start_at timestamptz,
  end_at timestamptz,
  meeting_type_id uuid references meeting_types(id),
  meeting_room_id uuid references meeting_rooms(id),
  organizer_id uuid not null references users(id),
  department_id uuid references departments(id),
  meeting_link text,
  virtual_link text,
  location text,
  agenda text,
  minutes text,
  start_date timestamptz,
  end_date timestamptz,
  status text not null default 'SCHEDULED',
  visibility text not null default 'PRIVATE',
  created_by uuid references users(id),
  cancelled_at timestamptz,
  cancelled_by uuid references users(id),
  cancellation_reason text,
  postponed_at timestamptz,
  postponed_by uuid references users(id),
  postponement_reason text,
  started_at timestamptz,
  completed_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists meeting_participants (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meetings(id),
  user_id uuid not null references users(id),
  participant_role text not null default 'PARTICIPANT',
  invitation_status text not null default 'INVITED',
  response_status text not null default 'PENDING',
  joined_at timestamptz,
  left_at timestamptz,
  responded_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (meeting_id, user_id)
);

create table if not exists meeting_attendees (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meetings(id),
  attendee_type text not null,
  attendee_id uuid not null,
  status text not null default 'invited',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists meeting_agendas (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meetings(id),
  title text not null,
  description text,
  order_number integer not null default 1,
  duration_minutes integer not null default 0,
  presenter_id uuid references users(id),
  created_by uuid references users(id),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists meeting_minutes (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meetings(id),
  content text not null,
  created_by uuid references users(id),
  updated_by uuid references users(id),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists meeting_action_items (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meetings(id),
  task_id uuid,
  title text not null,
  description text,
  assigned_to uuid references users(id),
  due_date date,
  status text not null default 'pending',
  created_by uuid references users(id),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists meeting_attendance (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meetings(id),
  user_id uuid not null references users(id),
  status text not null default 'PRESENT',
  joined_at timestamptz,
  left_at timestamptz,
  attendance_minutes integer not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (meeting_id, user_id)
);

create table if not exists meeting_reminders (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meetings(id),
  user_id uuid references users(id),
  minutes_before integer not null,
  channel text not null default 'IN_APP',
  status text not null default 'PENDING',
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists meeting_attachments (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meetings(id),
  file_id uuid,
  file_url text,
  name text,
  type text,
  uploaded_by uuid references users(id),
  status text not null default 'active',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists meeting_history (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meetings(id),
  actor_id uuid references users(id),
  action text not null,
  old_values jsonb,
  new_values jsonb,
  created_at timestamptz not null default now()
);

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  assigned_by uuid references users(id),
  assigned_to uuid,
  department_id uuid references departments(id),
  priority text,
  status text not null default 'pending',
  start_date date,
  due_date date,
  progress integer not null default 0,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id),
  user_id uuid references users(id),
  comment text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists task_attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id),
  file_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists targets (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  target_type text not null default 'EMPLOYEE',
  measurement_type text not null default 'NUMBER',
  metric_name text,
  target_value numeric(14,2) not null default 0,
  current_value numeric(14,2) not null default 0,
  unit text,
  owner_type text,
  owner_id uuid,
  kpi jsonb not null default '{}'::jsonb,
  type text not null,
  status text not null default 'ACTIVE',
  priority text not null default 'MEDIUM',
  start_date date,
  end_date date,
  progress numeric(8,2) not null default 0,
  achievement_percentage numeric(8,2) not null default 0,
  created_by uuid references users(id),
  department_id uuid references departments(id),
  parent_target_id uuid references targets(id),
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid references users(id),
  status_reason text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists target_assignments (
  id uuid primary key default gen_random_uuid(),
  target_id uuid not null references targets(id),
  employee_id uuid references employees(id),
  department_id uuid references departments(id),
  assigned_by uuid references users(id),
  assigned_at timestamptz not null default now(),
  unassigned_at timestamptz,
  unassigned_by uuid references users(id),
  status text not null default 'ASSIGNED',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists target_metrics (
  id uuid primary key default gen_random_uuid(),
  target_id uuid not null references targets(id),
  name text not null,
  description text,
  value numeric(14,2) not null default 0,
  unit text,
  source text not null default 'MANUAL',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists target_progress (
  id uuid primary key default gen_random_uuid(),
  target_id uuid not null references targets(id),
  value numeric(14,2) not null default 0,
  percentage numeric(8,2) not null default 0,
  progress numeric(8,2) not null default 0,
  recorded_by uuid references users(id),
  recorded_at timestamptz not null default now(),
  note text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists target_milestones (
  id uuid primary key default gen_random_uuid(),
  target_id uuid not null references targets(id),
  title text not null,
  description text,
  target_value numeric(14,2) not null default 0,
  due_date date,
  status text not null default 'ACTIVE',
  completed_at timestamptz,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists target_comments (
  id uuid primary key default gen_random_uuid(),
  target_id uuid not null references targets(id),
  user_id uuid not null references users(id),
  comment text not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists target_attachments (
  id uuid primary key default gen_random_uuid(),
  target_id uuid not null references targets(id),
  uploaded_by uuid references users(id),
  file_name text,
  file_url text,
  file_type text,
  file_size bigint,
  created_at timestamptz not null default now()
);

create table if not exists target_reviews (
  id uuid primary key default gen_random_uuid(),
  target_id uuid not null references targets(id),
  reviewer_id uuid not null references users(id),
  rating numeric(4,2),
  comment text,
  review_period text,
  created_at timestamptz not null default now()
);

create table if not exists target_history (
  id uuid primary key default gen_random_uuid(),
  target_id uuid not null references targets(id),
  actor_id uuid references users(id),
  action text not null,
  old_values jsonb,
  new_values jsonb,
  created_at timestamptz not null default now()
);

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  location text,
  start_date timestamptz,
  end_date timestamptz,
  status text not null default 'scheduled',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists event_attendees (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id),
  attendee_type text not null,
  attendee_id uuid not null,
  rsvp_status text,
  attendance_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists disciplinary_cases (
  id uuid primary key default gen_random_uuid(),
  case_number text unique,
  employee_id uuid references employees(id),
  summary text,
  status text not null default 'open',
  confidentiality_level text not null default 'strict',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists disciplinary_actions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references disciplinary_cases(id),
  action text not null,
  evidence jsonb not null default '[]'::jsonb,
  resolution text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text,
  target jsonb not null default '{}'::jsonb,
  status text not null default 'draft',
  pinned_at timestamptz,
  scheduled_at timestamptz,
  expires_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists payroll_periods (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  start_date date not null,
  end_date date not null,
  pay_date date not null,
  status text not null default 'OPEN',
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists payroll_runs (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  payroll_period_id uuid not null references payroll_periods(id),
  run_date date,
  started_at timestamptz,
  completed_at timestamptz,
  employee_count integer not null default 0,
  gross_amount numeric(14,2) not null default 0,
  total_deductions numeric(14,2) not null default 0,
  net_amount numeric(14,2) not null default 0,
  status text not null default 'DRAFT',
  created_by uuid references users(id),
  approved_by uuid references users(id),
  paid_at timestamptz,
  locked_at timestamptz,
  locked_by uuid references users(id),
  cancelled_at timestamptz,
  cancelled_by uuid references users(id),
  cancellation_reason text,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists payroll (
  id uuid primary key default gen_random_uuid(),
  reference text,
  payroll_period_id uuid references payroll_periods(id),
  gross_amount numeric(14,2) not null default 0,
  total_deductions numeric(14,2) not null default 0,
  net_amount numeric(14,2) not null default 0,
  period text not null,
  status text not null default 'pending',
  approved_by uuid references users(id),
  processed_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists payroll_run_items (
  id uuid primary key default gen_random_uuid(),
  payroll_run_id uuid not null references payroll_runs(id),
  employee_id uuid not null references employees(id),
  salary_assignment_id uuid references employee_salary_assignments(id),
  gross_salary numeric(14,2) not null default 0,
  total_earnings numeric(14,2) not null default 0,
  total_deductions numeric(14,2) not null default 0,
  net_salary numeric(14,2) not null default 0,
  currency text not null default 'NGN',
  status text not null default 'CALCULATED',
  department_id uuid references departments(id),
  basic_salary numeric(14,2) not null default 0,
  allowances numeric(14,2) not null default 0,
  bonuses numeric(14,2) not null default 0,
  tax numeric(14,2) not null default 0,
  pension numeric(14,2) not null default 0,
  overtime numeric(14,2) not null default 0,
  loans numeric(14,2) not null default 0,
  advances numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists payroll_items (
  id uuid primary key default gen_random_uuid(),
  payroll_id uuid not null references payroll(id),
  employee_id uuid not null references employees(id),
  basic_salary numeric(14,2) not null default 0,
  allowances numeric(14,2) not null default 0,
  bonuses numeric(14,2) not null default 0,
  deductions numeric(14,2) not null default 0,
  tax numeric(14,2) not null default 0,
  pension numeric(14,2) not null default 0,
  overtime numeric(14,2) not null default 0,
  loans numeric(14,2) not null default 0,
  net_salary numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists earnings (
  id uuid primary key default gen_random_uuid(),
  payroll_run_item_id uuid not null references payroll_run_items(id),
  component_id uuid references salary_components(id),
  name text not null,
  amount numeric(14,2) not null default 0,
  is_taxable boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists deductions (
  id uuid primary key default gen_random_uuid(),
  payroll_run_item_id uuid not null references payroll_run_items(id),
  component_id uuid references salary_components(id),
  name text not null,
  amount numeric(14,2) not null default 0,
  category text not null default 'OTHER',
  source_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists payslips (
  id uuid primary key default gen_random_uuid(),
  payroll_item_id uuid references payroll_items(id),
  payroll_run_item_id uuid references payroll_run_items(id),
  employee_id uuid references employees(id),
  payroll_run_id uuid references payroll_runs(id),
  payslip_number text unique,
  gross_salary numeric(14,2) not null default 0,
  total_earnings numeric(14,2) not null default 0,
  total_deductions numeric(14,2) not null default 0,
  net_salary numeric(14,2) not null default 0,
  currency text not null default 'NGN',
  file_id uuid,
  file_url text,
  status text not null default 'generated',
  generated_at timestamptz,
  content jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists salary_allowances (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references employees(id),
  name text not null,
  amount numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists salary_deductions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references employees(id),
  name text not null,
  amount numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists employee_deductions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  component_id uuid references salary_components(id),
  name text not null,
  amount numeric(14,2) not null default 0,
  category text not null default 'OTHER',
  effective_from date not null,
  effective_to date,
  status text not null default 'ACTIVE',
  created_by uuid references users(id),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists employee_benefits (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  name text not null,
  amount numeric(14,2) not null default 0,
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists employee_loans (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  principal_amount numeric(14,2) not null default 0,
  outstanding_amount numeric(14,2) not null default 0,
  monthly_repayment numeric(14,2) not null default 0,
  start_date date,
  end_date date,
  status text not null default 'ACTIVE',
  approved_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists employee_advances (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  amount numeric(14,2) not null default 0,
  outstanding_amount numeric(14,2) not null default 0,
  repayment_amount numeric(14,2) not null default 0,
  request_date date,
  approved_date date,
  status text not null default 'APPROVED',
  approved_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists tax_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  country text,
  region text,
  effective_from date,
  effective_to date,
  rule_type text not null default 'PERCENTAGE',
  configuration jsonb not null default '{}'::jsonb,
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists statutory_deductions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null,
  calculation_method text not null default 'PERCENTAGE',
  configuration jsonb not null default '{}'::jsonb,
  employee_percentage numeric(8,2) not null default 0,
  employer_percentage numeric(8,2) not null default 0,
  is_active boolean not null default true,
  effective_from date,
  effective_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists statutory_remittances (
  id uuid primary key default gen_random_uuid(),
  payroll_run_id uuid not null references payroll_runs(id),
  statutory_deduction_id uuid references statutory_deductions(id),
  amount numeric(14,2) not null default 0,
  due_date date,
  payment_date date,
  reference text,
  status text not null default 'PENDING',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists payroll_payments (
  id uuid primary key default gen_random_uuid(),
  payroll_run_id uuid not null references payroll_runs(id),
  employee_id uuid not null references employees(id),
  payroll_run_item_id uuid references payroll_run_items(id),
  amount numeric(14,2) not null default 0,
  currency text not null default 'NGN',
  payment_method text,
  payment_reference text,
  status text not null default 'PENDING',
  processed_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now()
);

create table if not exists payroll_approvals (
  id uuid primary key default gen_random_uuid(),
  payroll_run_id uuid not null references payroll_runs(id),
  approver_id uuid not null references users(id),
  status text not null default 'PENDING',
  comment text,
  approved_at timestamptz,
  rejected_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists payroll_adjustments (
  id uuid primary key default gen_random_uuid(),
  payroll_run_id uuid references payroll_runs(id),
  employee_id uuid references employees(id),
  type text not null default 'OTHER',
  amount numeric(14,2) not null default 0,
  reason text not null,
  approved_by uuid references users(id),
  created_at timestamptz not null default now()
);

create table if not exists payroll_history (
  id uuid primary key default gen_random_uuid(),
  payroll_run_id uuid references payroll_runs(id),
  actor_id uuid references users(id),
  action text not null,
  old_values jsonb,
  new_values jsonb,
  reason text,
  created_at timestamptz not null default now()
);

create table if not exists vendors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  business_name text,
  email text,
  phone text,
  address text,
  tax_id text,
  bank_details jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  documents jsonb not null default '[]'::jsonb,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists vendor_bills (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid references vendors(id),
  purchase_order_id uuid,
  invoice_number text,
  invoice_date date,
  payroll_run_id uuid references payroll_runs(id),
  bill_number text,
  description text,
  subtotal numeric(14,2) not null default 0,
  tax numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  currency text not null default 'NGN',
  amount numeric(14,2) not null default 0,
  due_date date,
  status text not null default 'PENDING',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists purchase_requests (
  id uuid primary key default gen_random_uuid(),
  reference text unique,
  request_number text unique,
  requester_id uuid references employees(id),
  title text not null,
  description text,
  reason text,
  department_id uuid references departments(id),
  vendor_id uuid references vendors(id),
  estimated_amount numeric(14,2) not null default 0,
  currency text not null default 'NGN',
  priority text not null default 'NORMAL',
  required_date date,
  amount numeric(14,2),
  status text not null default 'SUBMITTED',
  current_approval_level integer not null default 1,
  required_approval_levels integer not null default 1,
  submitted_at timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  cancelled_at timestamptz,
  approved_by uuid references users(id),
  rejected_by uuid references users(id),
  cancelled_by uuid references users(id),
  rejection_reason text,
  cancellation_reason text,
  created_by uuid references users(id),
  purchase_order_id uuid,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists purchase_request_items (
  id uuid primary key default gen_random_uuid(),
  purchase_request_id uuid not null references purchase_requests(id),
  description text not null,
  quantity numeric(14,2) not null default 1,
  unit text,
  estimated_unit_price numeric(14,2) not null default 0,
  estimated_total numeric(14,2) not null default 0,
  category text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists purchase_request_approvals (
  id uuid primary key default gen_random_uuid(),
  purchase_request_id uuid not null references purchase_requests(id),
  approver_id uuid references users(id),
  approval_level integer not null default 1,
  status text not null default 'PENDING',
  comment text,
  approved_at timestamptz,
  rejected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists purchase_request_comments (
  id uuid primary key default gen_random_uuid(),
  purchase_request_id uuid not null references purchase_requests(id),
  user_id uuid not null references users(id),
  comment text not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists purchase_request_attachments (
  id uuid primary key default gen_random_uuid(),
  purchase_request_id uuid not null references purchase_requests(id),
  uploaded_by uuid references users(id),
  file_name text,
  file_url text,
  file_type text,
  file_size bigint,
  created_at timestamptz not null default now()
);

create table if not exists purchase_request_history (
  id uuid primary key default gen_random_uuid(),
  purchase_request_id uuid not null references purchase_requests(id),
  actor_id uuid references users(id),
  action text not null,
  old_status text,
  new_status text,
  comment text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists vendor_quotes (
  id uuid primary key default gen_random_uuid(),
  purchase_request_id uuid not null references purchase_requests(id),
  vendor_id uuid references vendors(id),
  quote_reference text,
  amount numeric(14,2) not null default 0,
  currency text not null default 'NGN',
  valid_until date,
  file_url text,
  status text not null default 'SUBMITTED',
  created_at timestamptz not null default now()
);

create table if not exists purchase_orders (
  id uuid primary key default gen_random_uuid(),
  purchase_request_id uuid references purchase_requests(id),
  vendor_id uuid references vendors(id),
  reference text unique,
  order_date date,
  expected_delivery_date date,
  subtotal numeric(14,2) not null default 0,
  tax numeric(14,2) not null default 0,
  discount numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  currency text not null default 'NGN',
  status text not null default 'DRAFT',
  created_by uuid references users(id),
  approved_by uuid references users(id),
  sent_at timestamptz,
  sent_by uuid references users(id),
  cancelled_at timestamptz,
  cancelled_by uuid references users(id),
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references purchase_orders(id),
  purchase_request_item_id uuid references purchase_request_items(id),
  description text not null,
  quantity numeric(14,2) not null default 1,
  unit_price numeric(14,2) not null default 0,
  tax numeric(14,2) not null default 0,
  discount numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references purchase_orders(id),
  description text not null,
  quantity numeric(14,2) not null default 1,
  unit_price numeric(14,2) not null default 0,
  tax numeric(14,2) not null default 0,
  discount numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists purchase_receipts (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references purchase_orders(id),
  received_by uuid references users(id),
  received_date date not null,
  status text not null default 'PARTIAL',
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists purchase_receipt_items (
  id uuid primary key default gen_random_uuid(),
  purchase_receipt_id uuid not null references purchase_receipts(id),
  purchase_order_item_id uuid not null references purchase_order_items(id),
  quantity_ordered numeric(14,2) not null default 0,
  quantity_received numeric(14,2) not null default 0,
  quantity_rejected numeric(14,2) not null default 0,
  condition text,
  notes text
);

create table if not exists bills (
  id uuid primary key default gen_random_uuid(),
  reference text unique,
  bill_number text unique,
  vendor_id uuid references vendors(id),
  purchase_order_id uuid references purchase_orders(id),
  invoice_number text,
  invoice_date date,
  description text,
  category text,
  subtotal numeric(14,2) not null default 0,
  tax_amount numeric(14,2) not null default 0,
  discount_amount numeric(14,2) not null default 0,
  total_amount numeric(14,2) not null default 0,
  amount numeric(14,2) not null default 0,
  amount_paid numeric(14,2) not null default 0,
  amount_due numeric(14,2) not null default 0,
  currency text not null default 'NGN',
  category_id uuid,
  department_id uuid references departments(id),
  due_date date,
  status text not null default 'DRAFT',
  payment_status text not null default 'UNPAID',
  approval_status text not null default 'PENDING',
  payment_date date,
  scheduled_payment_date date,
  current_approval_level integer not null default 0,
  required_approval_levels integer not null default 1,
  po_match_status text not null default 'NOT_APPLICABLE',
  created_by uuid references users(id),
  approved_by uuid references users(id),
  approved_at timestamptz,
  rejected_by uuid references users(id),
  rejected_at timestamptz,
  rejection_reason text,
  disputed_by uuid references users(id),
  disputed_at timestamptz,
  dispute_reason text,
  cancelled_by uuid references users(id),
  cancelled_at timestamptz,
  cancellation_reason text,
  attachment_file_id uuid,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists bill_items (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references bills(id),
  description text not null,
  quantity numeric(14,2) not null default 1,
  unit_price numeric(14,2) not null default 0,
  tax_rate numeric(8,4) not null default 0,
  tax_amount numeric(14,2) not null default 0,
  discount numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists bill_approvals (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references bills(id),
  approver_id uuid references users(id),
  approval_level integer not null default 1,
  status text not null default 'PENDING',
  comment text,
  approved_at timestamptz,
  rejected_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists bill_payments (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references bills(id),
  payment_reference text,
  amount numeric(14,2) not null default 0,
  payment_date date,
  payment_method_id uuid,
  bank_account_id uuid,
  account_id uuid,
  transaction_reference text,
  notes text,
  status text not null default 'PENDING',
  processed_by uuid references users(id),
  paid_by uuid references users(id),
  paid_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists bill_attachments (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references bills(id),
  uploaded_by uuid references users(id),
  file_name text not null,
  file_url text not null,
  file_type text,
  file_size bigint not null default 0,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists bill_comments (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references bills(id),
  user_id uuid references users(id),
  comment text not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists bill_history (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references bills(id),
  actor_id uuid references users(id),
  action text not null,
  old_status text,
  new_status text,
  comment text,
  metadata jsonb not null default '{}'::jsonb,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists expense_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  status text not null default 'ACTIVE',
  requires_receipt boolean not null default false,
  max_amount numeric(14,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists payment_methods (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  type text,
  status text not null default 'ACTIVE',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  bank_name text,
  account_number text,
  currency text not null default 'NGN',
  balance numeric(14,2) not null default 0,
  status text not null default 'ACTIVE',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  reference text unique,
  employee_id uuid references employees(id),
  department_id uuid references departments(id),
  purchase_order_id uuid references purchase_orders(id),
  vendor_bill_id uuid,
  bill_id uuid references bills(id),
  category_id uuid references expense_categories(id),
  description text,
  notes text,
  amount numeric(14,2) not null default 0,
  original_amount numeric(14,2) not null default 0,
  approved_amount numeric(14,2),
  reimbursement_amount numeric(14,2) not null default 0,
  currency text not null default 'NGN',
  expense_date date,
  created_by uuid references users(id),
  submitted_at timestamptz,
  approved_by uuid references users(id),
  approved_at timestamptz,
  rejected_by uuid references users(id),
  rejected_at timestamptz,
  rejection_reason text,
  cancelled_by uuid references users(id),
  cancelled_at timestamptz,
  cancellation_reason text,
  adjusted_by uuid references users(id),
  adjusted_at timestamptz,
  adjustment_reason text,
  current_approval_level integer not null default 0,
  required_approval_levels integer not null default 1,
  approval_status text not null default 'PENDING',
  reimbursement_status text not null default 'NOT_REQUIRED',
  policy_status text,
  policy_violations jsonb not null default '[]'::jsonb,
  possible_duplicate boolean not null default false,
  duplicate_expense_id uuid,
  source text,
  expense_type text,
  receipt_file_id uuid,
  status text not null default 'pending',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists expense_items (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references expenses(id),
  description text not null,
  quantity numeric(14,2) not null default 1,
  unit_price numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists expense_approvals (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references expenses(id),
  approver_id uuid references users(id),
  approved_by uuid references users(id),
  approval_level integer not null default 1,
  status text not null,
  comment text,
  note text,
  approved_at timestamptz,
  rejected_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists expense_receipts (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references expenses(id),
  uploaded_by uuid references users(id),
  file_name text not null,
  file_url text not null,
  file_type text,
  file_size bigint not null default 0,
  receipt_number text,
  receipt_date date,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists expense_comments (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references expenses(id),
  user_id uuid references users(id),
  comment text not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists expense_history (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references expenses(id),
  actor_id uuid references users(id),
  action text not null,
  old_status text,
  new_status text,
  comment text,
  metadata jsonb not null default '{}'::jsonb,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists expense_reimbursements (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references expenses(id),
  employee_id uuid references employees(id),
  amount numeric(14,2) not null default 0,
  payment_method text not null default 'BANK_TRANSFER',
  account_id uuid references accounts(id),
  transaction_reference text,
  payment_date date,
  status text not null default 'PENDING',
  processed_by uuid references users(id),
  notes text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists expense_policies (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references expense_categories(id),
  department_id uuid references departments(id),
  max_amount numeric(14,2),
  requires_receipt boolean not null default false,
  receipt_required_amount numeric(14,2),
  requires_manager_approval boolean not null default true,
  requires_finance_approval boolean not null default true,
  reimbursement_allowed boolean not null default true,
  currency text not null default 'NGN',
  active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists employee_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  bank_name text not null,
  account_name text not null,
  account_number text not null,
  bank_code text,
  is_primary boolean not null default false,
  status text not null default 'ACTIVE',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists budgets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  department_id uuid references departments(id),
  amount numeric(14,2) not null default 0,
  spent_amount numeric(14,2) not null default 0,
  reserved_amount numeric(14,2) not null default 0,
  currency text not null default 'NGN',
  status text not null default 'ACTIVE',
  start_date date,
  end_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists budget_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text unique,
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists department_budgets (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references departments(id),
  budget_id uuid not null references budgets(id),
  budget_category_id uuid references budget_categories(id),
  amount numeric(14,2) not null default 0,
  spent_amount numeric(14,2) not null default 0,
  reserved_amount numeric(14,2) not null default 0,
  currency text not null default 'NGN',
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists budget_transactions (
  id uuid primary key default gen_random_uuid(),
  budget_id uuid references budgets(id),
  department_budget_id uuid references department_budgets(id),
  purchase_request_id uuid references purchase_requests(id),
  transaction_type text not null,
  amount numeric(14,2) not null default 0,
  currency text not null default 'NGN',
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

create table if not exists vendor_documents (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references vendors(id),
  file_id uuid,
  type text,
  name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists vendor_transactions (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references vendors(id),
  source_type text not null,
  source_id uuid not null,
  amount numeric(14,2) not null default 0,
  status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists operational_audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  action text not null,
  module text not null,
  record_id uuid,
  old_value jsonb,
  new_value jsonb,
  ip_address inet,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references users(id),
  action text not null,
  module text not null,
  target_id uuid,
  old_values jsonb,
  new_values jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create table if not exists technical_audit_logs (
  id uuid primary key default gen_random_uuid(),
  request_id text,
  user_id uuid references users(id),
  ip inet,
  endpoint text,
  method text,
  status_code integer,
  response_time_ms integer,
  service text,
  error jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists system_settings (
  id uuid primary key default gen_random_uuid(),
  section text not null,
  key text not null,
  value jsonb not null default '{}'::jsonb,
  updated_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (section, key)
);

create table if not exists user_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  key text not null,
  value jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, key)
);

create table if not exists integrations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  provider text not null,
  encrypted_secret text,
  status text not null default 'inactive',
  configuration jsonb not null default '{}'::jsonb,
  last_sync timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists email_configurations (
  id uuid primary key default gen_random_uuid(),
  smtp_host text,
  smtp_port integer,
  smtp_username text,
  encrypted_smtp_password text,
  sender_email text,
  sender_name text,
  encryption text,
  status text not null default 'inactive',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists notification_configurations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  channel text not null,
  trigger text not null,
  status text not null default 'enabled',
  configuration jsonb not null default '{}'::jsonb,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists document_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null,
  body text not null,
  variables jsonb not null default '[]'::jsonb,
  status text not null default 'active',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists generated_documents (
  id uuid primary key default gen_random_uuid(),
  template_id uuid references document_templates(id),
  subject_type text,
  subject_id uuid,
  file_id uuid,
  generated_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists backups (
  id uuid primary key default gen_random_uuid(),
  backup_id text not null unique,
  size_bytes bigint,
  status text not null,
  storage text,
  created_by uuid references users(id),
  restore_requires_confirmation boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists system_health (
  id uuid primary key default gen_random_uuid(),
  service text not null,
  status text not null,
  message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists files (
  id uuid primary key default gen_random_uuid(),
  owner_type text,
  owner_id uuid,
  filename text not null,
  mime_type text,
  size_bytes bigint,
  storage_key text not null,
  checksum text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table leave_types add column if not exists description text;
alter table leave_types add column if not exists default_days numeric(8,2) not null default 0;
alter table leave_types add column if not exists paid boolean not null default true;
alter table leave_types add column if not exists requires_document boolean not null default false;
alter table leave_types add column if not exists requires_approval boolean not null default true;
alter table leave_types add column if not exists carry_forward_allowed boolean not null default false;
alter table leave_types add column if not exists max_carry_forward_days numeric(8,2) not null default 0;
alter table leave_types add column if not exists status text not null default 'active';
alter table leave_types add column if not exists deleted_at timestamptz;

alter table leave_balances add column if not exists allocated_days numeric(8,2) not null default 0;
alter table leave_balances add column if not exists carried_forward_days numeric(8,2) not null default 0;
alter table leave_balances add column if not exists accrued_days numeric(8,2) not null default 0;
alter table leave_balances add column if not exists used_days numeric(8,2) not null default 0;
alter table leave_balances add column if not exists pending_days numeric(8,2) not null default 0;
alter table leave_balances add column if not exists remaining_days numeric(8,2) not null default 0;

alter table leave_requests add column if not exists duration numeric(8,2) not null default 0;
alter table leave_requests add column if not exists calendar_days numeric(8,2) not null default 0;
alter table leave_requests add column if not exists duration_type text not null default 'FULL_DAY';
alter table leave_requests add column if not exists note text;
alter table leave_requests add column if not exists submitted_at timestamptz;
alter table leave_requests add column if not exists approved_at timestamptz;
alter table leave_requests add column if not exists rejected_at timestamptz;
alter table leave_requests add column if not exists cancelled_at timestamptz;
alter table leave_requests add column if not exists withdrawn_at timestamptz;
alter table leave_requests add column if not exists rejected_by uuid references users(id);
alter table leave_requests add column if not exists cancelled_by uuid references users(id);
alter table leave_requests add column if not exists withdrawn_by uuid references users(id);
alter table leave_requests add column if not exists rejection_reason text;
alter table leave_requests add column if not exists cancellation_reason text;
alter table leave_requests add column if not exists withdrawal_reason text;
alter table users add column if not exists employee_id uuid references employees(id);
alter table employees add column if not exists employee_number text;
alter table employees add column if not exists first_name text;
alter table employees add column if not exists last_name text;
alter table employees add column if not exists date_joined date;

alter table meetings add column if not exists description text;
alter table meetings add column if not exists date date;
alter table meetings add column if not exists start_time time;
alter table meetings add column if not exists end_time time;
alter table meetings add column if not exists duration_minutes integer not null default 0;
alter table meetings add column if not exists start_at timestamptz;
alter table meetings add column if not exists end_at timestamptz;
alter table meetings add column if not exists meeting_type_id uuid references meeting_types(id);
alter table meetings add column if not exists meeting_room_id uuid references meeting_rooms(id);
alter table meetings add column if not exists department_id uuid references departments(id);
alter table meetings add column if not exists virtual_link text;
alter table meetings add column if not exists visibility text not null default 'PRIVATE';
alter table meetings add column if not exists created_by uuid references users(id);
alter table meetings add column if not exists cancelled_at timestamptz;
alter table meetings add column if not exists cancelled_by uuid references users(id);
alter table meetings add column if not exists cancellation_reason text;
alter table meetings add column if not exists postponed_at timestamptz;
alter table meetings add column if not exists postponed_by uuid references users(id);
alter table meetings add column if not exists postponement_reason text;
alter table meetings add column if not exists started_at timestamptz;
alter table meetings add column if not exists completed_at timestamptz;
alter table tasks add column if not exists meeting_id uuid references meetings(id);
alter table tasks add column if not exists target_id uuid references targets(id);

alter table targets add column if not exists description text;
alter table targets add column if not exists target_type text not null default 'EMPLOYEE';
alter table targets add column if not exists measurement_type text not null default 'NUMBER';
alter table targets add column if not exists metric_name text;
alter table targets add column if not exists target_value numeric(14,2) not null default 0;
alter table targets add column if not exists current_value numeric(14,2) not null default 0;
alter table targets add column if not exists unit text;
alter table targets add column if not exists priority text not null default 'MEDIUM';
alter table targets add column if not exists progress numeric(8,2) not null default 0;
alter table targets add column if not exists achievement_percentage numeric(8,2) not null default 0;
alter table targets add column if not exists created_by uuid references users(id);
alter table targets add column if not exists department_id uuid references departments(id);
alter table targets add column if not exists parent_target_id uuid references targets(id);
alter table targets add column if not exists completed_at timestamptz;
alter table targets add column if not exists cancelled_at timestamptz;
alter table targets add column if not exists cancelled_by uuid references users(id);
alter table targets add column if not exists status_reason text;

alter table target_progress add column if not exists value numeric(14,2) not null default 0;
alter table target_progress add column if not exists percentage numeric(8,2) not null default 0;
alter table target_progress add column if not exists recorded_by uuid references users(id);
alter table target_progress add column if not exists recorded_at timestamptz not null default now();

alter table salary_structures add column if not exists name text;
alter table salary_structures add column if not exists description text;
alter table salary_structures add column if not exists currency text not null default 'NGN';
alter table salary_structures add column if not exists status text not null default 'ACTIVE';
alter table salary_structures add column if not exists created_by uuid references users(id);
alter table salary_history add column if not exists previous_salary numeric(14,2);
alter table salary_history add column if not exists effective_from date;
alter table salary_history add column if not exists approved_by uuid references users(id);

alter table payroll add column if not exists reference text;
alter table payroll add column if not exists payroll_period_id uuid references payroll_periods(id);
alter table payroll add column if not exists gross_amount numeric(14,2) not null default 0;
alter table payroll add column if not exists total_deductions numeric(14,2) not null default 0;
alter table payroll add column if not exists net_amount numeric(14,2) not null default 0;
alter table payroll_items add column if not exists department_id uuid references departments(id);
alter table payroll_items add column if not exists payroll_run_item_id uuid references payroll_run_items(id);
alter table payslips add column if not exists payroll_run_item_id uuid references payroll_run_items(id);
alter table payslips add column if not exists employee_id uuid references employees(id);
alter table payslips add column if not exists payroll_run_id uuid references payroll_runs(id);
alter table payslips add column if not exists payslip_number text;
alter table payslips add column if not exists gross_salary numeric(14,2) not null default 0;
alter table payslips add column if not exists total_earnings numeric(14,2) not null default 0;
alter table payslips add column if not exists total_deductions numeric(14,2) not null default 0;
alter table payslips add column if not exists net_salary numeric(14,2) not null default 0;
alter table payslips add column if not exists currency text not null default 'NGN';
alter table payslips add column if not exists file_url text;
alter table payslips add column if not exists generated_at timestamptz;
alter table payslips add column if not exists content jsonb not null default '{}'::jsonb;

alter table vendors add column if not exists business_name text;
alter table vendors add column if not exists address text;
alter table vendors add column if not exists tax_id text;
alter table vendors add column if not exists bank_details jsonb not null default '{}'::jsonb;

alter table vendor_bills add column if not exists purchase_order_id uuid;
alter table vendor_bills add column if not exists invoice_number text;
alter table vendor_bills add column if not exists invoice_date date;
alter table vendor_bills add column if not exists subtotal numeric(14,2) not null default 0;
alter table vendor_bills add column if not exists tax numeric(14,2) not null default 0;
alter table vendor_bills add column if not exists total numeric(14,2) not null default 0;
alter table vendor_bills add column if not exists currency text not null default 'NGN';

alter table purchase_requests add column if not exists reference text;
alter table purchase_requests add column if not exists requester_id uuid references employees(id);
alter table purchase_requests add column if not exists description text;
alter table purchase_requests add column if not exists reason text;
alter table purchase_requests add column if not exists estimated_amount numeric(14,2) not null default 0;
alter table purchase_requests add column if not exists currency text not null default 'NGN';
alter table purchase_requests add column if not exists priority text not null default 'NORMAL';
alter table purchase_requests add column if not exists required_date date;
alter table purchase_requests add column if not exists current_approval_level integer not null default 1;
alter table purchase_requests add column if not exists required_approval_levels integer not null default 1;
alter table purchase_requests add column if not exists submitted_at timestamptz;
alter table purchase_requests add column if not exists approved_at timestamptz;
alter table purchase_requests add column if not exists rejected_at timestamptz;
alter table purchase_requests add column if not exists cancelled_at timestamptz;
alter table purchase_requests add column if not exists rejected_by uuid references users(id);
alter table purchase_requests add column if not exists cancelled_by uuid references users(id);
alter table purchase_requests add column if not exists rejection_reason text;
alter table purchase_requests add column if not exists cancellation_reason text;
alter table purchase_requests add column if not exists created_by uuid references users(id);
alter table purchase_requests add column if not exists purchase_order_id uuid;

alter table purchase_orders add column if not exists reference text;
alter table purchase_orders add column if not exists order_date date;
alter table purchase_orders add column if not exists expected_delivery_date date;
alter table purchase_orders add column if not exists subtotal numeric(14,2) not null default 0;
alter table purchase_orders add column if not exists tax numeric(14,2) not null default 0;
alter table purchase_orders add column if not exists discount numeric(14,2) not null default 0;
alter table purchase_orders add column if not exists currency text not null default 'NGN';
alter table purchase_orders add column if not exists created_by uuid references users(id);
alter table purchase_orders add column if not exists approved_by uuid references users(id);
alter table purchase_orders add column if not exists sent_at timestamptz;
alter table purchase_orders add column if not exists sent_by uuid references users(id);
alter table purchase_orders add column if not exists cancelled_at timestamptz;
alter table purchase_orders add column if not exists cancelled_by uuid references users(id);
alter table purchase_orders add column if not exists cancellation_reason text;

alter table purchase_items add column if not exists tax numeric(14,2) not null default 0;
alter table purchase_items add column if not exists discount numeric(14,2) not null default 0;
alter table purchase_items add column if not exists total numeric(14,2) not null default 0;

alter table expenses add column if not exists purchase_order_id uuid references purchase_orders(id);
alter table expenses add column if not exists vendor_bill_id uuid;
alter table expenses add column if not exists bill_id uuid references bills(id);
alter table expenses add column if not exists reference text;
alter table expenses add column if not exists description text;
alter table expenses add column if not exists notes text;
alter table expenses add column if not exists original_amount numeric(14,2) not null default 0;
alter table expenses add column if not exists approved_amount numeric(14,2);
alter table expenses add column if not exists reimbursement_amount numeric(14,2) not null default 0;
alter table expenses add column if not exists currency text not null default 'NGN';
alter table expenses add column if not exists expense_date date;
alter table expenses add column if not exists created_by uuid references users(id);
alter table expenses add column if not exists submitted_at timestamptz;
alter table expenses add column if not exists approved_by uuid references users(id);
alter table expenses add column if not exists approved_at timestamptz;
alter table expenses add column if not exists rejected_by uuid references users(id);
alter table expenses add column if not exists rejected_at timestamptz;
alter table expenses add column if not exists rejection_reason text;
alter table expenses add column if not exists cancelled_by uuid references users(id);
alter table expenses add column if not exists cancelled_at timestamptz;
alter table expenses add column if not exists cancellation_reason text;
alter table expenses add column if not exists adjusted_by uuid references users(id);
alter table expenses add column if not exists adjusted_at timestamptz;
alter table expenses add column if not exists adjustment_reason text;
alter table expenses add column if not exists current_approval_level integer not null default 0;
alter table expenses add column if not exists required_approval_levels integer not null default 1;
alter table expenses add column if not exists approval_status text not null default 'PENDING';
alter table expenses add column if not exists reimbursement_status text not null default 'NOT_REQUIRED';
alter table expenses add column if not exists policy_status text;
alter table expenses add column if not exists policy_violations jsonb not null default '[]'::jsonb;
alter table expenses add column if not exists possible_duplicate boolean not null default false;
alter table expenses add column if not exists duplicate_expense_id uuid;
alter table expenses add column if not exists source text;
alter table expenses add column if not exists expense_type text;

alter table bills add column if not exists reference text;
alter table bills add column if not exists purchase_order_id uuid references purchase_orders(id);
alter table bills add column if not exists invoice_number text;
alter table bills add column if not exists invoice_date date;
alter table bills add column if not exists subtotal numeric(14,2) not null default 0;
alter table bills add column if not exists tax_amount numeric(14,2) not null default 0;
alter table bills add column if not exists discount_amount numeric(14,2) not null default 0;
alter table bills add column if not exists total_amount numeric(14,2) not null default 0;
alter table bills add column if not exists amount_paid numeric(14,2) not null default 0;
alter table bills add column if not exists amount_due numeric(14,2) not null default 0;
alter table bills add column if not exists currency text not null default 'NGN';
alter table bills add column if not exists category_id uuid references expense_categories(id);
alter table bills add column if not exists department_id uuid references departments(id);
alter table bills add column if not exists status text not null default 'DRAFT';
alter table bills add column if not exists approval_status text not null default 'PENDING';
alter table bills add column if not exists scheduled_payment_date date;
alter table bills add column if not exists current_approval_level integer not null default 0;
alter table bills add column if not exists required_approval_levels integer not null default 1;
alter table bills add column if not exists po_match_status text not null default 'NOT_APPLICABLE';
alter table bills add column if not exists created_by uuid references users(id);
alter table bills add column if not exists approved_by uuid references users(id);
alter table bills add column if not exists approved_at timestamptz;
alter table bills add column if not exists rejected_by uuid references users(id);
alter table bills add column if not exists rejected_at timestamptz;
alter table bills add column if not exists rejection_reason text;
alter table bills add column if not exists disputed_by uuid references users(id);
alter table bills add column if not exists disputed_at timestamptz;
alter table bills add column if not exists dispute_reason text;
alter table bills add column if not exists cancelled_by uuid references users(id);
alter table bills add column if not exists cancelled_at timestamptz;
alter table bills add column if not exists cancellation_reason text;

alter table bill_payments add column if not exists payment_reference text;
alter table bill_payments add column if not exists payment_date date;
alter table bill_payments add column if not exists payment_method_id uuid;
alter table bill_payments add column if not exists bank_account_id uuid;
alter table bill_payments add column if not exists account_id uuid;
alter table bill_payments add column if not exists transaction_reference text;
alter table bill_payments add column if not exists notes text;
alter table bill_payments add column if not exists status text not null default 'PENDING';
alter table bill_payments add column if not exists processed_by uuid references users(id);
alter table bill_payments add column if not exists deleted_at timestamptz;

alter table expense_categories add column if not exists description text;
alter table expense_categories add column if not exists status text not null default 'ACTIVE';
alter table expense_categories add column if not exists requires_receipt boolean not null default false;
alter table expense_categories add column if not exists max_amount numeric(14,2);

alter table expense_approvals add column if not exists approver_id uuid references users(id);
alter table expense_approvals add column if not exists approval_level integer not null default 1;
alter table expense_approvals add column if not exists comment text;
alter table expense_approvals add column if not exists approved_at timestamptz;
alter table expense_approvals add column if not exists rejected_at timestamptz;
alter table expense_approvals add column if not exists deleted_at timestamptz;

create index if not exists idx_users_role_status on users(role, status);
create index if not exists idx_sessions_user_status on sessions(user_id, status);
create index if not exists idx_staff_members_type_status on staff_members(staff_type, status);
create index if not exists idx_staff_members_email on staff_members(email);
create index if not exists idx_departments_code on departments(code);
create index if not exists idx_departments_status_hod on departments(status, hod_id);
create index if not exists idx_employees_department on employees(department_id);
create index if not exists idx_employees_employee_id on employees(employee_id);
create index if not exists idx_employees_email on employees(email);
create index if not exists idx_employees_position on employees(position_id);
create index if not exists idx_employees_status_type on employees(status, employment_type);
create index if not exists idx_employees_created_at on employees(created_at);
create index if not exists idx_interns_status_department on interns(status, department_id);
create index if not exists idx_nysc_status_department on nysc_members(status, department_id);
create index if not exists idx_tasks_status_due_date on tasks(status, due_date);
create index if not exists idx_tasks_target on tasks(target_id);
create index if not exists idx_leave_requests_status on leave_requests(status);
create index if not exists idx_leave_requests_employee on leave_requests(employee_id);
create index if not exists idx_leave_requests_type on leave_requests(leave_type_id);
create index if not exists idx_leave_requests_dates on leave_requests(start_date, end_date);
create index if not exists idx_leave_requests_created_at on leave_requests(created_at);
create index if not exists idx_leave_balances_employee_type_year on leave_balances(employee_id, leave_type_id, year);
create index if not exists idx_leave_approvals_request_status on leave_approvals(leave_request_id, status);
create index if not exists idx_leave_history_employee on leave_history(employee_id, created_at);
create index if not exists idx_meetings_status_start on meetings(status, start_at);
create index if not exists idx_meetings_organizer on meetings(organizer_id, start_at);
create index if not exists idx_meetings_department on meetings(department_id, start_at);
create index if not exists idx_meetings_type on meetings(meeting_type_id);
create index if not exists idx_meetings_room_time on meetings(meeting_room_id, start_at, end_at);
create index if not exists idx_meeting_participants_meeting on meeting_participants(meeting_id);
create index if not exists idx_meeting_participants_user on meeting_participants(user_id);
create index if not exists idx_meeting_attendance_meeting on meeting_attendance(meeting_id);
create index if not exists idx_meeting_action_items_meeting on meeting_action_items(meeting_id);
create index if not exists idx_meeting_history_meeting on meeting_history(meeting_id, created_at);
create index if not exists idx_targets_status on targets(status);
create index if not exists idx_targets_type on targets(target_type);
create index if not exists idx_targets_department on targets(department_id);
create index if not exists idx_targets_dates on targets(start_date, end_date);
create index if not exists idx_targets_priority on targets(priority);
create index if not exists idx_target_assignments_target on target_assignments(target_id);
create index if not exists idx_target_assignments_employee on target_assignments(employee_id);
create index if not exists idx_target_assignments_department on target_assignments(department_id);
create index if not exists idx_target_progress_target on target_progress(target_id, recorded_at);
create index if not exists idx_target_milestones_target on target_milestones(target_id);
create index if not exists idx_target_history_target on target_history(target_id, created_at);
create index if not exists idx_payroll_status on payroll(status);
create index if not exists idx_salary_assignments_employee on employee_salary_assignments(employee_id, status, effective_from);
create index if not exists idx_salary_components_code on salary_components(code);
create index if not exists idx_payroll_periods_status on payroll_periods(status, start_date, end_date);
create index if not exists idx_payroll_runs_period_status on payroll_runs(payroll_period_id, status);
create index if not exists idx_payroll_runs_reference on payroll_runs(reference);
create index if not exists idx_payroll_run_items_run on payroll_run_items(payroll_run_id);
create index if not exists idx_payroll_run_items_employee on payroll_run_items(employee_id);
create index if not exists idx_earnings_run_item on earnings(payroll_run_item_id);
create index if not exists idx_deductions_run_item on deductions(payroll_run_item_id);
create index if not exists idx_employee_deductions_employee on employee_deductions(employee_id, status);
create index if not exists idx_employee_loans_employee on employee_loans(employee_id, status);
create index if not exists idx_employee_advances_employee on employee_advances(employee_id, status);
create index if not exists idx_payslips_employee on payslips(employee_id, payroll_run_id);
create index if not exists idx_payroll_payments_run_status on payroll_payments(payroll_run_id, status);
create index if not exists idx_payroll_history_run on payroll_history(payroll_run_id, created_at);
create index if not exists idx_purchases_status on purchase_requests(status);
create index if not exists idx_purchase_requests_reference on purchase_requests(reference);
create index if not exists idx_purchase_requests_requester on purchase_requests(requester_id);
create index if not exists idx_purchase_requests_department on purchase_requests(department_id, status);
create index if not exists idx_purchase_requests_created on purchase_requests(created_at);
create index if not exists idx_purchase_request_items_request on purchase_request_items(purchase_request_id);
create index if not exists idx_purchase_request_approvals_request on purchase_request_approvals(purchase_request_id, approval_level, status);
create index if not exists idx_purchase_request_history_request on purchase_request_history(purchase_request_id, created_at);
create index if not exists idx_purchase_orders_request on purchase_orders(purchase_request_id);
create index if not exists idx_purchase_orders_vendor on purchase_orders(vendor_id, status);
create index if not exists idx_purchase_order_items_order on purchase_order_items(purchase_order_id);
create index if not exists idx_purchase_receipts_order on purchase_receipts(purchase_order_id);
create index if not exists idx_vendor_quotes_request on vendor_quotes(purchase_request_id);
create index if not exists idx_vendor_bills_purchase_order on vendor_bills(purchase_order_id, status);
create index if not exists idx_budget_transactions_purchase on budget_transactions(purchase_request_id);
create unique index if not exists idx_bills_vendor_invoice_unique on bills(vendor_id, lower(invoice_number)) where invoice_number is not null and deleted_at is null;
create index if not exists idx_bills_status on bills(status);
create index if not exists idx_bills_payment_status on bills(payment_status);
create index if not exists idx_bills_vendor_status on bills(vendor_id, status);
create index if not exists idx_bills_department_status on bills(department_id, status);
create index if not exists idx_bills_due_date on bills(due_date, payment_status);
create index if not exists idx_bills_purchase_order on bills(purchase_order_id);
create index if not exists idx_bill_items_bill on bill_items(bill_id);
create index if not exists idx_bill_approvals_bill on bill_approvals(bill_id, approval_level, status);
create index if not exists idx_bill_payments_bill on bill_payments(bill_id, status);
create index if not exists idx_bill_attachments_bill on bill_attachments(bill_id);
create index if not exists idx_bill_comments_bill on bill_comments(bill_id, created_at);
create index if not exists idx_bill_history_bill on bill_history(bill_id, created_at);
create index if not exists idx_payment_methods_status on payment_methods(status);
create index if not exists idx_accounts_status on accounts(status);
create index if not exists idx_expenses_status on expenses(status);
create index if not exists idx_expenses_bill on expenses(bill_id);
create index if not exists idx_expenses_claim_employee on expenses(employee_id, status) where source = 'expense_claim' or expense_type = 'CLAIM';
create index if not exists idx_expenses_claim_department on expenses(department_id, status) where source = 'expense_claim' or expense_type = 'CLAIM';
create index if not exists idx_expenses_claim_category on expenses(category_id, expense_date) where source = 'expense_claim' or expense_type = 'CLAIM';
create index if not exists idx_expenses_claim_reimbursement on expenses(reimbursement_status) where source = 'expense_claim' or expense_type = 'CLAIM';
create index if not exists idx_expense_items_expense on expense_items(expense_id);
create index if not exists idx_expense_approvals_expense on expense_approvals(expense_id, approval_level, status);
create index if not exists idx_expense_receipts_expense on expense_receipts(expense_id);
create index if not exists idx_expense_comments_expense on expense_comments(expense_id, created_at);
create index if not exists idx_expense_history_expense on expense_history(expense_id, created_at);
create index if not exists idx_expense_reimbursements_expense on expense_reimbursements(expense_id, status);
create index if not exists idx_expense_policies_category_department on expense_policies(category_id, department_id, active);
create index if not exists idx_employee_bank_accounts_employee on employee_bank_accounts(employee_id, status);
create index if not exists idx_operational_audit_module on operational_audit_logs(module, created_at);
create index if not exists idx_audit_logs_module on audit_logs(module, created_at);
create index if not exists idx_audit_logs_actor on audit_logs(actor_id, created_at);
create index if not exists idx_technical_audit_service on technical_audit_logs(service, created_at);
create index if not exists idx_employment_history_staff on employment_history(staff_id, staff_type, created_at);
create index if not exists idx_department_activity_department on department_activity_logs(department_id, created_at);
create index if not exists idx_employee_department_history_employee on employee_department_history(employee_id, created_at);
create index if not exists idx_employee_activity_staff on employee_activity_logs(staff_id, staff_type, created_at);
