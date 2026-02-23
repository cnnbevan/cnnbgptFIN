const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();
const PORT = Number(process.env.PORT || process.env.API_PORT || 3301);

const dbConfig = {
  host: process.env.DB_HOST || '192.168.11.19',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'evanevan2025',
  database: process.env.DB_NAME || 'cnnbgptFIN'
};

const crmDbConfig = {
  host: process.env.CRM_DB_HOST || process.env.DB_HOST || '192.168.11.19',
  port: Number(process.env.CRM_DB_PORT || process.env.DB_PORT || 3306),
  user: process.env.CRM_DB_USER || process.env.DB_USER || 'root',
  password: process.env.CRM_DB_PASSWORD || process.env.DB_PASSWORD || 'evanevan2025',
  database: process.env.CRM_DB_NAME || 'cnnbgptCRM',
  charset: 'utf8mb4'
};

const erpDbConfig = {
  host: process.env.ERP_DB_HOST || process.env.DB_HOST || '192.168.11.19',
  port: Number(process.env.ERP_DB_PORT || process.env.DB_PORT || 3306),
  user: process.env.ERP_DB_USER || process.env.DB_USER || 'root',
  password: process.env.ERP_DB_PASSWORD || process.env.DB_PASSWORD || 'evanevan2025',
  database: process.env.ERP_DB_NAME || 'cnnbgptERP',
  charset: 'utf8mb4'
};

const pool = mysql.createPool({
  ...dbConfig,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  dateStrings: true
});

app.use(cors());
app.use(bodyParser.json());

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

const getOne = async (sql, params = []) => {
  const [rows] = await pool.execute(sql, params);
  return rows[0] || null;
};

const getAll = async (sql, params = []) => {
  const [rows] = await pool.execute(sql, params);
  return rows;
};

const run = async (sql, params = []) => {
  const [result] = await pool.execute(sql, params);
  return result;
};

const toAmount = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
};

const todayDateString = () => new Date().toISOString().slice(0, 10);

const toDateString = (value) => {
  if (!value) return todayDateString();
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return todayDateString();
  return d.toISOString().slice(0, 10);
};

const addDays = (value, days) => {
  const d = new Date(`${toDateString(value)}T00:00:00`);
  d.setDate(d.getDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
};

const calcReceivableStatus = (amountDue, amountReceived, dueDate) => {
  const due = toAmount(amountDue);
  const received = toAmount(amountReceived);
  if (received >= due) return 'received';
  if (dueDate && String(dueDate) < todayDateString()) return 'overdue';
  if (received > 0) return 'partial';
  return 'open';
};

const calcPayableStatus = (amountDue, amountPaid, dueDate) => {
  const due = toAmount(amountDue);
  const paid = toAmount(amountPaid);
  if (paid >= due) return 'paid';
  if (dueDate && String(dueDate) < todayDateString()) return 'overdue';
  if (paid > 0) return 'partial';
  return 'open';
};

const normalizeDateTimeInput = (value) => {
  if (!value) return null;
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s} 00:00:00`;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  return `${m[1]} ${m[2]}:${m[3] || '00'}`;
};

const ensureCustomer = async (id) => getOne('SELECT * FROM fin_customers WHERE id = ? AND status = ?', [id, 'active']);
const ensureVendor = async (id) => getOne('SELECT * FROM fin_vendors WHERE id = ? AND status = ?', [id, 'active']);
const ensureAccount = async (id) => getOne('SELECT * FROM fin_cash_accounts WHERE id = ? AND status = ?', [id, 'active']);

const refreshAgingStatus = async () => {
  await run(
    `UPDATE fin_receivables
     SET status = CASE
       WHEN amount_received >= amount_due THEN 'received'
       WHEN due_date < CURDATE() THEN 'overdue'
       WHEN amount_received > 0 THEN 'partial'
       ELSE 'open'
     END`
  );
  await run(
    `UPDATE fin_payables
     SET status = CASE
       WHEN amount_paid >= amount_due THEN 'paid'
       WHEN due_date < CURDATE() THEN 'overdue'
       WHEN amount_paid > 0 THEN 'partial'
       ELSE 'open'
     END`
  );
};

const normalizeBillNo = (value, fallback) => {
  const next = String(value || '').trim();
  if (!next) return String(fallback).slice(0, 32);
  return next.slice(0, 32);
};

const normalizeSourceRef = (value) => String(value || '').trim().slice(0, 64);

const withExternalConnection = async (config, handler) => {
  const conn = await mysql.createConnection(config);
  try {
    return await handler(conn);
  } finally {
    await conn.end();
  }
};

const ensureFinCustomerByName = async (conn, payload) => {
  const name = String(payload.name || '').trim();
  if (!name) return null;

  const [existsRows] = await conn.execute('SELECT id FROM fin_customers WHERE name = ? LIMIT 1', [name]);
  if (existsRows.length) {
    const id = Number(existsRows[0].id);
    await conn.execute(
      `UPDATE fin_customers
       SET customer_type = ?,
           contact_person = COALESCE(?, contact_person),
           phone = COALESCE(?, phone),
           industry = COALESCE(?, industry),
           status = 'active'
       WHERE id = ?`,
      [
        payload.customerType === 'toc' ? 'toc' : 'tob',
        payload.contactPerson || null,
        payload.phone || null,
        payload.industry || null,
        id
      ]
    );
    return id;
  }

  const [insertRet] = await conn.execute(
    `INSERT INTO fin_customers (name, customer_type, contact_person, phone, industry, status)
     VALUES (?, ?, ?, ?, ?, 'active')`,
    [
      name,
      payload.customerType === 'toc' ? 'toc' : 'tob',
      payload.contactPerson || null,
      payload.phone || null,
      payload.industry || null
    ]
  );
  return Number(insertRet.insertId);
};

const ensureFinVendorByName = async (conn, payload) => {
  const name = String(payload.name || '').trim();
  if (!name) return null;

  const [existsRows] = await conn.execute('SELECT id FROM fin_vendors WHERE name = ? LIMIT 1', [name]);
  if (existsRows.length) {
    const id = Number(existsRows[0].id);
    await conn.execute(
      `UPDATE fin_vendors
       SET category = COALESCE(?, category),
           contact_person = COALESCE(?, contact_person),
           phone = COALESCE(?, phone),
           status = 'active'
       WHERE id = ?`,
      [payload.category || null, payload.contactPerson || null, payload.phone || null, id]
    );
    return id;
  }

  const [insertRet] = await conn.execute(
    `INSERT INTO fin_vendors (name, category, contact_person, phone, status)
     VALUES (?, ?, ?, ?, 'active')`,
    [name, payload.category || 'service', payload.contactPerson || null, payload.phone || null]
  );
  return Number(insertRet.insertId);
};

const upsertReceivableBySource = async (conn, payload) => {
  const sourceRef = normalizeSourceRef(payload.sourceRef);
  if (!sourceRef) return { created: false, updated: false };

  const [existsRows] = await conn.execute('SELECT * FROM fin_receivables WHERE source_ref = ? LIMIT 1', [sourceRef]);
  const dueDate = toDateString(payload.dueDate || addDays(todayDateString(), 30));
  const dueRaw = toAmount(payload.amountDue);
  const receivedRaw = toAmount(payload.amountReceived || 0);

  if (dueRaw <= 0) return { created: false, updated: false };

  if (existsRows.length) {
    const current = existsRows[0];
    const nextCustomerId = Number(payload.customerId || current.customer_id);
    const nextReceived = Math.max(toAmount(current.amount_received), receivedRaw);
    const nextDue = Math.max(dueRaw, nextReceived);
    const nextStatus = calcReceivableStatus(nextDue, nextReceived, dueDate);

    await conn.execute(
      `UPDATE fin_receivables
       SET customer_id = ?, biz_type = ?, product_name = ?, amount_due = ?, amount_received = ?, due_date = ?, status = ?, owner = ?, notes = ?
       WHERE id = ?`,
      [
        nextCustomerId,
        payload.bizType === 'toc' ? 'toc' : 'tob',
        payload.productName || null,
        nextDue,
        nextReceived,
        dueDate,
        nextStatus,
        payload.owner || null,
        payload.notes || null,
        Number(current.id)
      ]
    );
    return { created: false, updated: true };
  }

  const billNo = normalizeBillNo(payload.billNo, `AR-${Date.now().toString().slice(-8)}`);
  const amountReceived = Math.min(receivedRaw, dueRaw);
  const status = calcReceivableStatus(dueRaw, amountReceived, dueDate);

  await conn.execute(
    `INSERT INTO fin_receivables
      (bill_no, customer_id, biz_type, product_name, source_ref, amount_due, amount_received, due_date, status, owner, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      billNo,
      Number(payload.customerId),
      payload.bizType === 'toc' ? 'toc' : 'tob',
      payload.productName || null,
      sourceRef,
      dueRaw,
      amountReceived,
      dueDate,
      status,
      payload.owner || null,
      payload.notes || null
    ]
  );
  return { created: true, updated: false };
};

const upsertPayableBySource = async (conn, payload) => {
  const sourceRef = normalizeSourceRef(payload.sourceRef);
  if (!sourceRef) return { created: false, updated: false };

  const [existsRows] = await conn.execute('SELECT * FROM fin_payables WHERE source_ref = ? LIMIT 1', [sourceRef]);
  const dueDate = toDateString(payload.dueDate || addDays(todayDateString(), 30));
  const dueRaw = toAmount(payload.amountDue);
  const paidRaw = toAmount(payload.amountPaid || 0);

  if (dueRaw <= 0) return { created: false, updated: false };

  if (existsRows.length) {
    const current = existsRows[0];
    const nextVendorId = Number(payload.vendorId || current.vendor_id);
    const nextPaid = Math.max(toAmount(current.amount_paid), paidRaw);
    const nextDue = Math.max(dueRaw, nextPaid);
    const nextStatus = calcPayableStatus(nextDue, nextPaid, dueDate);

    await conn.execute(
      `UPDATE fin_payables
       SET vendor_id = ?, category = ?, amount_due = ?, amount_paid = ?, due_date = ?, status = ?, owner = ?, notes = ?
       WHERE id = ?`,
      [
        nextVendorId,
        payload.category || 'service',
        nextDue,
        nextPaid,
        dueDate,
        nextStatus,
        payload.owner || null,
        payload.notes || null,
        Number(current.id)
      ]
    );
    return { created: false, updated: true };
  }

  const billNo = normalizeBillNo(payload.billNo, `AP-${Date.now().toString().slice(-8)}`);
  const amountPaid = Math.min(paidRaw, dueRaw);
  const status = calcPayableStatus(dueRaw, amountPaid, dueDate);

  await conn.execute(
    `INSERT INTO fin_payables
      (bill_no, vendor_id, category, source_ref, amount_due, amount_paid, due_date, status, owner, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      billNo,
      Number(payload.vendorId),
      payload.category || 'service',
      sourceRef,
      dueRaw,
      amountPaid,
      dueDate,
      status,
      payload.owner || null,
      payload.notes || null
    ]
  );
  return { created: true, updated: false };
};

const syncFromCrmOrders = async (finConn) => {
  const source = 'crm_orders';
  const rows = await withExternalConnection(crmDbConfig, async (crmConn) => {
    const [list] = await crmConn.execute(
      `SELECT o.id, o.biz_type, o.total_amount, o.status AS order_status, o.signed_at, o.created_at,
              c.name AS customer_name, c.customer_type, c.contact_person, c.phone, c.industry,
              p.name AS product_name
       FROM orders o
       JOIN customers c ON c.id = o.customer_id
       LEFT JOIN products p ON p.id = o.product_id
       WHERE o.status <> 'cancelled'
       ORDER BY o.id ASC`
    );
    return list;
  });

  const summary = { source, fetched: rows.length, created: 0, updated: 0, skipped: 0, failed: 0, errors: [] };
  for (const row of rows) {
    try {
      const due = toAmount(row.total_amount);
      if (due <= 0) {
        summary.skipped += 1;
        continue;
      }

      const customerId = await ensureFinCustomerByName(finConn, {
        name: row.customer_name,
        customerType: row.customer_type,
        contactPerson: row.contact_person,
        phone: row.phone,
        industry: row.industry
      });
      if (!customerId) {
        summary.skipped += 1;
        continue;
      }

      const paid = ['paid', 'delivered'].includes(String(row.order_status || '').toLowerCase()) ? due : 0;
      const result = await upsertReceivableBySource(finConn, {
        billNo: `AR-CRM-${row.id}`,
        sourceRef: `CRM-ORDER-${row.id}`,
        customerId,
        bizType: row.biz_type,
        productName: row.product_name || 'CRM订单',
        amountDue: due,
        amountReceived: paid,
        dueDate: addDays(row.signed_at || row.created_at, 30),
        owner: 'CRM自动同步',
        notes: `来源CRM订单#${row.id}，状态：${row.order_status}`
      });
      if (result.created) summary.created += 1;
      else if (result.updated) summary.updated += 1;
      else summary.skipped += 1;
    } catch (error) {
      summary.failed += 1;
      if (summary.errors.length < 8) {
        summary.errors.push(`CRM订单#${row.id}: ${error.message}`);
      }
    }
  }
  return summary;
};

const syncFromErpSalesOrders = async (finConn) => {
  const source = 'erp_sales_orders';
  const rows = await withExternalConnection(erpDbConfig, async (erpConn) => {
    const [list] = await erpConn.execute(
      `SELECT s.id, s.so_no, s.total_amount, s.status AS order_status, s.order_date, s.expected_delivery_date,
              c.name AS customer_name, c.customer_type, c.contact_person, c.phone, c.industry,
              e.name AS sales_owner_name
       FROM erp_sales_orders s
       JOIN mdm_customers c ON c.id = s.customer_id
       LEFT JOIN mdm_employees e ON e.id = s.sales_owner_id
       WHERE s.status <> 'cancelled'
       ORDER BY s.id ASC`
    );
    return list;
  });

  const summary = { source, fetched: rows.length, created: 0, updated: 0, skipped: 0, failed: 0, errors: [] };
  for (const row of rows) {
    try {
      const due = toAmount(row.total_amount);
      if (due <= 0) {
        summary.skipped += 1;
        continue;
      }

      const customerId = await ensureFinCustomerByName(finConn, {
        name: row.customer_name,
        customerType: row.customer_type,
        contactPerson: row.contact_person,
        phone: row.phone,
        industry: row.industry
      });
      if (!customerId) {
        summary.skipped += 1;
        continue;
      }

      const result = await upsertReceivableBySource(finConn, {
        billNo: `AR-ERP-SO-${row.id}`,
        sourceRef: `ERP-SO-${row.id}`,
        customerId,
        bizType: row.customer_type,
        productName: row.so_no || 'ERP销售订单',
        amountDue: due,
        amountReceived: 0,
        dueDate: addDays(row.order_date || row.expected_delivery_date, 30),
        owner: row.sales_owner_name || 'ERP自动同步',
        notes: `来源ERP销售单${row.so_no || row.id}，状态：${row.order_status}`
      });
      if (result.created) summary.created += 1;
      else if (result.updated) summary.updated += 1;
      else summary.skipped += 1;
    } catch (error) {
      summary.failed += 1;
      if (summary.errors.length < 8) {
        summary.errors.push(`ERP销售单#${row.id}: ${error.message}`);
      }
    }
  }
  return summary;
};

const syncFromErpPurchaseOrders = async (finConn) => {
  const source = 'erp_purchase_orders';
  const rows = await withExternalConnection(erpDbConfig, async (erpConn) => {
    const [list] = await erpConn.execute(
      `SELECT po.id, po.po_no, po.total_amount, po.status AS order_status, po.order_date, po.expected_arrival_date,
              v.name AS vendor_name, v.category, v.contact_person, v.phone,
              e.name AS purchaser_name
       FROM erp_purchase_orders po
       JOIN vendors v ON v.id = po.vendor_id
       LEFT JOIN mdm_employees e ON e.id = po.purchaser_id
       WHERE po.status <> 'cancelled'
       ORDER BY po.id ASC`
    );
    return list;
  });

  const summary = { source, fetched: rows.length, created: 0, updated: 0, skipped: 0, failed: 0, errors: [] };
  for (const row of rows) {
    try {
      const due = toAmount(row.total_amount);
      if (due <= 0) {
        summary.skipped += 1;
        continue;
      }

      const vendorId = await ensureFinVendorByName(finConn, {
        name: row.vendor_name,
        category: row.category,
        contactPerson: row.contact_person,
        phone: row.phone
      });
      if (!vendorId) {
        summary.skipped += 1;
        continue;
      }

      const result = await upsertPayableBySource(finConn, {
        billNo: `AP-ERP-PO-${row.id}`,
        sourceRef: `ERP-PO-${row.id}`,
        vendorId,
        category: row.category || 'service',
        amountDue: due,
        amountPaid: 0,
        dueDate: addDays(row.order_date || row.expected_arrival_date, 30),
        owner: row.purchaser_name || 'ERP自动同步',
        notes: `来源ERP采购单${row.po_no || row.id}，状态：${row.order_status}`
      });
      if (result.created) summary.created += 1;
      else if (result.updated) summary.updated += 1;
      else summary.skipped += 1;
    } catch (error) {
      summary.failed += 1;
      if (summary.errors.length < 8) {
        summary.errors.push(`ERP采购单#${row.id}: ${error.message}`);
      }
    }
  }
  return summary;
};

const syncFinanceAuto = async (scope) => {
  const nextScope = ['all', 'crm', 'erp'].includes(String(scope || '').trim()) ? String(scope || '').trim() : 'all';
  const finConn = await pool.getConnection();
  try {
    const results = [];
    if (nextScope === 'all' || nextScope === 'crm') {
      results.push(await syncFromCrmOrders(finConn));
    }
    if (nextScope === 'all' || nextScope === 'erp') {
      results.push(await syncFromErpSalesOrders(finConn));
      results.push(await syncFromErpPurchaseOrders(finConn));
    }

    await refreshAgingStatus();

    const totals = results.reduce((acc, item) => {
      acc.fetched += Number(item.fetched || 0);
      acc.created += Number(item.created || 0);
      acc.updated += Number(item.updated || 0);
      acc.skipped += Number(item.skipped || 0);
      acc.failed += Number(item.failed || 0);
      return acc;
    }, { fetched: 0, created: 0, updated: 0, skipped: 0, failed: 0 });

    return {
      scope: nextScope,
      syncedAt: new Date().toISOString(),
      totals,
      results
    };
  } finally {
    finConn.release();
  }
};

app.get('/api/health', asyncHandler(async (req, res) => {
  await getOne('SELECT 1 AS ok');
  res.json({ code: 0, message: 'ok' });
}));

app.get('/api/dashboard', asyncHandler(async (req, res) => {
  await refreshAgingStatus();

  const [
    receivableSummary,
    payableSummary,
    incomeSummary,
    payableExpenseSummary,
    reimburseSummary,
    cashSummary,
    pendingExpense,
    dueReceivables,
    duePayables,
    latestExpense
  ] = await Promise.all([
    getOne(
      `SELECT
         IFNULL(SUM(amount_due - amount_received), 0) AS outstanding,
         SUM(CASE WHEN status = 'overdue' THEN 1 ELSE 0 END) AS overdue_count
       FROM fin_receivables
       WHERE amount_received < amount_due`
    ),
    getOne(
      `SELECT
         IFNULL(SUM(amount_due - amount_paid), 0) AS outstanding,
         SUM(CASE WHEN status = 'overdue' THEN 1 ELSE 0 END) AS overdue_count
       FROM fin_payables
       WHERE amount_paid < amount_due`
    ),
    getOne(
      `SELECT IFNULL(SUM(received_amount), 0) AS month_income
       FROM fin_receipt_records
       WHERE DATE_FORMAT(received_date, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m')`
    ),
    getOne(
      `SELECT IFNULL(SUM(paid_amount), 0) AS month_payable_expense
       FROM fin_payment_records
       WHERE DATE_FORMAT(paid_date, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m')`
    ),
    getOne(
      `SELECT IFNULL(SUM(amount), 0) AS month_reimbursed_expense
       FROM fin_expenses
       WHERE status = 'reimbursed'
         AND DATE_FORMAT(reimbursed_at, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m')`
    ),
    getOne('SELECT IFNULL(SUM(balance), 0) AS cash_balance FROM fin_cash_accounts WHERE status = ?', ['active']),
    getOne('SELECT COUNT(*) AS pending_count FROM fin_expenses WHERE status = ?', ['pending']),
    getAll(
      `SELECT r.id, r.bill_no, c.name AS customer_name, r.due_date, (r.amount_due - r.amount_received) AS remain
       FROM fin_receivables r
       JOIN fin_customers c ON c.id = r.customer_id
       WHERE r.amount_received < r.amount_due
       ORDER BY r.due_date ASC
       LIMIT 5`
    ),
    getAll(
      `SELECT p.id, p.bill_no, v.name AS vendor_name, p.due_date, (p.amount_due - p.amount_paid) AS remain
       FROM fin_payables p
       JOIN fin_vendors v ON v.id = p.vendor_id
       WHERE p.amount_paid < p.amount_due
       ORDER BY p.due_date ASC
       LIMIT 5`
    ),
    getAll(
      `SELECT id, expense_no, applicant, department, amount, status, expense_date
       FROM fin_expenses
       ORDER BY id DESC
       LIMIT 5`
    )
  ]);

  const monthExpense = toAmount(payableExpenseSummary.month_payable_expense || 0) + toAmount(reimburseSummary.month_reimbursed_expense || 0);

  res.json({
    code: 0,
    data: {
      receivableOutstanding: toAmount(receivableSummary.outstanding || 0),
      receivableOverdueCount: Number(receivableSummary.overdue_count || 0),
      payableOutstanding: toAmount(payableSummary.outstanding || 0),
      payableOverdueCount: Number(payableSummary.overdue_count || 0),
      monthIncome: toAmount(incomeSummary.month_income || 0),
      monthExpense,
      monthNetCashflow: toAmount(incomeSummary.month_income || 0) - monthExpense,
      cashBalance: toAmount(cashSummary.cash_balance || 0),
      pendingExpenseCount: Number(pendingExpense.pending_count || 0),
      dueReceivables,
      duePayables,
      latestExpense
    }
  });
}));

app.get('/api/customers', asyncHandler(async (req, res) => {
  const { keyword } = req.query;
  const params = [];
  let sql = 'SELECT * FROM fin_customers WHERE 1=1';

  if (keyword) {
    sql += ' AND (name LIKE ? OR contact_person LIKE ?)';
    params.push(`%${keyword}%`, `%${keyword}%`);
  }

  sql += ' ORDER BY id DESC';
  const data = await getAll(sql, params);
  res.json({ code: 0, data });
}));

app.post('/api/customers', asyncHandler(async (req, res) => {
  const { name, customerType, contactPerson, phone, industry, status } = req.body;
  if (!name || !String(name).trim()) {
    return res.status(400).json({ code: 1, message: '客户名称不能为空' });
  }

  try {
    const result = await run(
      `INSERT INTO fin_customers (name, customer_type, contact_person, phone, industry, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        String(name).trim(),
        customerType === 'toc' ? 'toc' : 'tob',
        contactPerson || null,
        phone || null,
        industry || null,
        status || 'active'
      ]
    );
    const data = await getOne('SELECT * FROM fin_customers WHERE id = ?', [result.insertId]);
    res.json({ code: 0, message: '客户创建成功', data });
  } catch (error) {
    if (error && error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ code: 1, message: '客户名称已存在' });
    }
    throw error;
  }
}));

app.get('/api/vendors', asyncHandler(async (req, res) => {
  const { keyword } = req.query;
  const params = [];
  let sql = 'SELECT * FROM fin_vendors WHERE 1=1';

  if (keyword) {
    sql += ' AND (name LIKE ? OR contact_person LIKE ?)';
    params.push(`%${keyword}%`, `%${keyword}%`);
  }

  sql += ' ORDER BY id DESC';
  const data = await getAll(sql, params);
  res.json({ code: 0, data });
}));

app.post('/api/vendors', asyncHandler(async (req, res) => {
  const { name, category, contactPerson, phone, status } = req.body;
  if (!name || !String(name).trim()) {
    return res.status(400).json({ code: 1, message: '供应商名称不能为空' });
  }

  try {
    const result = await run(
      `INSERT INTO fin_vendors (name, category, contact_person, phone, status)
       VALUES (?, ?, ?, ?, ?)`,
      [
        String(name).trim(),
        category || 'service',
        contactPerson || null,
        phone || null,
        status || 'active'
      ]
    );
    const data = await getOne('SELECT * FROM fin_vendors WHERE id = ?', [result.insertId]);
    res.json({ code: 0, message: '供应商创建成功', data });
  } catch (error) {
    if (error && error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ code: 1, message: '供应商名称已存在' });
    }
    throw error;
  }
}));

app.get('/api/cash-accounts', asyncHandler(async (req, res) => {
  const data = await getAll('SELECT * FROM fin_cash_accounts ORDER BY id DESC');
  res.json({ code: 0, data });
}));

app.post('/api/cash-accounts', asyncHandler(async (req, res) => {
  const { accountName, bankName, accountNo, currency, balance, status } = req.body;
  if (!accountName || !String(accountName).trim()) {
    return res.status(400).json({ code: 1, message: '账户名称不能为空' });
  }

  try {
    const result = await run(
      `INSERT INTO fin_cash_accounts (account_name, bank_name, account_no, currency, balance, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        String(accountName).trim(),
        bankName || null,
        accountNo || null,
        currency || 'CNY',
        toAmount(balance || 0),
        status || 'active'
      ]
    );
    const data = await getOne('SELECT * FROM fin_cash_accounts WHERE id = ?', [result.insertId]);
    res.json({ code: 0, message: '资金账户创建成功', data });
  } catch (error) {
    if (error && error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ code: 1, message: '账户名称已存在' });
    }
    throw error;
  }
}));

app.put('/api/cash-accounts/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const current = await getOne('SELECT * FROM fin_cash_accounts WHERE id = ?', [id]);
  if (!current) {
    return res.status(404).json({ code: 1, message: '资金账户不存在' });
  }

  const nextName = String(req.body.accountName ?? current.account_name).trim();
  if (!nextName) {
    return res.status(400).json({ code: 1, message: '账户名称不能为空' });
  }

  try {
    await run(
      `UPDATE fin_cash_accounts
       SET account_name = ?, bank_name = ?, account_no = ?, currency = ?, balance = ?, status = ?
       WHERE id = ?`,
      [
        nextName,
        req.body.bankName ?? current.bank_name,
        req.body.accountNo ?? current.account_no,
        req.body.currency ?? current.currency,
        req.body.balance === undefined ? current.balance : toAmount(req.body.balance),
        req.body.status ?? current.status,
        id
      ]
    );
    const data = await getOne('SELECT * FROM fin_cash_accounts WHERE id = ?', [id]);
    res.json({ code: 0, message: '资金账户更新成功', data });
  } catch (error) {
    if (error && error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ code: 1, message: '账户名称已存在' });
    }
    throw error;
  }
}));

app.get('/api/receivables', asyncHandler(async (req, res) => {
  await refreshAgingStatus();
  const { status, customerId, keyword, updatedAfter } = req.query;
  const params = [];
  let sql = `SELECT r.*, c.name AS customer_name
             FROM fin_receivables r
             JOIN fin_customers c ON c.id = r.customer_id
             WHERE 1=1`;

  if (status) {
    sql += ' AND r.status = ?';
    params.push(status);
  }
  if (customerId) {
    sql += ' AND r.customer_id = ?';
    params.push(Number(customerId));
  }
  if (keyword) {
    sql += ' AND (r.bill_no LIKE ? OR r.product_name LIKE ? OR c.name LIKE ?)';
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  if (updatedAfter) {
    const at = normalizeDateTimeInput(updatedAfter);
    if (!at) {
      return res.status(400).json({ code: 1, message: 'updatedAfter 格式错误，需 YYYY-MM-DD 或 YYYY-MM-DD HH:mm[:ss]' });
    }
    sql += ' AND r.created_at >= ?';
    params.push(at);
  }

  sql += ' ORDER BY r.id DESC';
  const data = await getAll(sql, params);
  res.json({ code: 0, data });
}));

app.post('/api/receivables', asyncHandler(async (req, res) => {
  const { billNo, customerId, bizType, productName, sourceRef, amountDue, dueDate, owner, notes } = req.body;
  if (!billNo || !String(billNo).trim() || !customerId || !dueDate || toAmount(amountDue) <= 0) {
    return res.status(400).json({ code: 1, message: '应收单号、客户、应收金额、到期日必填' });
  }

  const customer = await ensureCustomer(Number(customerId));
  if (!customer) {
    return res.status(400).json({ code: 1, message: '客户不存在或已停用' });
  }

  try {
    const result = await run(
      `INSERT INTO fin_receivables
       (bill_no, customer_id, biz_type, product_name, source_ref, amount_due, amount_received, due_date, status, owner, notes)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
      [
        String(billNo).trim(),
        Number(customerId),
        bizType === 'toc' ? 'toc' : 'tob',
        productName || null,
        sourceRef || null,
        toAmount(amountDue),
        dueDate,
        calcReceivableStatus(amountDue, 0, dueDate),
        owner || null,
        notes || null
      ]
    );
    const data = await getOne('SELECT * FROM fin_receivables WHERE id = ?', [result.insertId]);
    res.json({ code: 0, message: '应收单创建成功', data });
  } catch (error) {
    if (error && error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ code: 1, message: '应收单号已存在' });
    }
    throw error;
  }
}));

app.put('/api/receivables/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const current = await getOne('SELECT * FROM fin_receivables WHERE id = ?', [id]);
  if (!current) {
    return res.status(404).json({ code: 1, message: '应收单不存在' });
  }

  const nextCustomerId = Number(req.body.customerId ?? current.customer_id);
  const nextDue = req.body.amountDue === undefined ? toAmount(current.amount_due) : toAmount(req.body.amountDue);
  const nextReceived = toAmount(current.amount_received);
  const nextDueDate = req.body.dueDate ?? current.due_date;

  if (!nextCustomerId || !nextDueDate || nextDue <= 0 || nextReceived > nextDue) {
    return res.status(400).json({ code: 1, message: '应收数据不合法' });
  }

  const customer = await ensureCustomer(nextCustomerId);
  if (!customer) {
    return res.status(400).json({ code: 1, message: '客户不存在或已停用' });
  }

  const nextBillNo = String(req.body.billNo ?? current.bill_no).trim();
  if (!nextBillNo) {
    return res.status(400).json({ code: 1, message: '应收单号不能为空' });
  }

  try {
    await run(
      `UPDATE fin_receivables
       SET bill_no = ?, customer_id = ?, biz_type = ?, product_name = ?, source_ref = ?, amount_due = ?, due_date = ?, status = ?, owner = ?, notes = ?
       WHERE id = ?`,
      [
        nextBillNo,
        nextCustomerId,
        (req.body.bizType ?? current.biz_type) === 'toc' ? 'toc' : 'tob',
        req.body.productName ?? current.product_name,
        req.body.sourceRef ?? current.source_ref,
        nextDue,
        nextDueDate,
        calcReceivableStatus(nextDue, nextReceived, nextDueDate),
        req.body.owner ?? current.owner,
        req.body.notes ?? current.notes,
        id
      ]
    );
    const data = await getOne('SELECT * FROM fin_receivables WHERE id = ?', [id]);
    res.json({ code: 0, message: '应收单更新成功', data });
  } catch (error) {
    if (error && error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ code: 1, message: '应收单号已存在' });
    }
    throw error;
  }
}));

app.get('/api/receivables/:id/receipts', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const receivable = await getOne('SELECT * FROM fin_receivables WHERE id = ?', [id]);
  if (!receivable) {
    return res.status(404).json({ code: 1, message: '应收单不存在' });
  }

  const data = await getAll(
    `SELECT rr.*, ca.account_name
     FROM fin_receipt_records rr
     JOIN fin_cash_accounts ca ON ca.id = rr.account_id
     WHERE rr.receivable_id = ?
     ORDER BY rr.id DESC`,
    [id]
  );

  res.json({ code: 0, data });
}));

app.post('/api/receivables/:id/receipts', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { receivedAmount, receivedDate, method, accountId, notes } = req.body;
  const amount = toAmount(receivedAmount);

  if (!accountId || amount <= 0 || !receivedDate) {
    return res.status(400).json({ code: 1, message: '收款金额、收款日期、收款账户必填' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rRows] = await conn.execute('SELECT * FROM fin_receivables WHERE id = ? FOR UPDATE', [id]);
    const receivable = rRows[0];
    if (!receivable) {
      await conn.rollback();
      return res.status(404).json({ code: 1, message: '应收单不存在' });
    }

    const remain = toAmount(receivable.amount_due) - toAmount(receivable.amount_received);
    if (remain <= 0) {
      await conn.rollback();
      return res.status(400).json({ code: 1, message: '该应收单已回款完成' });
    }
    if (amount > remain) {
      await conn.rollback();
      return res.status(400).json({ code: 1, message: `收款金额不能超过未回款金额（${remain}）` });
    }

    const [aRows] = await conn.execute('SELECT * FROM fin_cash_accounts WHERE id = ? FOR UPDATE', [Number(accountId)]);
    const account = aRows[0];
    if (!account || account.status !== 'active') {
      await conn.rollback();
      return res.status(400).json({ code: 1, message: '收款账户不存在或不可用' });
    }

    await conn.execute(
      `INSERT INTO fin_receipt_records (receivable_id, account_id, received_amount, received_date, method, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, Number(accountId), amount, receivedDate, method || 'bank_transfer', notes || null]
    );

    const nextReceived = toAmount(receivable.amount_received) + amount;
    const nextStatus = calcReceivableStatus(receivable.amount_due, nextReceived, receivable.due_date);

    await conn.execute(
      `UPDATE fin_receivables
       SET amount_received = ?, status = ?
       WHERE id = ?`,
      [nextReceived, nextStatus, id]
    );

    await conn.execute('UPDATE fin_cash_accounts SET balance = balance + ? WHERE id = ?', [amount, Number(accountId)]);

    await conn.commit();

    const data = await getOne(
      `SELECT r.*, c.name AS customer_name
       FROM fin_receivables r
       JOIN fin_customers c ON c.id = r.customer_id
       WHERE r.id = ?`,
      [id]
    );

    res.json({ code: 0, message: '收款登记成功', data });
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}));

app.get('/api/payables', asyncHandler(async (req, res) => {
  await refreshAgingStatus();
  const { status, vendorId, keyword, updatedAfter } = req.query;
  const params = [];
  let sql = `SELECT p.*, v.name AS vendor_name
             FROM fin_payables p
             JOIN fin_vendors v ON v.id = p.vendor_id
             WHERE 1=1`;

  if (status) {
    sql += ' AND p.status = ?';
    params.push(status);
  }
  if (vendorId) {
    sql += ' AND p.vendor_id = ?';
    params.push(Number(vendorId));
  }
  if (keyword) {
    sql += ' AND (p.bill_no LIKE ? OR p.source_ref LIKE ? OR v.name LIKE ?)';
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  if (updatedAfter) {
    const at = normalizeDateTimeInput(updatedAfter);
    if (!at) {
      return res.status(400).json({ code: 1, message: 'updatedAfter 格式错误，需 YYYY-MM-DD 或 YYYY-MM-DD HH:mm[:ss]' });
    }
    sql += ' AND p.created_at >= ?';
    params.push(at);
  }

  sql += ' ORDER BY p.id DESC';
  const data = await getAll(sql, params);
  res.json({ code: 0, data });
}));

app.post('/api/payables', asyncHandler(async (req, res) => {
  const { billNo, vendorId, category, sourceRef, amountDue, dueDate, owner, notes } = req.body;
  if (!billNo || !String(billNo).trim() || !vendorId || !dueDate || toAmount(amountDue) <= 0) {
    return res.status(400).json({ code: 1, message: '应付单号、供应商、应付金额、到期日必填' });
  }

  const vendor = await ensureVendor(Number(vendorId));
  if (!vendor) {
    return res.status(400).json({ code: 1, message: '供应商不存在或已停用' });
  }

  try {
    const result = await run(
      `INSERT INTO fin_payables
       (bill_no, vendor_id, category, source_ref, amount_due, amount_paid, due_date, status, owner, notes)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
      [
        String(billNo).trim(),
        Number(vendorId),
        category || 'service',
        sourceRef || null,
        toAmount(amountDue),
        dueDate,
        calcPayableStatus(amountDue, 0, dueDate),
        owner || null,
        notes || null
      ]
    );
    const data = await getOne('SELECT * FROM fin_payables WHERE id = ?', [result.insertId]);
    res.json({ code: 0, message: '应付单创建成功', data });
  } catch (error) {
    if (error && error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ code: 1, message: '应付单号已存在' });
    }
    throw error;
  }
}));

app.put('/api/payables/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const current = await getOne('SELECT * FROM fin_payables WHERE id = ?', [id]);
  if (!current) {
    return res.status(404).json({ code: 1, message: '应付单不存在' });
  }

  const nextVendorId = Number(req.body.vendorId ?? current.vendor_id);
  const nextDue = req.body.amountDue === undefined ? toAmount(current.amount_due) : toAmount(req.body.amountDue);
  const nextPaid = toAmount(current.amount_paid);
  const nextDueDate = req.body.dueDate ?? current.due_date;

  if (!nextVendorId || !nextDueDate || nextDue <= 0 || nextPaid > nextDue) {
    return res.status(400).json({ code: 1, message: '应付数据不合法' });
  }

  const vendor = await ensureVendor(nextVendorId);
  if (!vendor) {
    return res.status(400).json({ code: 1, message: '供应商不存在或已停用' });
  }

  const nextBillNo = String(req.body.billNo ?? current.bill_no).trim();
  if (!nextBillNo) {
    return res.status(400).json({ code: 1, message: '应付单号不能为空' });
  }

  try {
    await run(
      `UPDATE fin_payables
       SET bill_no = ?, vendor_id = ?, category = ?, source_ref = ?, amount_due = ?, due_date = ?, status = ?, owner = ?, notes = ?
       WHERE id = ?`,
      [
        nextBillNo,
        nextVendorId,
        req.body.category ?? current.category,
        req.body.sourceRef ?? current.source_ref,
        nextDue,
        nextDueDate,
        calcPayableStatus(nextDue, nextPaid, nextDueDate),
        req.body.owner ?? current.owner,
        req.body.notes ?? current.notes,
        id
      ]
    );

    const data = await getOne('SELECT * FROM fin_payables WHERE id = ?', [id]);
    res.json({ code: 0, message: '应付单更新成功', data });
  } catch (error) {
    if (error && error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ code: 1, message: '应付单号已存在' });
    }
    throw error;
  }
}));

app.get('/api/payables/:id/payments', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const payable = await getOne('SELECT * FROM fin_payables WHERE id = ?', [id]);
  if (!payable) {
    return res.status(404).json({ code: 1, message: '应付单不存在' });
  }

  const data = await getAll(
    `SELECT pr.*, ca.account_name
     FROM fin_payment_records pr
     JOIN fin_cash_accounts ca ON ca.id = pr.account_id
     WHERE pr.payable_id = ?
     ORDER BY pr.id DESC`,
    [id]
  );

  res.json({ code: 0, data });
}));

app.post('/api/payables/:id/payments', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { paidAmount, paidDate, method, accountId, notes } = req.body;
  const amount = toAmount(paidAmount);

  if (!accountId || amount <= 0 || !paidDate) {
    return res.status(400).json({ code: 1, message: '付款金额、付款日期、付款账户必填' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [pRows] = await conn.execute('SELECT * FROM fin_payables WHERE id = ? FOR UPDATE', [id]);
    const payable = pRows[0];
    if (!payable) {
      await conn.rollback();
      return res.status(404).json({ code: 1, message: '应付单不存在' });
    }

    const remain = toAmount(payable.amount_due) - toAmount(payable.amount_paid);
    if (remain <= 0) {
      await conn.rollback();
      return res.status(400).json({ code: 1, message: '该应付单已支付完成' });
    }
    if (amount > remain) {
      await conn.rollback();
      return res.status(400).json({ code: 1, message: `付款金额不能超过未付款金额（${remain}）` });
    }

    const [aRows] = await conn.execute('SELECT * FROM fin_cash_accounts WHERE id = ? FOR UPDATE', [Number(accountId)]);
    const account = aRows[0];
    if (!account || account.status !== 'active') {
      await conn.rollback();
      return res.status(400).json({ code: 1, message: '付款账户不存在或不可用' });
    }

    if (toAmount(account.balance) < amount) {
      await conn.rollback();
      return res.status(400).json({ code: 1, message: '账户余额不足，无法付款' });
    }

    await conn.execute(
      `INSERT INTO fin_payment_records (payable_id, account_id, paid_amount, paid_date, method, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, Number(accountId), amount, paidDate, method || 'bank_transfer', notes || null]
    );

    const nextPaid = toAmount(payable.amount_paid) + amount;
    const nextStatus = calcPayableStatus(payable.amount_due, nextPaid, payable.due_date);

    await conn.execute(
      `UPDATE fin_payables
       SET amount_paid = ?, status = ?
       WHERE id = ?`,
      [nextPaid, nextStatus, id]
    );

    await conn.execute('UPDATE fin_cash_accounts SET balance = balance - ? WHERE id = ?', [amount, Number(accountId)]);

    await conn.commit();

    const data = await getOne(
      `SELECT p.*, v.name AS vendor_name
       FROM fin_payables p
       JOIN fin_vendors v ON v.id = p.vendor_id
       WHERE p.id = ?`,
      [id]
    );

    res.json({ code: 0, message: '付款登记成功', data });
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}));

app.get('/api/expenses', asyncHandler(async (req, res) => {
  const { status, department, applicant, updatedAfter } = req.query;
  const params = [];
  let sql = `SELECT e.*, ca.account_name
             FROM fin_expenses e
             LEFT JOIN fin_cash_accounts ca ON ca.id = e.payment_account_id
             WHERE 1=1`;

  if (status) {
    sql += ' AND e.status = ?';
    params.push(status);
  }
  if (department) {
    sql += ' AND e.department = ?';
    params.push(department);
  }
  if (applicant) {
    sql += ' AND e.applicant LIKE ?';
    params.push(`%${applicant}%`);
  }
  if (updatedAfter) {
    const at = normalizeDateTimeInput(updatedAfter);
    if (!at) {
      return res.status(400).json({ code: 1, message: 'updatedAfter 格式错误，需 YYYY-MM-DD 或 YYYY-MM-DD HH:mm[:ss]' });
    }
    sql += ' AND e.created_at >= ?';
    params.push(at);
  }

  sql += ' ORDER BY e.id DESC';
  const data = await getAll(sql, params);
  res.json({ code: 0, data });
}));

app.post('/api/expenses', asyncHandler(async (req, res) => {
  const { expenseNo, department, applicant, category, relatedBusiness, amount, expenseDate, notes } = req.body;

  const nextExpenseNo = String(expenseNo || '').trim() || `EX-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Date.now().toString().slice(-4)}`;
  if (!department || !applicant || !expenseDate || toAmount(amount) <= 0) {
    return res.status(400).json({ code: 1, message: '部门、申请人、费用日期、金额必填' });
  }

  try {
    const result = await run(
      `INSERT INTO fin_expenses
       (expense_no, department, applicant, category, related_business, amount, expense_date, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [
        nextExpenseNo,
        department,
        applicant,
        category || 'other',
        relatedBusiness || null,
        toAmount(amount),
        expenseDate,
        notes || null
      ]
    );

    const data = await getOne('SELECT * FROM fin_expenses WHERE id = ?', [result.insertId]);
    res.json({ code: 0, message: '报销单提交成功', data });
  } catch (error) {
    if (error && error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ code: 1, message: '报销单号重复，请重试' });
    }
    throw error;
  }
}));

app.put('/api/expenses/:id/status', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const { status, paymentAccountId } = req.body;
  const allowed = ['pending', 'approved', 'reimbursed', 'rejected'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ code: 1, message: '状态不合法' });
  }

  const expense = await getOne('SELECT * FROM fin_expenses WHERE id = ?', [id]);
  if (!expense) {
    return res.status(404).json({ code: 1, message: '报销单不存在' });
  }

  if (expense.status === 'reimbursed' && status !== 'reimbursed') {
    return res.status(400).json({ code: 1, message: '已报销单据不可回退状态' });
  }

  if (status !== 'reimbursed') {
    await run('UPDATE fin_expenses SET status = ? WHERE id = ?', [status, id]);
    const data = await getOne(
      `SELECT e.*, ca.account_name
       FROM fin_expenses e
       LEFT JOIN fin_cash_accounts ca ON ca.id = e.payment_account_id
       WHERE e.id = ?`,
      [id]
    );
    return res.json({ code: 0, message: '状态更新成功', data });
  }

  const accountId = Number(paymentAccountId || expense.payment_account_id);
  if (!accountId) {
    return res.status(400).json({ code: 1, message: '报销必须指定付款账户' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [eRows] = await conn.execute('SELECT * FROM fin_expenses WHERE id = ? FOR UPDATE', [id]);
    const lockedExpense = eRows[0];
    if (!lockedExpense) {
      await conn.rollback();
      return res.status(404).json({ code: 1, message: '报销单不存在' });
    }
    if (lockedExpense.status === 'reimbursed') {
      await conn.rollback();
      return res.status(400).json({ code: 1, message: '该报销单已报销' });
    }

    const [aRows] = await conn.execute('SELECT * FROM fin_cash_accounts WHERE id = ? FOR UPDATE', [accountId]);
    const account = aRows[0];
    if (!account || account.status !== 'active') {
      await conn.rollback();
      return res.status(400).json({ code: 1, message: '付款账户不存在或不可用' });
    }
    if (toAmount(account.balance) < toAmount(lockedExpense.amount)) {
      await conn.rollback();
      return res.status(400).json({ code: 1, message: '账户余额不足，无法完成报销' });
    }

    await conn.execute('UPDATE fin_cash_accounts SET balance = balance - ? WHERE id = ?', [toAmount(lockedExpense.amount), accountId]);
    await conn.execute(
      `UPDATE fin_expenses
       SET status = 'reimbursed', payment_account_id = ?, reimbursed_at = NOW()
       WHERE id = ?`,
      [accountId, id]
    );

    await conn.commit();

    const data = await getOne(
      `SELECT e.*, ca.account_name
       FROM fin_expenses e
       LEFT JOIN fin_cash_accounts ca ON ca.id = e.payment_account_id
       WHERE e.id = ?`,
      [id]
    );

    res.json({ code: 0, message: '报销完成', data });
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}));

app.post('/api/sync/finance-auto', asyncHandler(async (req, res) => {
  const scope = String(req.body.scope || 'all').trim();
  if (!['all', 'crm', 'erp'].includes(scope)) {
    return res.status(400).json({ code: 1, message: 'scope 仅支持 all / crm / erp' });
  }

  const data = await syncFinanceAuto(scope);
  res.json({ code: 0, message: '联动同步完成', data });
}));

app.get('/api/receipts', asyncHandler(async (req, res) => {
  const data = await getAll(
    `SELECT rr.*, r.bill_no, c.name AS customer_name, ca.account_name
     FROM fin_receipt_records rr
     JOIN fin_receivables r ON r.id = rr.receivable_id
     JOIN fin_customers c ON c.id = r.customer_id
     JOIN fin_cash_accounts ca ON ca.id = rr.account_id
     ORDER BY rr.id DESC
     LIMIT 50`
  );
  res.json({ code: 0, data });
}));

app.get('/api/payments', asyncHandler(async (req, res) => {
  const data = await getAll(
    `SELECT pr.*, p.bill_no, v.name AS vendor_name, ca.account_name
     FROM fin_payment_records pr
     JOIN fin_payables p ON p.id = pr.payable_id
     JOIN fin_vendors v ON v.id = p.vendor_id
     JOIN fin_cash_accounts ca ON ca.id = pr.account_id
     ORDER BY pr.id DESC
     LIMIT 50`
  );
  res.json({ code: 0, data });
}));

app.use((error, req, res, next) => {
  console.error('FIN API 错误:', error);
  res.status(500).json({ code: 1, message: error.message || '服务器错误' });
});

app.listen(PORT, '0.0.0.0', async () => {
  try {
    await getOne('SELECT 1 AS ok');
    console.log(`🗄️ FIN 已连接 MySQL: ${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`);
  } catch (error) {
    console.error('❌ FIN MySQL 连接失败:', error.message);
  }
  console.log(`💰 FIN API 已启动: http://0.0.0.0:${PORT}`);
  console.log(`📈 Dashboard: http://0.0.0.0:${PORT}/api/dashboard`);
});
