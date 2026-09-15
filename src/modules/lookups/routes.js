const express = require("express");
const { authenticate } = require("../../auth/middleware");
const { listHodOptions } = require("../employers/staffDirectoryService");
const meetingRepository = require("../meetings/meeting.repository");
const { getLookups } = require("./catalog");

const lookupsRouter = express.Router();

function meetingTypeOptions() {
  return meetingRepository.listMeetingTypes({ limit: 100 }).data.map((type) => ({
    id: type.id,
    name: type.name,
    code: type.code,
    requiresLocation: Boolean(type.requiresLocation),
    requiresVirtualLink: Boolean(type.requiresVirtualLink),
  }));
}

function withPeople(lookups) {
  const employees = listHodOptions();
  return {
    ...lookups,
    employees,
    hods: employees,
    meetingTypes: meetingTypeOptions(),
  };
}

lookupsRouter.use(authenticate);

lookupsRouter.get("/", (_req, res) => {
  return res.json({
    success: true,
    message: "Lookups loaded.",
    data: withPeople(getLookups()),
    meta: {},
  });
});

lookupsRouter.get("/departments", (_req, res) => {
  return res.json({
    success: true,
    message: "Departments loaded.",
    data: getLookups().departments,
    meta: {},
  });
});

lookupsRouter.get("/employment-types", (_req, res) => {
  return res.json({
    success: true,
    message: "Employment types loaded.",
    data: getLookups().employmentTypes,
    meta: {},
  });
});

lookupsRouter.get("/employees", (_req, res) => {
  return res.json({
    success: true,
    message: "Employees loaded.",
    data: listHodOptions(),
    meta: {},
  });
});

lookupsRouter.get("/hods", (_req, res) => {
  return res.json({
    success: true,
    message: "HOD options loaded.",
    data: listHodOptions(),
    meta: {},
  });
});

lookupsRouter.get("/meeting-types", (_req, res) => {
  return res.json({
    success: true,
    message: "Meeting types loaded.",
    data: meetingTypeOptions(),
    meta: {},
  });
});

module.exports = { lookupsRouter };
