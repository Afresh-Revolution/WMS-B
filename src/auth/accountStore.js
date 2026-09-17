const postgresUserStore = require("./postgresUserStore");
const localUserStore = require("./userStore");

function usingPostgres() {
  return postgresUserStore.isEnabled();
}

function toLocalPayload(user, extras = {}) {
  return {
    id: user.id,
    name: user.fullName || user.name,
    fullName: user.fullName || user.name,
    email: user.email,
    phone: user.phone,
    passwordHash: extras.passwordHash || user.passwordHash,
    role: user.role,
    roleId: user.roleId || user.role,
    permissions: user.permissions || [],
    status: user.status || "active",
    accountType: user.accountType,
    department: user.department || extras.department || null,
    departmentId: user.departmentId,
    employeeId: user.employeeId,
    jobTitle: user.jobTitle || extras.jobTitle || null,
    createdBy: user.createdBy,
    mustChangePassword: user.mustChangePassword,
  };
}

function mirrorLocal(user, extras = {}) {
  if (!user?.email) {
    return user;
  }

  const existing = localUserStore.getUserById(user.id) || localUserStore.getUserByEmail(user.email);
  const passwordHash = extras.passwordHash || user.passwordHash || existing?.passwordHash;
  if (!passwordHash && !existing) {
    return user;
  }

  if (existing) {
    localUserStore.updateUser(existing.id, {
      name: user.fullName || user.name || existing.name,
      fullName: user.fullName || user.name || existing.fullName,
      phone: user.phone !== undefined ? user.phone : existing.phone,
      role: user.role || existing.role,
      status: user.status || existing.status,
      department: user.department || existing.department,
      departmentId: user.departmentId || existing.departmentId,
      employeeId: user.employeeId || existing.employeeId,
      jobTitle: user.jobTitle || existing.jobTitle,
    });
    if (passwordHash && passwordHash !== existing.passwordHash) {
      localUserStore.updateUserPassword(existing.id, passwordHash);
    }
    return localUserStore.getUserById(existing.id) || user;
  }

  return localUserStore.createUser(toLocalPayload(user, { ...extras, passwordHash }));
}

async function createUser(payload) {
  if (usingPostgres()) {
    const user = await postgresUserStore.createUser(payload);
    mirrorLocal(user, { passwordHash: payload.passwordHash, department: payload.department, jobTitle: payload.jobTitle });
    return user;
  }
  return localUserStore.createUser(payload);
}

async function createSuperadmin(payload) {
  if (usingPostgres()) {
    const user = await postgresUserStore.createSuperadmin(payload);
    mirrorLocal(user, { passwordHash: payload.passwordHash });
    return user;
  }
  return localUserStore.createSuperadmin(payload);
}

async function getUserByEmail(email) {
  if (usingPostgres()) {
    return (await postgresUserStore.getUserByEmail(email)) || localUserStore.getUserByEmail(email);
  }
  return localUserStore.getUserByEmail(email);
}

async function getUserById(id) {
  if (usingPostgres()) {
    return (await postgresUserStore.getUserById(id)) || localUserStore.getUserById(id);
  }
  return localUserStore.getUserById(id);
}

async function hasSuperadmin() {
  return usingPostgres() ? postgresUserStore.hasSuperadmin() : localUserStore.hasSuperadmin();
}

async function listUsers() {
  if (usingPostgres()) {
    const users = await postgresUserStore.listUsers();
    return users.map((user) => localUserStore.sanitizeUser(user));
  }
  return localUserStore.listUsers();
}

async function updateUser(id, payload) {
  if (usingPostgres()) {
    const user = await postgresUserStore.updateUser(id, payload);
    if (user) {
      mirrorLocal(user, payload);
    }
    return user;
  }
  return localUserStore.updateUser(id, payload);
}

async function updateUserPassword(id, passwordHash) {
  if (usingPostgres()) {
    const user = await postgresUserStore.updateUserPassword(id, passwordHash);
    if (user) {
      mirrorLocal(user, { passwordHash });
    }
    return user;
  }
  return localUserStore.updateUserPassword(id, passwordHash);
}

async function syncAllUsersToSupabase({ logger = console } = {}) {
  if (!usingPostgres()) {
    return { enabled: false, synced: 0, mirrored: 0 };
  }

  await postgresUserStore.ensureSchema();
  let synced = 0;
  for (const user of localUserStore.listRawUsers()) {
    if (!user.email || !user.passwordHash) {
      continue;
    }
    await postgresUserStore.upsertUser(user);
    synced += 1;
  }

  const remote = await postgresUserStore.listUsers();
  let mirrored = 0;
  for (const user of remote) {
    mirrorLocal(user, { passwordHash: user.passwordHash });
    mirrored += 1;
  }

  logger.log(`Synced ${synced} local users into Supabase and mirrored ${mirrored} accounts locally.`);
  return { enabled: true, synced, mirrored };
}

module.exports = {
  createSuperadmin,
  createUser,
  getUserByEmail,
  getUserById,
  hasSuperadmin,
  isEnabled: usingPostgres,
  listUsers,
  sanitizeUser: localUserStore.sanitizeUser,
  syncAllUsersToSupabase,
  updateUser,
  updateUserPassword,
  usingPostgres,
};
