const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

process.env.NODE_ENV = "test";
process.env.AUTH_TOKEN_SECRET = "test-secret-that-is-long-enough-for-procurement";
process.env.SUPERADMIN_SETUP_TOKEN = "setup-token";

const { issueAccessToken } = require("../src/auth/tokens");
const { getUserById } = require("../src/auth/userStore");
const { createApp } = require("../src/app");

function createTestApp(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "wms-procurement-"));
  process.env.DATA_DIR = dataDir;
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  return createApp();
}

async function bootstrapSuperadmin(baseUrl) {
  const response = await fetch(`${baseUrl}/api/v1/auth/bootstrap`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Main Admin",
      email: "admin@example.com",
      password: "password123",
      setupToken: "setup-token",
    }),
  });
  assert.equal(response.status, 201);
  return response.json();
}

test("tracks purchase request lifecycle with backend-calculated totals, approval, order, and receiving", async (t) => {
  const app = createTestApp(t);
  const server = app.listen(0);
  t.after(() => server.close());

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const auth = await bootstrapSuperadmin(baseUrl);
  const adminHeaders = {
    "content-type": "application/json",
    authorization: `Bearer ${auth.token}`,
  };

  const departmentResponse = await fetch(`${baseUrl}/api/v1/departments`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ name: "Media", code: "MEDIA-001", status: "active" }),
  });
  assert.equal(departmentResponse.status, 201);
  const department = await departmentResponse.json();

  const employeeResponse = await fetch(`${baseUrl}/api/v1/employers`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      staffType: "employee",
      personalInformation: {
        firstName: "Nina",
        lastName: "Patel",
        email: "nina.procurement@example.com",
      },
      employmentInformation: {
        employeeId: "EMP-PRQ-001",
        jobTitle: "Media Lead",
        departmentId: department.data.id,
        department: "Media",
        employmentType: "Full-time",
        status: "active",
      },
      systemAccess: {
        createAccount: true,
        email: "nina.procurement@example.com",
        initialPassword: "password123",
        role: "employee",
      },
    }),
  });
  assert.equal(employeeResponse.status, 201);
  const employee = await employeeResponse.json();
  const employeeUser = getUserById(employee.data.userId);
  const employeeHeaders = {
    "content-type": "application/json",
    authorization: `Bearer ${issueAccessToken(employeeUser)}`,
  };

  const vendorResponse = await fetch(`${baseUrl}/api/v1/vendors`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      name: "Creative Vendor Ltd",
      businessName: "Creative Vendor Ltd",
      email: "vendor@example.com",
      status: "active",
    }),
  });
  assert.equal(vendorResponse.status, 201);
  const vendor = await vendorResponse.json();

  const requestResponse = await fetch(`${baseUrl}/api/v1/purchase-requests`, {
    method: "POST",
    headers: employeeHeaders,
    body: JSON.stringify({
      title: "Adobe Creative Cloud renewal",
      description: "Annual software licenses",
      departmentId: department.data.id,
      reason: "Required for design and media production",
      priority: "NORMAL",
      requiredDate: "2026-08-30",
      estimatedTotal: 10,
      items: [
        {
          description: "Adobe Creative Cloud",
          quantity: 8,
          unit: "license",
          estimatedUnitPrice: 12000,
          estimatedTotal: 10,
        },
      ],
    }),
  });
  assert.equal(requestResponse.status, 201);
  const request = await requestResponse.json();
  assert.equal(request.data.status, "SUBMITTED");
  assert.equal(request.data.estimatedAmount, 96000);
  assert.equal(request.data.items[0].estimatedTotal, 96000);
  assert.equal(request.data.currentApprovalLevel, 1);

  const selfApproveResponse = await fetch(`${baseUrl}/api/v1/purchase-requests/${request.data.id}/approve`, {
    method: "POST",
    headers: employeeHeaders,
    body: JSON.stringify({ comment: "I approve myself" }),
  });
  assert.equal(selfApproveResponse.status, 403);

  const approveResponse = await fetch(`${baseUrl}/api/v1/purchase-requests/${request.data.id}/approve`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ comment: "Approved for department use" }),
  });
  assert.equal(approveResponse.status, 200);
  const approved = await approveResponse.json();
  assert.equal(approved.data.status, "APPROVED");

  const commentResponse = await fetch(`${baseUrl}/api/v1/purchase-requests/${request.data.id}/comments`, {
    method: "POST",
    headers: employeeHeaders,
    body: JSON.stringify({ comment: "Attached supporting quotation." }),
  });
  assert.equal(commentResponse.status, 201);

  const attachmentResponse = await fetch(`${baseUrl}/api/v1/purchase-requests/${request.data.id}/attachments`, {
    method: "POST",
    headers: employeeHeaders,
    body: JSON.stringify({
      fileName: "quotation.pdf",
      fileUrl: "https://example.com/quotation.pdf",
      fileType: "application/pdf",
      fileSize: 1024,
    }),
  });
  assert.equal(attachmentResponse.status, 201);

  const vendorSelectionResponse = await fetch(`${baseUrl}/api/v1/purchase-requests/${request.data.id}/vendor`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      vendorId: vendor.data.id,
      quoteReference: "Q-100",
      amount: 88000,
    }),
  });
  assert.equal(vendorSelectionResponse.status, 200);
  const withVendor = await vendorSelectionResponse.json();
  assert.equal(withVendor.data.vendorId, vendor.data.id);

  const orderResponse = await fetch(`${baseUrl}/api/v1/purchase-orders`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      purchaseRequestId: request.data.id,
      vendorId: vendor.data.id,
      total: 1,
      items: [{ description: "Adobe Creative Cloud", quantity: 8, unitPrice: 11000, total: 1 }],
    }),
  });
  assert.equal(orderResponse.status, 201);
  const order = await orderResponse.json();
  assert.equal(order.data.status, "DRAFT");
  assert.equal(order.data.total, 88000);
  assert.equal(order.meta.request.status, "ORDERED");

  const sendResponse = await fetch(`${baseUrl}/api/v1/purchase-orders/${order.data.id}/send`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({}),
  });
  assert.equal(sendResponse.status, 200);

  const receiptResponse = await fetch(`${baseUrl}/api/v1/purchase-orders/${order.data.id}/receive`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      items: [{ purchaseOrderItemId: order.data.items[0].id, quantityReceived: 8, quantityRejected: 0 }],
      notes: "Delivered in full",
    }),
  });
  assert.equal(receiptResponse.status, 201);
  const receipt = await receiptResponse.json();
  assert.equal(receipt.data.status, "COMPLETE");
  assert.equal(receipt.meta.order.status, "DELIVERED");

  const detailsResponse = await fetch(`${baseUrl}/api/v1/purchase-requests/${request.data.id}`, { headers: adminHeaders });
  assert.equal(detailsResponse.status, 200);
  const details = await detailsResponse.json();
  assert.equal(details.data.status, "DELIVERED");
  assert.equal(details.data.comments.length, 1);
  assert.equal(details.data.attachments.length, 1);
  assert.equal(details.data.history.some((entry) => entry.action === "DELIVERED"), true);

  const dashboardResponse = await fetch(`${baseUrl}/api/v1/purchase-requests/dashboard`, { headers: adminHeaders });
  assert.equal(dashboardResponse.status, 200);
  const dashboard = await dashboardResponse.json();
  assert.equal(dashboard.data.totalValue, 96000);
  assert.equal(dashboard.data.approved, 1);

  const reportsResponse = await fetch(`${baseUrl}/api/v1/purchase-requests/reports`, { headers: adminHeaders });
  assert.equal(reportsResponse.status, 200);
  const reports = await reportsResponse.json();
  assert.equal(reports.data.totalRequests, 1);
  assert.equal(reports.data.totalPurchasedValue, 88000);
});
