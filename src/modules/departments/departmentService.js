const crypto = require("crypto");
const { listUsers } = require("../../auth/userStore");
const { readCollection, writeCollection } = require("../../database/jsonStore");
const { applyBasicFilters, paginate, sortRecords } = require("../../utils/query");
const { ensureDefaultDepartments } = require("../lookups/catalog");
const { listHodOptions } = require("../employers/staffDirectoryService");

const ACTIVE_STATUSES = new Set(["active", "probation", "on leave"]);
const INACTIVE_HOD_STATUSES = new Set(["inactive", "suspended", "terminated", "resigned", "retired"]);

function now() {
  return new Date().toISOString();
}

function normalizeStatus(value, fallback = "active") {
  return String(value || fallback).toLowerCase();
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value || {}).filter(([, entry]) => entry !== undefined && entry !== null && entry !== "")
  );
}

function readActive(collection) {
  return readCollection(collection).filter((record) => !record.deletedAt);
}

function getDepartmentById(id) {
  return readActive("departments").find((department) => department.id === id) || null;
}

function getDepartmentName(department) {
  return department?.name || department?.departmentName || null;
}

function getDepartmentCode(department) {
  return department?.code || department?.departmentCode || null;
}

function findEmployee(idOrName) {
  if (!idOrName) {
    return null;
  }

  const requested = String(idOrName).trim().toLowerCase();
  const collections = ["employees", "interns", "nysc_members", "staff_members"];
  for (const collection of collections) {
    const record = readActive(collection).find((employee) => {
      const name = String(getEmployeeName(employee) || "").trim().toLowerCase();
      return (
        employee.id === idOrName ||
        employee.userId === idOrName ||
        employee.employeeId === idOrName ||
        employee.employee_id === idOrName ||
        String(employee.email || "").toLowerCase() === requested ||
        name === requested
      );
    });
    if (record) {
      return record;
    }
  }

  const user = listUsers().find((candidate) => {
    const name = String(candidate.fullName || candidate.name || "").trim().toLowerCase();
    return (
      candidate.id === idOrName ||
      String(candidate.email || "").toLowerCase() === requested ||
      name === requested
    );
  });
  if (!user || user.status === "deleted") {
    return null;
  }

  return {
    id: user.id,
    userId: user.id,
    fullName: user.fullName || user.name,
    name: user.name,
    email: user.email,
    status: user.status || "active",
  };
}

function getEmployeeName(employee) {
  if (!employee) {
    return null;
  }

  return (
    employee.fullName ||
    employee.name ||
    [employee.firstName, employee.middleName, employee.lastName].filter(Boolean).join(" ") ||
    employee.email ||
    null
  );
}

function getEmployeeAvatar(employee) {
  const name = getEmployeeName(employee);
  return {
    photo: employee?.profilePhoto || employee?.photo || employee?.photoUrl || null,
    initials: String(name || "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join(""),
  };
}

function ensureActiveEmployee(employeeId, label = "employee") {
  const employee = findEmployee(employeeId);
  if (!employee) {
    const error = new Error(`${label} must be an existing employee.`);
    error.statusCode = 400;
    error.publicMessage = error.message;
    throw error;
  }

  if (INACTIVE_HOD_STATUSES.has(normalizeStatus(employee.status))) {
    const error = new Error(`${label} must be active and cannot be inactive, suspended, or terminated.`);
    error.statusCode = 400;
    error.publicMessage = error.message;
    throw error;
  }

  return employee;
}

function departmentMatches(record, department) {
  const departmentId = department.id;
  const departmentName = getDepartmentName(department);
  const departmentCode = getDepartmentCode(department);

  return (
    record.departmentId === departmentId ||
    record.department_id === departmentId ||
    record.department === departmentName ||
    record.departmentName === departmentName ||
    record.departmentCode === departmentCode
  );
}

function getDepartmentMembers(department) {
  const employees = readActive("employees").filter((record) => departmentMatches(record, department));
  const interns = readActive("interns").filter((record) => departmentMatches(record, department));
  const nysc = readActive("nysc_members").filter((record) => departmentMatches(record, department));
  return { employees, interns, nysc };
}

function getHeadcountConfig() {
  const setting = readActive("system_settings").find(
    (record) => record.section === "departments" && record.key === "headcount"
  );
  const value = setting?.value || {};
  return {
    includeEmployees: value.includeEmployees !== false,
    includeInterns: value.includeInterns !== false,
    includeNysc: value.includeNysc !== false,
  };
}

function isActiveMember(record) {
  return ACTIVE_STATUSES.has(normalizeStatus(record.status));
}

function calculateHeadcount(department) {
  const config = getHeadcountConfig();
  const members = getDepartmentMembers(department);
  const employees = members.employees.filter(isActiveMember).length;
  const interns = members.interns.filter(isActiveMember).length;
  const nysc = members.nysc.filter(isActiveMember).length;
  const total =
    (config.includeEmployees ? employees : 0) +
    (config.includeInterns ? interns : 0) +
    (config.includeNysc ? nysc : 0);

  return { total, employees, interns, nysc, config };
}

function getDepartmentTasks(department) {
  return readActive("tasks").filter((record) => departmentMatches(record, department));
}

function getDepartmentTargets(department) {
  return readActive("targets").filter((record) => departmentMatches(record, department));
}

function getDepartmentExpenses(department) {
  return readActive("expenses").filter((record) => departmentMatches(record, department));
}

function getDepartmentPurchases(department) {
  return readActive("purchase_requests").filter((record) => departmentMatches(record, department));
}

function getDepartmentLeave(department) {
  const memberIds = new Set(getDepartmentMembers(department).employees.map((employee) => employee.id));
  return readActive("leave_requests").filter(
    (record) => departmentMatches(record, department) || memberIds.has(record.employeeId) || memberIds.has(record.staffId)
  );
}

function getDepartmentPayroll(department) {
  const memberIds = new Set(getDepartmentMembers(department).employees.map((employee) => employee.id));
  const payrollItems = readActive("payroll_items").filter((record) => memberIds.has(record.employeeId));
  const payroll = readActive("payroll").filter((record) => departmentMatches(record, department));
  return { payroll, payrollItems };
}

function average(values) {
  const usable = values.map(Number).filter((value) => Number.isFinite(value));
  if (!usable.length) {
    return 0;
  }

  return Math.round(usable.reduce((sum, value) => sum + value, 0) / usable.length);
}

function calculateTargetAchievement(department) {
  const targets = getDepartmentTargets(department);
  return average(
    targets.map((target) => {
      if (Number(target.targetValue) > 0) {
        return (Number(target.currentValue || 0) / Number(target.targetValue)) * 100;
      }

      if (Number(target.progress) >= 0) {
        return Number(target.progress);
      }

      if (Number(target.achievementPercentage) >= 0) {
        return Number(target.achievementPercentage);
      }

      return null;
    })
  );
}

function calculateOverview(department) {
  const headcount = calculateHeadcount(department);
  const tasks = getDepartmentTasks(department);
  const leave = getDepartmentLeave(department);
  const expenses = getDepartmentExpenses(department);
  const payroll = getDepartmentPayroll(department);
  const targets = getDepartmentTargets(department);
  const activeEmployees = getDepartmentMembers(department).employees.filter(isActiveMember).length;
  const completedTasks = tasks.filter((task) => normalizeStatus(task.status) === "completed").length;
  const pendingTasks = tasks.filter((task) => normalizeStatus(task.status) === "pending").length;
  const overdueTasks = tasks.filter(
    (task) => task.dueDate && new Date(task.dueDate).getTime() < Date.now() && normalizeStatus(task.status) !== "completed"
  ).length;
  const taskCompletion = tasks.length ? Math.round((completedTasks / tasks.length) * 100) : 0;
  const totalExpenses = expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const budget = Number(department.budget || 0);
  const targetAchievement = calculateTargetAchievement(department);

  return {
    headcount: headcount.total,
    activeEmployees,
    interns: headcount.interns,
    nysc: headcount.nysc,
    onLeave: leave.filter((request) => normalizeStatus(request.status) === "approved").length,
    pendingTasks,
    completedTasks,
    overdueTasks,
    targetAchievement,
    attendanceRate: average(readActive("attendance").filter((record) => departmentMatches(record, department)).map((record) => record.rate || record.attendanceRate)),
    taskCompletion,
    leaveRate: activeEmployees ? Math.round((leave.filter((request) => normalizeStatus(request.status) === "approved").length / activeEmployees) * 100) : 0,
    employeeProductivity: average(getDepartmentMembers(department).employees.map((employee) => employee.performanceScore)),
    projectCompletion: taskCompletion,
    budget,
    expenses: totalExpenses,
    budgetUtilization: budget > 0 ? Math.round((totalExpenses / budget) * 100) : 0,
    payroll: {
      totalPayroll: payroll.payrollItems.reduce((sum, item) => sum + Number(item.netSalary || item.net_salary || 0), 0),
      numberOfEmployees: payroll.payrollItems.length,
      salaryCost: payroll.payrollItems.reduce((sum, item) => sum + Number(item.basicSalary || item.basic_salary || 0), 0),
      allowances: payroll.payrollItems.reduce((sum, item) => sum + Number(item.allowances || 0), 0),
      deductions: payroll.payrollItems.reduce((sum, item) => sum + Number(item.deductions || 0), 0),
      overtime: payroll.payrollItems.reduce((sum, item) => sum + Number(item.overtime || 0), 0),
      bonuses: payroll.payrollItems.reduce((sum, item) => sum + Number(item.bonuses || 0), 0),
      netPayroll: payroll.payrollItems.reduce((sum, item) => sum + Number(item.netSalary || item.net_salary || 0), 0),
    },
    targetCount: targets.length,
  };
}

function getDepartmentHod(department) {
  const hodId = department.hodId || department.hod_id || department.headEmployeeId || department.head_employee_id;
  const employee = hodId ? findEmployee(hodId) : null;
  if (employee) {
    return {
      id: employee.id,
      name: getEmployeeName(employee),
      avatar: getEmployeeAvatar(employee),
      status: employee.status || "active",
      email: employee.email || null,
    };
  }

  const hodName = department.hodName || department.headOfDepartment || department.hod || null;
  if (!hodName) {
    return null;
  }

  return {
    id: null,
    name: hodName,
    avatar: getEmployeeAvatar({}),
    status: "pending",
    email: null,
  };
}

function hasValidHod(department) {
  const hod = getDepartmentHod(department);
  return Boolean(hod && !INACTIVE_HOD_STATUSES.has(normalizeStatus(hod.status)));
}

function buildDepartmentCard(department) {
  const overview = calculateOverview(department);
  const hod = getDepartmentHod(department);
  return {
    id: department.id,
    icon: department.icon || null,
    name: getDepartmentName(department),
    code: getDepartmentCode(department),
    description: department.description || null,
    status: department.status || "active",
    hod,
    assistantHod: department.assistantHodId || department.assistant_hod_id ? getEmployeeName(findEmployee(department.assistantHodId || department.assistant_hod_id)) : null,
    branch: department.branch || department.branchName || null,
    branchId: department.branchId || department.branch_id || null,
    location: department.location || null,
    budget: Number(department.budget || 0),
    email: department.email || null,
    phone: department.phone || null,
    logo: department.logo || department.logoUrl || null,
    color: department.color || null,
    workingHours: department.workingHours || null,
    headcount: overview.headcount,
    employees: overview.activeEmployees,
    interns: overview.interns,
    nysc: overview.nysc,
    targetAchievement: overview.targetAchievement,
    createdAt: department.createdAt,
    updatedAt: department.updatedAt,
  };
}

function filterDepartments(departments, query = {}) {
  let filtered = applyBasicFilters(
    departments,
    {
      page: query.page,
      limit: query.limit,
      sortBy: query.sortBy,
      sortDirection: query.sortDirection,
      q: query.q || query.search,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
    },
    [
    "name",
    "code",
    "description",
    "branch",
    "location",
    "status",
    ]
  );

  if (query.filter === "active" || query.tab === "active") {
    filtered = filtered.filter((department) => normalizeStatus(department.status) === "active");
  }

  if (query.filter === "no_hod" || query.tab === "no_hod") {
    filtered = filtered.filter((department) => normalizeStatus(department.status) === "active" && !hasValidHod(department));
  }

  if (query.hod) {
    filtered = filtered.filter((department) => {
      const hod = getDepartmentHod(department);
      return String(hod?.name || "").toLowerCase().includes(String(query.hod).toLowerCase());
    });
  }

  const sortBy = query.sort || query.sortBy || "name";
  if (["headcount", "targetAchievement", "expenses"].includes(sortBy)) {
    return [...filtered].sort((left, right) => {
      const leftCard = buildDepartmentCard(left);
      const rightCard = buildDepartmentCard(right);
      const direction = String(query.order || query.sortDirection).toLowerCase() === "desc" ? -1 : 1;
      return (Number(leftCard[sortBy] || 0) - Number(rightCard[sortBy] || 0)) * direction;
    });
  }

  return sortRecords(filtered, sortBy === "createdDate" ? "createdAt" : sortBy, query.order || query.sortDirection || "asc");
}

function listDepartments(query = {}) {
  ensureDefaultDepartments();
  const departments = filterDepartments(readActive("departments"), query);
  const result = paginate(departments, query);
  const cards = result.data.map(buildDepartmentCard);
  const allDepartments = readActive("departments");

  return {
    data: cards,
    meta: {
      ...result.meta,
      summary: {
        departments: allDepartments.length,
        totalHeadcount: allDepartments.reduce((sum, department) => sum + calculateHeadcount(department).total, 0),
        hodNotAssigned: allDepartments.filter(
          (department) => normalizeStatus(department.status) === "active" && !hasValidHod(department)
        ).length,
      },
      filters: {
        tabs: [
          { key: "all", label: "All Departments", count: allDepartments.length },
          {
            key: "active",
            label: "Active",
            count: allDepartments.filter((department) => normalizeStatus(department.status) === "active").length,
          },
          {
            key: "no_hod",
            label: "No HOD",
            count: allDepartments.filter(
              (department) => normalizeStatus(department.status) === "active" && !hasValidHod(department)
            ).length,
          },
        ],
      },
      hods: listHodOptions(),
    },
  };
}

function writeDepartment(departments) {
  writeCollection("departments", departments);
}

function ensureUniqueCode(code, existingId) {
  if (!code) {
    return;
  }

  const exists = readActive("departments").some(
    (department) => department.id !== existingId && String(getDepartmentCode(department)).toLowerCase() === String(code).toLowerCase()
  );
  if (exists) {
    const error = new Error("Department code must be unique.");
    error.statusCode = 409;
    error.publicMessage = error.message;
    throw error;
  }
}

function generateDepartmentCode(name, existingId) {
  const words = String(name || "").trim().split(/[^A-Za-z0-9]+/).filter(Boolean);
  const base = (
    words.length >= 2 ? words.map((word) => word[0]).join("") : words[0] || "DEPT"
  )
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8) || "DEPT";

  let code = base;
  let suffix = 1;
  while (
    readActive("departments").some(
      (department) =>
        department.id !== existingId && String(getDepartmentCode(department) || "").toUpperCase() === code
    )
  ) {
    suffix += 1;
    code = `${base}-${suffix}`;
  }
  return code;
}

function resolveHodReference(value, label = "HOD") {
  if (!value) {
    return { hodId: null, hodName: null };
  }

  const employee = findEmployee(value);
  if (!employee) {
    const error = new Error("HOD must be an existing user on the system.");
    error.statusCode = 400;
    error.publicMessage = error.message;
    error.code = "HOD_NOT_FOUND";
    throw error;
  }

  ensureActiveEmployee(employee.id, label);
  return { hodId: employee.id, hodName: getEmployeeName(employee) };
}

function normalizeDepartmentPayload(payload = {}) {
  const hodValue =
    payload.hodId ||
    payload.hod_id ||
    payload.headEmployeeId ||
    payload.head_employee_id ||
    payload.headOfDepartment ||
    payload.head_of_department ||
    payload.hodName ||
    payload.hod_name ||
    payload.hod ||
    payload.head;
  const assistantHodValue = payload.assistantHodId || payload.assistant_hod_id || payload.assistantHod || payload.assistant_hod;
  const hod = resolveHodReference(hodValue, "HOD");
  const assistantHod = resolveHodReference(assistantHodValue, "Assistant HOD");
  const name = payload.name || payload.departmentName || payload.department_name || payload.title;

  return compactObject({
    name,
    code: payload.code || payload.departmentCode || payload.department_code,
    description: payload.description,
    hodId: hod.hodId,
    hodName: hod.hodName,
    assistantHodId: assistantHod.hodId,
    assistantHodName: assistantHod.hodName,
    branchId: payload.branchId || payload.branch_id,
    branch: payload.branch,
    location: payload.location,
    email: payload.email,
    phone: payload.phone,
    budget: payload.budget,
    status: normalizeStatus(payload.status || "active"),
    logo: payload.logo || payload.logoUrl,
    color: payload.color,
    workingHours: payload.workingHours,
  });
}

function createDepartment(payload, actor, req) {
  const normalized = normalizeDepartmentPayload(payload);
  if (!normalized.name) {
    const error = new Error("Department name is required.");
    error.statusCode = 400;
    error.publicMessage = error.message;
    error.code = "DEPARTMENT_NAME_REQUIRED";
    throw error;
  }
  if (!normalized.code) {
    normalized.code = generateDepartmentCode(normalized.name);
  }

  ensureUniqueCode(normalized.code);
  const timestamp = now();
  const department = {
    id: crypto.randomUUID(),
    ...normalized,
    createdBy: actor?.id || null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const departments = readCollection("departments");
  departments.push(department);
  writeDepartment(departments);
  recordDepartmentActivity(department.id, actor, "Department Created", null, buildDepartmentCard(department), req);
  return buildDepartmentCard(department);
}

function updateDepartment(id, payload, actor, req) {
  const departments = readCollection("departments");
  const index = departments.findIndex((department) => department.id === id && !department.deletedAt);
  if (index === -1) {
    return null;
  }

  const normalized = normalizeDepartmentPayload(payload);
  ensureUniqueCode(normalized.code, id);
  const oldValue = buildDepartmentCard(departments[index]);
  departments[index] = { ...departments[index], ...normalized, id, updatedAt: now() };
  writeDepartment(departments);
  const newValue = buildDepartmentCard(departments[index]);
  recordDepartmentActivity(id, actor, "Department Updated", oldValue, newValue, req);
  return { oldValue, record: newValue };
}

function softDeleteDepartment(id, actor, req) {
  const departments = readCollection("departments");
  const index = departments.findIndex((department) => department.id === id && !department.deletedAt);
  if (index === -1) {
    return null;
  }

  const oldValue = buildDepartmentCard(departments[index]);
  departments[index] = {
    ...departments[index],
    status: "inactive",
    deletedAt: now(),
    deletedBy: actor?.id || null,
    updatedAt: now(),
  };
  writeDepartment(departments);
  const newValue = buildDepartmentCard(departments[index]);
  recordDepartmentActivity(id, actor, "Department Soft Deleted", oldValue, newValue, req);
  return { oldValue, record: newValue };
}

function recordDepartmentActivity(departmentId, actor, action, oldValue, newValue, req) {
  const timestamp = now();
  const activity = readCollection("department_activity_logs");
  const record = {
    id: crypto.randomUUID(),
    actorId: actor?.id || null,
    departmentId,
    action,
    oldValue: oldValue || null,
    newValue: newValue || null,
    ipAddress: req?.ip || null,
    userAgent: req?.get ? req.get("user-agent") : null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  activity.push(record);
  writeCollection("department_activity_logs", activity);

  const history = readCollection("department_history");
  history.push(record);
  writeCollection("department_history", history);
  return record;
}

function setDepartmentStatus(id, status, payload, actor, req) {
  const department = getDepartmentById(id);
  if (!department) {
    return null;
  }

  const activeHeadcount = calculateHeadcount(department).total;
  if (status === "inactive" && activeHeadcount > 0 && payload?.confirmation !== "DEACTIVATE DEPARTMENT") {
    const error = new Error(`This department currently has ${activeHeadcount} active members.`);
    error.statusCode = 409;
    error.publicMessage = error.message;
    error.details = {
      activeHeadcount,
      options: ["remain_assigned_temporarily", "transfer_to_another_department"],
      confirmation: "DEACTIVATE DEPARTMENT",
    };
    throw error;
  }

  if (status === "inactive" && payload?.transferDepartmentId) {
    transferDepartmentMembers(department, payload.transferDepartmentId, payload.reason, actor, req);
  }

  return updateDepartment(id, { status }, actor, req);
}

function transferDepartmentMembers(previousDepartment, newDepartmentId, reason, actor, req) {
  const newDepartment = getDepartmentById(newDepartmentId);
  if (!newDepartment) {
    const error = new Error("Transfer department does not exist.");
    error.statusCode = 400;
    error.publicMessage = error.message;
    throw error;
  }

  for (const collection of ["employees", "interns", "nysc_members"]) {
    const records = readCollection(collection);
    for (let index = 0; index < records.length; index += 1) {
      if (!records[index].deletedAt && departmentMatches(records[index], previousDepartment) && isActiveMember(records[index])) {
        const oldValue = { ...records[index] };
        records[index] = {
          ...records[index],
          departmentId: newDepartment.id,
          department: getDepartmentName(newDepartment),
          updatedAt: now(),
        };
        recordEmployeeDepartmentTransfer(records[index], previousDepartment, newDepartment, reason, actor, req);
        recordDepartmentActivity(
          previousDepartment.id,
          actor,
          "Department Member Transferred",
          oldValue,
          records[index],
          req
        );
      }
    }
    writeCollection(collection, records);
  }
}

function recordEmployeeDepartmentTransfer(member, previousDepartment, newDepartment, reason, actor, req) {
  const records = readCollection("employee_department_history");
  const timestamp = now();
  records.push({
    id: crypto.randomUUID(),
    employeeId: member.id,
    staffId: member.id,
    previousDepartmentId: previousDepartment.id,
    previousDepartment: getDepartmentName(previousDepartment),
    newDepartmentId: newDepartment.id,
    newDepartment: getDepartmentName(newDepartment),
    reason: reason || null,
    approvedBy: actor?.id || null,
    effectiveDate: timestamp,
    ipAddress: req?.ip || null,
    userAgent: req?.get ? req.get("user-agent") : null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  writeCollection("employee_department_history", records);
}

function setHod(id, employeeId, actor, req, assistant = false) {
  ensureActiveEmployee(employeeId, assistant ? "Assistant HOD" : "HOD");
  const field = assistant ? "assistantHodId" : "hodId";
  const result = updateDepartment(id, { [field]: employeeId }, actor, req);
  if (result) {
    recordDepartmentActivity(
      id,
      actor,
      assistant ? "Assistant HOD Changed" : "HOD Changed",
      result.oldValue,
      result.record,
      req
    );
  }
  return result;
}

function removeHod(id, actor, req) {
  const result = updateDepartment(id, { hodId: null }, actor, req);
  if (result) {
    const departments = readCollection("departments");
    const index = departments.findIndex((department) => department.id === id && !department.deletedAt);
    if (index !== -1) {
      departments[index].hodId = null;
      departments[index].updatedAt = now();
      writeDepartment(departments);
      result.record = buildDepartmentCard(departments[index]);
    }
    recordDepartmentActivity(id, actor, "HOD Removed", result.oldValue, result.record, req);
  }
  return result;
}

function getDepartmentProfile(id) {
  const department = getDepartmentById(id);
  if (!department) {
    return null;
  }

  const members = getDepartmentMembers(department);
  return {
    overview: {
      ...buildDepartmentCard(department),
      summary: calculateOverview(department),
    },
    employees: members.employees,
    interns: members.interns,
    nysc: members.nysc,
    hod: getDepartmentHod(department),
    tasks: getDepartmentTasks(department),
    targets: getDepartmentTargets(department),
    leave: getDepartmentLeave(department),
    attendance: readActive("attendance").filter((record) => departmentMatches(record, department)),
    payroll: getDepartmentPayroll(department),
    expenses: getDepartmentExpenses(department),
    purchases: getDepartmentPurchases(department),
    meetings: readActive("meetings").filter((record) => departmentMatches(record, department)),
    events: readActive("events").filter((record) => departmentMatches(record, department)),
    performance: calculateOverview(department),
    reports: readActive("reports").filter((record) => departmentMatches(record, department)),
    documents: readActive("department_documents").filter((record) => record.departmentId === id),
    activity: readActive("department_activity_logs").filter((record) => record.departmentId === id),
  };
}

function getDepartmentRelation(id, relation, query = {}) {
  const department = getDepartmentById(id);
  if (!department) {
    return null;
  }

  const profile = getDepartmentProfile(id);
  const relationData = profile[relation] || [];
  const data = Array.isArray(relationData) ? relationData : relationData.payrollItems || relationData.payroll || [];
  const filtered = applyBasicFilters(data, { ...query, q: query.q || query.search }, [
    "name",
    "fullName",
    "employeeId",
    "title",
    "status",
    "priority",
    "email",
    "position",
    "employmentType",
  ]);
  return paginate(filtered, query);
}

function getDepartmentActivity(id, query = {}) {
  const data = applyBasicFilters(readActive("department_activity_logs"), { ...query, departmentId: id }, ["action"]);
  return paginate(data, query);
}

module.exports = {
  createDepartment,
  getDepartmentActivity,
  getDepartmentById,
  getDepartmentProfile,
  getDepartmentRelation,
  listDepartments,
  removeHod,
  setDepartmentStatus,
  setHod,
  softDeleteDepartment,
  updateDepartment,
};
