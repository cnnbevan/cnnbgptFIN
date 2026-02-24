const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');
const { extractBearerToken, hasSystemAccess, verifyPortalToken } = require('../../shared/sso');

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

const oaDbConfig = {
  host: process.env.OA_DB_HOST || process.env.DB_HOST || '192.168.11.19',
  port: Number(process.env.OA_DB_PORT || process.env.DB_PORT || 3306),
  user: process.env.OA_DB_USER || process.env.DB_USER || 'root',
  password: process.env.OA_DB_PASSWORD || process.env.DB_PASSWORD || 'evanevan2025',
  database: process.env.OA_DB_NAME || 'cnnbgptOA',
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

const SYSTEM_CODE = 'fin';
const JWT_SECRET = process.env.JWT_SECRET || 'cnnbgpt-portal-dev-secret';

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

const clampProgress = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return Math.round(n * 100) / 100;
};

const normalizeProgressStatus = (value) => String(value || 'unknown').trim().slice(0, 24) || 'unknown';
const normalizeStatusStrategy = (value) => String(value || 'standard').trim().slice(0, 32) || 'standard';

const requirePortalAuth = (req, res, next) => {
  const token = extractBearerToken(req);
  if (!token) {
    return res.status(401).json({ code: 1, message: '未登录或登录已过期' });
  }

  let payload;
  try {
    payload = verifyPortalToken(token, JWT_SECRET);
  } catch (error) {
    return res.status(401).json({ code: 1, message: '登录令牌无效，请重新登录' });
  }

  if (!hasSystemAccess(payload, SYSTEM_CODE)) {
    return res.status(403).json({ code: 1, message: '当前账号无 FIN 系统访问权限' });
  }

  req.auth = payload;
  next();
};

const receivableProgressText = (status, ratio) => {
  const r = clampProgress(ratio);
  if (status === 'shipped') return { status: 'shipped', ratio: 100 };
  if (status === 'partial_shipped') return { status: 'partial_shipped', ratio: r > 0 ? r : 50 };
  if (status === 'not_shipped') return { status: 'not_shipped', ratio: 0 };
  return { status: 'unknown', ratio: r };
};

const payableProgressText = (status, ratio) => {
  const r = clampProgress(ratio);
  if (status === 'received') return { status: 'received', ratio: 100 };
  if (status === 'partial_received') return { status: 'partial_received', ratio: r > 0 ? r : 50 };
  if (status === 'not_received') return { status: 'not_received', ratio: 0 };
  return { status: 'unknown', ratio: r };
};

const strategyFromReceivableProgress = (progressStatus) => {
  if (progressStatus === 'not_shipped') return 'pre_collection';
  if (progressStatus === 'partial_shipped') return 'milestone_collection';
  if (progressStatus === 'shipped') return 'collection_due';
  return 'standard';
};

const strategyFromPayableProgress = (progressStatus) => {
  if (progressStatus === 'not_received') return 'pre_payment';
  if (progressStatus === 'partial_received') return 'milestone_payment';
  if (progressStatus === 'received') return 'payment_due';
  return 'standard';
};

const crmProgressByOrderStatus = (status) => {
  const s = String(status || '').toLowerCase();
  if (s === 'delivered') return { progressStatus: 'shipped', progressRatio: 100, strategy: 'collection_due' };
  if (s === 'paid') return { progressStatus: 'partial_shipped', progressRatio: 60, strategy: 'milestone_collection' };
  return { progressStatus: 'not_shipped', progressRatio: 0, strategy: 'pre_collection' };
};

const erpSalesProgressByStatus = (status, ratio) => {
  const s = String(status || '').toLowerCase();
  if (s === 'shipped') return { progressStatus: 'shipped', progressRatio: 100 };
  if (s === 'partial_shipped') return { progressStatus: 'partial_shipped', progressRatio: ratio > 0 ? ratio : 50 };
  return { progressStatus: 'not_shipped', progressRatio: 0 };
};

const erpPurchaseProgressByStatus = (status, ratio) => {
  const s = String(status || '').toLowerCase();
  if (s === 'received') return { progressStatus: 'received', progressRatio: 100 };
  if (s === 'partial_received') return { progressStatus: 'partial_received', progressRatio: ratio > 0 ? ratio : 50 };
  return { progressStatus: 'not_received', progressRatio: 0 };
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

const calcCostStatus = (amount, paidAmount, dueDate) => {
  const due = toAmount(amount);
  const paid = toAmount(paidAmount);
  if (paid >= due) return 'paid';
  if (dueDate && String(dueDate) < todayDateString()) return 'overdue';
  if (paid > 0) return 'partial';
  return 'open';
};

const calcSalaryAmount = ({ baseSalary, performanceBonus, allowance, deduction, employerCost }) => {
  const total = toAmount(baseSalary) + toAmount(performanceBonus) + toAmount(allowance) + toAmount(employerCost) - toAmount(deduction);
  return total > 0 ? toAmount(total) : 0;
};

const estimateSalaryTemplateByPosition = (position) => {
  const p = String(position || '').toLowerCase();
  let baseSalary = 16000;
  if (p.includes('ceo')) baseSalary = 58000;
  else if (p.includes('cto')) baseSalary = 52000;
  else if (p.includes('总监')) baseSalary = 36000;
  else if (p.includes('经理')) baseSalary = 26000;
  else if (p.includes('工程师')) baseSalary = 21000;
  else if (p.includes('产品')) baseSalary = 23000;
  else if (p.includes('设计')) baseSalary = 19000;
  else if (p.includes('运营')) baseSalary = 17000;
  else if (p.includes('实施')) baseSalary = 20000;
  else if (p.includes('销售')) baseSalary = 22000;

  const performanceBonus = toAmount(baseSalary * 0.2);
  const allowance = toAmount(baseSalary * 0.05);
  const deduction = toAmount(baseSalary * 0.03);
  const employerCost = toAmount(baseSalary * 0.18);

  return {
    baseSalary,
    performanceBonus,
    allowance,
    deduction,
    employerCost
  };
};

const calcAiExpenseAmount = ({ amount, usageQty, unitPrice }) => {
  if (amount !== undefined && amount !== null && String(amount).trim() !== '') {
    return toAmount(amount);
  }
  const qty = Number(usageQty || 0);
  const price = Number(unitPrice || 0);
  if (!Number.isFinite(qty) || !Number.isFinite(price)) return 0;
  return toAmount(qty * price);
};

const normalizePeriodMonth = (value) => {
  const s = String(value || '').trim();
  if (/^\d{4}-\d{2}$/.test(s)) return `${s}-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s.slice(0, 7)}-01`;
  return new Date().toISOString().slice(0, 7) + '-01';
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
  await run(
    `UPDATE fin_costs
     SET status = CASE
       WHEN paid_amount >= amount THEN 'paid'
       WHEN due_date IS NOT NULL AND due_date < CURDATE() THEN 'overdue'
       WHEN paid_amount > 0 THEN 'partial'
       ELSE 'open'
     END`
  );
  await run(
    `UPDATE fin_salaries
     SET status = CASE
       WHEN paid_amount >= amount THEN 'paid'
       WHEN due_date IS NOT NULL AND due_date < CURDATE() THEN 'overdue'
       WHEN paid_amount > 0 THEN 'partial'
       ELSE 'open'
     END`
  );
  await run(
    `UPDATE fin_ai_expenses
     SET status = CASE
       WHEN paid_amount >= amount THEN 'paid'
       WHEN due_date IS NOT NULL AND due_date < CURDATE() THEN 'overdue'
       WHEN paid_amount > 0 THEN 'partial'
       ELSE 'open'
     END`
  );
};

let syncColumnsReady = false;
let budgetCostTablesReady = false;
let oaSalarySyncRunning = null;
let oaSalaryLastSyncAt = 0;
const OA_SALARY_SYNC_INTERVAL_MS = Number(process.env.OA_SALARY_SYNC_INTERVAL_MS || 60000);

const ensureColumnIfMissing = async (conn, tableName, columnName, alterSql) => {
  const [rows] = await conn.execute(
    `SELECT COUNT(*) AS c
     FROM information_schema.columns
     WHERE table_schema = ?
       AND table_name = ?
       AND column_name = ?`,
    [dbConfig.database, tableName, columnName]
  );
  if (!Number(rows[0]?.c || 0)) {
    await conn.execute(alterSql);
  }
};

const ensureIndexIfMissing = async (conn, tableName, indexName, alterSql) => {
  const [rows] = await conn.execute(
    `SELECT COUNT(*) AS c
     FROM information_schema.statistics
     WHERE table_schema = ?
       AND table_name = ?
       AND index_name = ?`,
    [dbConfig.database, tableName, indexName]
  );
  if (!Number(rows[0]?.c || 0)) {
    await conn.execute(alterSql);
  }
};

const ensureSyncProgressColumns = async () => {
  if (syncColumnsReady) return;
  const conn = await pool.getConnection();
  try {
    await ensureColumnIfMissing(
      conn,
      'fin_receivables',
      'source_progress_ratio',
      'ALTER TABLE fin_receivables ADD COLUMN source_progress_ratio DECIMAL(5,2) NOT NULL DEFAULT 0 AFTER status'
    );
    await ensureColumnIfMissing(
      conn,
      'fin_receivables',
      'source_progress_status',
      "ALTER TABLE fin_receivables ADD COLUMN source_progress_status VARCHAR(24) NOT NULL DEFAULT 'unknown' AFTER source_progress_ratio"
    );
    await ensureColumnIfMissing(
      conn,
      'fin_receivables',
      'status_strategy',
      "ALTER TABLE fin_receivables ADD COLUMN status_strategy VARCHAR(32) NOT NULL DEFAULT 'standard' AFTER source_progress_status"
    );

    await ensureColumnIfMissing(
      conn,
      'fin_payables',
      'source_progress_ratio',
      'ALTER TABLE fin_payables ADD COLUMN source_progress_ratio DECIMAL(5,2) NOT NULL DEFAULT 0 AFTER status'
    );
    await ensureColumnIfMissing(
      conn,
      'fin_payables',
      'source_progress_status',
      "ALTER TABLE fin_payables ADD COLUMN source_progress_status VARCHAR(24) NOT NULL DEFAULT 'unknown' AFTER source_progress_ratio"
    );
    await ensureColumnIfMissing(
      conn,
      'fin_payables',
      'status_strategy',
      "ALTER TABLE fin_payables ADD COLUMN status_strategy VARCHAR(32) NOT NULL DEFAULT 'standard' AFTER source_progress_status"
    );

    syncColumnsReady = true;
  } finally {
    conn.release();
  }
};

const ensureBudgetCostTables = async () => {
  if (budgetCostTablesReady) return;
  const conn = await pool.getConnection();
  try {
    await conn.execute(
      `CREATE TABLE IF NOT EXISTS fin_budgets (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        budget_no VARCHAR(32) NOT NULL,
        period_month DATE NOT NULL,
        department VARCHAR(64) NOT NULL,
        subject VARCHAR(32) NOT NULL DEFAULT 'operations',
        budget_amount DECIMAL(12,2) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        owner VARCHAR(64) DEFAULT NULL,
        notes TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_fin_budget_no (budget_no),
        KEY idx_fin_budget_period (period_month),
        KEY idx_fin_budget_department (department),
        KEY idx_fin_budget_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    );

    await conn.execute(
      `CREATE TABLE IF NOT EXISTS fin_costs (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        cost_no VARCHAR(32) NOT NULL,
        department VARCHAR(64) NOT NULL,
        cost_type VARCHAR(32) NOT NULL DEFAULT 'operations',
        related_business VARCHAR(64) DEFAULT NULL,
        vendor_id INT UNSIGNED DEFAULT NULL,
        amount DECIMAL(12,2) NOT NULL,
        paid_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
        cost_date DATE NOT NULL,
        due_date DATE DEFAULT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'open',
        owner VARCHAR(64) DEFAULT NULL,
        notes TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_fin_cost_no (cost_no),
        KEY idx_fin_cost_date (cost_date),
        KEY idx_fin_cost_department (department),
        KEY idx_fin_cost_status (status),
        KEY idx_fin_cost_vendor (vendor_id),
        CONSTRAINT fk_fin_cost_vendor FOREIGN KEY (vendor_id) REFERENCES fin_vendors(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    );

    await conn.execute(
      `CREATE TABLE IF NOT EXISTS fin_cost_payment_records (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        cost_id INT UNSIGNED NOT NULL,
        account_id INT UNSIGNED NOT NULL,
        paid_amount DECIMAL(12,2) NOT NULL,
        paid_date DATE NOT NULL,
        method VARCHAR(20) NOT NULL DEFAULT 'bank_transfer',
        notes VARCHAR(255) DEFAULT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_fin_cost_payment_cost (cost_id),
        KEY idx_fin_cost_payment_account (account_id),
        KEY idx_fin_cost_payment_date (paid_date),
        CONSTRAINT fk_fin_cost_payment_cost FOREIGN KEY (cost_id) REFERENCES fin_costs(id),
        CONSTRAINT fk_fin_cost_payment_account FOREIGN KEY (account_id) REFERENCES fin_cash_accounts(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    );

    await conn.execute(
      `CREATE TABLE IF NOT EXISTS fin_salaries (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        salary_no VARCHAR(32) NOT NULL,
        period_month DATE NOT NULL,
        employee_id INT UNSIGNED DEFAULT NULL,
        employee_name VARCHAR(64) NOT NULL,
        department VARCHAR(64) NOT NULL,
        position_title VARCHAR(64) DEFAULT NULL,
        base_salary DECIMAL(12,2) NOT NULL DEFAULT 0,
        performance_bonus DECIMAL(12,2) NOT NULL DEFAULT 0,
        allowance DECIMAL(12,2) NOT NULL DEFAULT 0,
        deduction DECIMAL(12,2) NOT NULL DEFAULT 0,
        employer_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
        amount DECIMAL(12,2) NOT NULL,
        paid_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
        due_date DATE DEFAULT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'open',
        owner VARCHAR(64) DEFAULT NULL,
        notes TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_fin_salary_no (salary_no),
        KEY idx_fin_salary_period (period_month),
        KEY idx_fin_salary_employee (employee_id),
        KEY idx_fin_salary_department (department),
        KEY idx_fin_salary_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    );

    await conn.execute(
      `CREATE TABLE IF NOT EXISTS fin_salary_payment_records (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        salary_id INT UNSIGNED NOT NULL,
        account_id INT UNSIGNED NOT NULL,
        paid_amount DECIMAL(12,2) NOT NULL,
        paid_date DATE NOT NULL,
        method VARCHAR(20) NOT NULL DEFAULT 'bank_transfer',
        notes VARCHAR(255) DEFAULT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_fin_salary_payment_salary (salary_id),
        KEY idx_fin_salary_payment_account (account_id),
        KEY idx_fin_salary_payment_date (paid_date),
        CONSTRAINT fk_fin_salary_payment_salary FOREIGN KEY (salary_id) REFERENCES fin_salaries(id),
        CONSTRAINT fk_fin_salary_payment_account FOREIGN KEY (account_id) REFERENCES fin_cash_accounts(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    );

    await conn.execute(
      `CREATE TABLE IF NOT EXISTS fin_ai_expenses (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        expense_no VARCHAR(32) NOT NULL,
        period_month DATE NOT NULL,
        provider_name VARCHAR(64) NOT NULL,
        service_type VARCHAR(32) NOT NULL DEFAULT 'llm_api',
        model_name VARCHAR(64) DEFAULT NULL,
        usage_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
        usage_unit VARCHAR(24) NOT NULL DEFAULT 'k_token',
        unit_price DECIMAL(12,6) NOT NULL DEFAULT 0,
        amount DECIMAL(12,2) NOT NULL,
        paid_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
        due_date DATE DEFAULT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'open',
        vendor_id INT UNSIGNED DEFAULT NULL,
        owner VARCHAR(64) DEFAULT NULL,
        notes TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_fin_ai_expense_no (expense_no),
        KEY idx_fin_ai_period (period_month),
        KEY idx_fin_ai_status (status),
        KEY idx_fin_ai_provider (provider_name),
        KEY idx_fin_ai_vendor (vendor_id),
        CONSTRAINT fk_fin_ai_vendor FOREIGN KEY (vendor_id) REFERENCES fin_vendors(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    );

    await conn.execute(
      `CREATE TABLE IF NOT EXISTS fin_ai_payment_records (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        ai_expense_id INT UNSIGNED NOT NULL,
        account_id INT UNSIGNED NOT NULL,
        paid_amount DECIMAL(12,2) NOT NULL,
        paid_date DATE NOT NULL,
        method VARCHAR(20) NOT NULL DEFAULT 'bank_transfer',
        notes VARCHAR(255) DEFAULT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_fin_ai_payment_expense (ai_expense_id),
        KEY idx_fin_ai_payment_account (account_id),
        KEY idx_fin_ai_payment_date (paid_date),
        CONSTRAINT fk_fin_ai_payment_expense FOREIGN KEY (ai_expense_id) REFERENCES fin_ai_expenses(id),
        CONSTRAINT fk_fin_ai_payment_account FOREIGN KEY (account_id) REFERENCES fin_cash_accounts(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    );

    await ensureColumnIfMissing(
      conn,
      'fin_salaries',
      'employee_id',
      'ALTER TABLE fin_salaries ADD COLUMN employee_id INT UNSIGNED DEFAULT NULL AFTER period_month'
    );
    await ensureIndexIfMissing(
      conn,
      'fin_salaries',
      'idx_fin_salary_employee',
      'ALTER TABLE fin_salaries ADD INDEX idx_fin_salary_employee (employee_id)'
    );

    budgetCostTablesReady = true;
  } finally {
    conn.release();
  }
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

const getOaEmployeeById = async (employeeId, { includeInactive = true } = {}) => {
  const id = Number(employeeId);
  if (!Number.isInteger(id) || id <= 0) return null;
  return withExternalConnection(oaDbConfig, async (oaConn) => {
    const [rows] = await oaConn.execute(
      `SELECT id, name, department, \`position\`, email, phone, status
       FROM employees
       WHERE id = ?
       LIMIT 1`,
      [id]
    );
    const employee = rows[0] || null;
    if (!employee) return null;
    if (!includeInactive && String(employee.status || 'active') !== 'active') return null;
    return employee;
  });
};

const listOaEmployees = async ({ status, department, keyword } = {}) => withExternalConnection(oaDbConfig, async (oaConn) => {
  let sql = `SELECT id, name, department, \`position\`, email, phone, status, created_at
             FROM employees
             WHERE 1=1`;
  const params = [];
  if (status && status !== 'all') {
    sql += ' AND status = ?';
    params.push(String(status).trim());
  }
  if (department) {
    sql += ' AND department = ?';
    params.push(String(department).trim());
  }
  if (keyword) {
    const kw = `%${String(keyword).trim()}%`;
    sql += ' AND (name LIKE ? OR department LIKE ? OR `position` LIKE ? OR email LIKE ? OR phone LIKE ?)';
    params.push(kw, kw, kw, kw, kw);
  }
  sql += " ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, id ASC";
  const [rows] = await oaConn.execute(sql, params);
  return rows;
});

const syncSalaryLedgerWithOa = async ({ force = false, createMissing = false, periodMonth } = {}) => {
  const now = Date.now();
  if (!force && now - oaSalaryLastSyncAt < OA_SALARY_SYNC_INTERVAL_MS) {
    return {
      skipped: true,
      reason: 'interval_guard',
      syncedAt: new Date(oaSalaryLastSyncAt || now).toISOString()
    };
  }
  if (oaSalarySyncRunning) return oaSalarySyncRunning;

  oaSalarySyncRunning = (async () => {
    await ensureBudgetCostTables();
    const targetPeriod = normalizePeriodMonth(periodMonth);
    const targetDueDate = addDays(targetPeriod, 7);

    const [salaryRows, oaEmployees] = await Promise.all([
      getAll('SELECT id, period_month, employee_id, employee_name, department, position_title FROM fin_salaries ORDER BY id ASC'),
      listOaEmployees({ status: 'all' })
    ]);

    const byId = new Map();
    const byNameDept = new Map();
    const byName = new Map();
    for (const e of oaEmployees) {
      const id = Number(e.id);
      if (id > 0) byId.set(id, e);
      const nameKey = String(e.name || '').trim();
      const deptKey = String(e.department || '').trim();
      if (nameKey && deptKey) {
        byNameDept.set(`${nameKey}##${deptKey}`, e);
      }
      if (nameKey) {
        const arr = byName.get(nameKey) || [];
        arr.push(e);
        byName.set(nameKey, arr);
      }
    }

    let linkedByIdCount = 0;
    let linkedByNameCount = 0;
    let refreshedCount = 0;
    let createdMissingCount = 0;
    let unresolvedCount = 0;
    const updates = [];
    const inserts = [];

    for (const row of salaryRows) {
      const rowId = Number(row.id);
      const currentEmployeeId = Number(row.employee_id || 0);
      const currentName = String(row.employee_name || '').trim();
      const currentDept = String(row.department || '').trim();
      const currentPos = String(row.position_title || '').trim();

      let target = currentEmployeeId > 0 ? byId.get(currentEmployeeId) : null;
      let linkSource = 'id';

      if (!target) {
        if (currentName && currentDept) {
          target = byNameDept.get(`${currentName}##${currentDept}`) || null;
        }
        if (!target && currentName) {
          const list = byName.get(currentName) || [];
          if (list.length === 1) {
            target = list[0];
          }
        }
        linkSource = 'name';
      }

      if (!target) {
        unresolvedCount += 1;
        continue;
      }

      const nextEmployeeId = Number(target.id);
      const nextName = String(target.name || '').trim();
      const nextDept = String(target.department || '').trim();
      const nextPos = String(target.position || '').trim();

      const needUpdate = currentEmployeeId !== nextEmployeeId
        || currentName !== nextName
        || currentDept !== nextDept
        || currentPos !== nextPos;
      if (!needUpdate) continue;

      updates.push({ rowId, nextEmployeeId, nextName, nextDept, nextPos, linkSource, currentEmployeeId });
    }

    if (createMissing) {
      const existingEmployeeIds = new Set(
        salaryRows
          .filter((x) => String(x.period_month || '').slice(0, 10) === targetPeriod && Number(x.employee_id || 0) > 0)
          .map((x) => Number(x.employee_id))
      );
      const periodTag = targetPeriod.slice(0, 7).replace('-', '');
      for (const e of oaEmployees) {
        if (String(e.status || 'active') !== 'active') continue;
        const employeeId = Number(e.id);
        if (!employeeId || existingEmployeeIds.has(employeeId)) continue;
        const tpl = estimateSalaryTemplateByPosition(e.position);
        const amount = calcSalaryAmount(tpl);
        if (amount <= 0) continue;
        inserts.push({
          salaryNo: `SA-${periodTag}-OA${String(employeeId).padStart(3, '0')}`.slice(0, 32),
          periodMonth: targetPeriod,
          employeeId,
          employeeName: String(e.name || '').trim().slice(0, 64),
          department: String(e.department || '').trim().slice(0, 64),
          positionTitle: String(e.position || '').trim().slice(0, 64) || null,
          ...tpl,
          amount,
          dueDate: targetDueDate
        });
        existingEmployeeIds.add(employeeId);
      }
    }

    if (updates.length || inserts.length) {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        for (const u of updates) {
          await conn.execute(
            `UPDATE fin_salaries
             SET employee_id = ?, employee_name = ?, department = ?, position_title = ?
             WHERE id = ?`,
            [u.nextEmployeeId, u.nextName, u.nextDept, u.nextPos || null, u.rowId]
          );
          refreshedCount += 1;
          if (u.currentEmployeeId <= 0) {
            if (u.linkSource === 'id') linkedByIdCount += 1;
            else linkedByNameCount += 1;
          }
        }
        for (const i of inserts) {
          try {
            await conn.execute(
              `INSERT INTO fin_salaries
               (salary_no, period_month, employee_id, employee_name, department, position_title, base_salary, performance_bonus, allowance, deduction, employer_cost, amount, paid_amount, due_date, status, owner, notes)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
              [
                i.salaryNo,
                i.periodMonth,
                i.employeeId,
                i.employeeName,
                i.department,
                i.positionTitle,
                toAmount(i.baseSalary),
                toAmount(i.performanceBonus),
                toAmount(i.allowance),
                toAmount(i.deduction),
                toAmount(i.employerCost),
                toAmount(i.amount),
                i.dueDate,
                calcCostStatus(i.amount, 0, i.dueDate),
                'OA同步任务',
                '系统按OA员工档案自动补齐薪资台账骨架'
              ]
            );
            createdMissingCount += 1;
          } catch (error) {
            if (!(error && error.code === 'ER_DUP_ENTRY')) {
              throw error;
            }
          }
        }
        await conn.commit();
      } catch (error) {
        await conn.rollback();
        throw error;
      } finally {
        conn.release();
      }
    }

    oaSalaryLastSyncAt = Date.now();
    return {
      skipped: false,
      totalSalaryRows: salaryRows.length,
      oaEmployeeRows: oaEmployees.length,
      refreshedCount,
      createdMissingCount,
      linkedByIdCount,
      linkedByNameCount,
      unresolvedCount,
      targetPeriod,
      syncedAt: new Date(oaSalaryLastSyncAt).toISOString()
    };
  })();

  try {
    return await oaSalarySyncRunning;
  } finally {
    oaSalarySyncRunning = null;
  }
};

const ensureSalaryLedgerSyncedWithOa = async ({ force = false, createMissing = false, periodMonth } = {}) => {
  try {
    return await syncSalaryLedgerWithOa({ force, createMissing, periodMonth });
  } catch (error) {
    console.warn(`⚠️ 薪资台账同步 OA 失败: ${error.message}`);
    return { skipped: true, reason: 'sync_failed', error: error.message };
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
    const nextProgressRatio = payload.sourceProgressRatio === undefined
      ? clampProgress(current.source_progress_ratio || 0)
      : clampProgress(payload.sourceProgressRatio);
    const nextProgressStatus = normalizeProgressStatus(
      payload.sourceProgressStatus === undefined ? current.source_progress_status : payload.sourceProgressStatus
    );
    const nextStrategy = normalizeStatusStrategy(
      payload.statusStrategy === undefined ? current.status_strategy : payload.statusStrategy
    );

    await conn.execute(
      `UPDATE fin_receivables
       SET customer_id = ?, biz_type = ?, product_name = ?, amount_due = ?, amount_received = ?, due_date = ?, status = ?,
           source_progress_ratio = ?, source_progress_status = ?, status_strategy = ?, owner = ?, notes = ?
       WHERE id = ?`,
      [
        nextCustomerId,
        payload.bizType === 'toc' ? 'toc' : 'tob',
        payload.productName || null,
        nextDue,
        nextReceived,
        dueDate,
        nextStatus,
        nextProgressRatio,
        nextProgressStatus,
        nextStrategy,
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
  const progressRatio = clampProgress(payload.sourceProgressRatio || 0);
  const progressStatus = normalizeProgressStatus(payload.sourceProgressStatus);
  const statusStrategy = normalizeStatusStrategy(payload.statusStrategy);

  await conn.execute(
    `INSERT INTO fin_receivables
      (bill_no, customer_id, biz_type, product_name, source_ref, amount_due, amount_received, due_date, status,
       source_progress_ratio, source_progress_status, status_strategy, owner, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      progressRatio,
      progressStatus,
      statusStrategy,
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
    const nextProgressRatio = payload.sourceProgressRatio === undefined
      ? clampProgress(current.source_progress_ratio || 0)
      : clampProgress(payload.sourceProgressRatio);
    const nextProgressStatus = normalizeProgressStatus(
      payload.sourceProgressStatus === undefined ? current.source_progress_status : payload.sourceProgressStatus
    );
    const nextStrategy = normalizeStatusStrategy(
      payload.statusStrategy === undefined ? current.status_strategy : payload.statusStrategy
    );

    await conn.execute(
      `UPDATE fin_payables
       SET vendor_id = ?, category = ?, amount_due = ?, amount_paid = ?, due_date = ?, status = ?,
           source_progress_ratio = ?, source_progress_status = ?, status_strategy = ?, owner = ?, notes = ?
       WHERE id = ?`,
      [
        nextVendorId,
        payload.category || 'service',
        nextDue,
        nextPaid,
        dueDate,
        nextStatus,
        nextProgressRatio,
        nextProgressStatus,
        nextStrategy,
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
  const progressRatio = clampProgress(payload.sourceProgressRatio || 0);
  const progressStatus = normalizeProgressStatus(payload.sourceProgressStatus);
  const statusStrategy = normalizeStatusStrategy(payload.statusStrategy);

  await conn.execute(
    `INSERT INTO fin_payables
      (bill_no, vendor_id, category, source_ref, amount_due, amount_paid, due_date, status,
       source_progress_ratio, source_progress_status, status_strategy, owner, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      billNo,
      Number(payload.vendorId),
      payload.category || 'service',
      sourceRef,
      dueRaw,
      amountPaid,
      dueDate,
      status,
      progressRatio,
      progressStatus,
      statusStrategy,
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
      const crmProgress = crmProgressByOrderStatus(row.order_status);
      const result = await upsertReceivableBySource(finConn, {
        billNo: `AR-CRM-${row.id}`,
        sourceRef: `CRM-ORDER-${row.id}`,
        customerId,
        bizType: row.biz_type,
        productName: row.product_name || 'CRM订单',
        amountDue: due,
        amountReceived: paid,
        dueDate: addDays(row.signed_at || row.created_at, 30),
        sourceProgressStatus: crmProgress.progressStatus,
        sourceProgressRatio: crmProgress.progressRatio,
        statusStrategy: crmProgress.strategy,
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
              e.name AS sales_owner_name,
              IFNULL(i.shipped_ratio, 0) AS shipped_ratio
       FROM erp_sales_orders s
       JOIN mdm_customers c ON c.id = s.customer_id
       LEFT JOIN mdm_employees e ON e.id = s.sales_owner_id
       LEFT JOIN (
         SELECT
           sales_order_id,
           CASE
             WHEN SUM(CASE WHEN quantity > 0 THEN amount ELSE 0 END) > 0
               THEN ROUND(
                 SUM(CASE
                   WHEN quantity > 0 THEN amount * LEAST(shipped_qty, quantity) / quantity
                   ELSE 0
                 END) / SUM(CASE WHEN quantity > 0 THEN amount ELSE 0 END) * 100, 2
               )
             ELSE 0
           END AS shipped_ratio
         FROM erp_sales_order_items
         GROUP BY sales_order_id
       ) i ON i.sales_order_id = s.id
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

      const progressSeed = erpSalesProgressByStatus(row.order_status, clampProgress(row.shipped_ratio || 0));
      const progress = receivableProgressText(progressSeed.progressStatus, progressSeed.progressRatio);
      const result = await upsertReceivableBySource(finConn, {
        billNo: `AR-ERP-SO-${row.id}`,
        sourceRef: `ERP-SO-${row.id}`,
        customerId,
        bizType: row.customer_type,
        productName: row.so_no || 'ERP销售订单',
        amountDue: due,
        amountReceived: 0,
        dueDate: addDays(row.order_date || row.expected_delivery_date, 30),
        sourceProgressStatus: progress.status,
        sourceProgressRatio: progress.ratio,
        statusStrategy: strategyFromReceivableProgress(progress.status),
        owner: row.sales_owner_name || 'ERP自动同步',
        notes: `来源ERP销售单${row.so_no || row.id}，状态：${row.order_status}，发货进度：${progress.ratio}%`
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
              e.name AS purchaser_name,
              IFNULL(i.received_ratio, 0) AS received_ratio
       FROM erp_purchase_orders po
       JOIN vendors v ON v.id = po.vendor_id
       LEFT JOIN mdm_employees e ON e.id = po.purchaser_id
       LEFT JOIN (
         SELECT
           purchase_order_id,
           CASE
             WHEN SUM(CASE WHEN quantity > 0 THEN amount ELSE 0 END) > 0
               THEN ROUND(
                 SUM(CASE
                   WHEN quantity > 0 THEN amount * LEAST(received_qty, quantity) / quantity
                   ELSE 0
                 END) / SUM(CASE WHEN quantity > 0 THEN amount ELSE 0 END) * 100, 2
               )
             ELSE 0
           END AS received_ratio
         FROM erp_purchase_order_items
         GROUP BY purchase_order_id
       ) i ON i.purchase_order_id = po.id
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

      const progressSeed = erpPurchaseProgressByStatus(row.order_status, clampProgress(row.received_ratio || 0));
      const progress = payableProgressText(progressSeed.progressStatus, progressSeed.progressRatio);
      const result = await upsertPayableBySource(finConn, {
        billNo: `AP-ERP-PO-${row.id}`,
        sourceRef: `ERP-PO-${row.id}`,
        vendorId,
        category: row.category || 'service',
        amountDue: due,
        amountPaid: 0,
        dueDate: addDays(row.order_date || row.expected_arrival_date, 30),
        sourceProgressStatus: progress.status,
        sourceProgressRatio: progress.ratio,
        statusStrategy: strategyFromPayableProgress(progress.status),
        owner: row.purchaser_name || 'ERP自动同步',
        notes: `来源ERP采购单${row.po_no || row.id}，状态：${row.order_status}，收货进度：${progress.ratio}%`
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
  await ensureSyncProgressColumns();
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

app.use('/api', (req, res, next) => {
  if (req.path === '/health') {
    return next();
  }
  return requirePortalAuth(req, res, next);
});

app.get('/api/auth/context', asyncHandler(async (req, res) => {
  res.json({
    code: 0,
    data: {
      userId: Number(req.auth.sub || 0),
      username: req.auth.username || '',
      displayName: req.auth.displayName || '',
      appAccess: Array.isArray(req.auth.appAccess) ? req.auth.appAccess : [],
      bindings: req.auth.bindings || {}
    }
  });
}));

app.get('/api/oa-employees', asyncHandler(async (req, res) => {
  const { status = 'all', department, keyword } = req.query;
  const data = await listOaEmployees({ status, department, keyword });
  res.json({ code: 0, data });
}));

app.get('/api/dashboard', asyncHandler(async (req, res) => {
  await ensureBudgetCostTables();
  await ensureSalaryLedgerSyncedWithOa();
  await refreshAgingStatus();

  const [
    receivableSummary,
    payableSummary,
    incomeSummary,
    payableExpenseSummary,
    costPaidSummary,
    costAccrualSummary,
    salaryPaidSummary,
    salaryAccrualSummary,
    aiPaidSummary,
    aiAccrualSummary,
    budgetSummary,
    overBudgetSummary,
    cashSummary,
    pendingCostSummary,
    pendingSalarySummary,
    pendingAiSummary,
    dueReceivables,
    duePayables,
    latestCosts,
    latestSalaries,
    latestAiExpenses
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
      `SELECT IFNULL(SUM(paid_amount), 0) AS month_cost_paid
       FROM fin_cost_payment_records
       WHERE DATE_FORMAT(paid_date, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m')`
    ),
    getOne(
      `SELECT IFNULL(SUM(amount), 0) AS month_cost
       FROM fin_costs
       WHERE DATE_FORMAT(cost_date, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m')`
    ),
    getOne(
      `SELECT IFNULL(SUM(paid_amount), 0) AS month_salary_paid
       FROM fin_salary_payment_records
       WHERE DATE_FORMAT(paid_date, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m')`
    ),
    getOne(
      `SELECT IFNULL(SUM(amount), 0) AS month_salary
       FROM fin_salaries
       WHERE DATE_FORMAT(period_month, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m')`
    ),
    getOne(
      `SELECT IFNULL(SUM(paid_amount), 0) AS month_ai_paid
       FROM fin_ai_payment_records
       WHERE DATE_FORMAT(paid_date, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m')`
    ),
    getOne(
      `SELECT IFNULL(SUM(amount), 0) AS month_ai_expense
       FROM fin_ai_expenses
       WHERE DATE_FORMAT(period_month, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m')`
    ),
    getOne(
      `SELECT IFNULL(SUM(budget_amount), 0) AS month_budget
       FROM fin_budgets
       WHERE DATE_FORMAT(period_month, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m')
         AND status IN ('draft', 'active', 'closed')`
    ),
    getOne(
      `SELECT COUNT(*) AS over_budget_count
       FROM (
         SELECT b.id
         FROM fin_budgets b
         LEFT JOIN fin_costs c
           ON c.department = b.department
          AND c.cost_type = b.subject
          AND DATE_FORMAT(c.cost_date, '%Y-%m') = DATE_FORMAT(b.period_month, '%Y-%m')
         WHERE DATE_FORMAT(b.period_month, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m')
           AND b.status IN ('active', 'closed')
         GROUP BY b.id, b.budget_amount
         HAVING IFNULL(SUM(c.amount), 0) > b.budget_amount
       ) t`
    ),
    getOne('SELECT IFNULL(SUM(balance), 0) AS cash_balance FROM fin_cash_accounts WHERE status = ?', ['active']),
    getOne("SELECT COUNT(*) AS pending_count FROM fin_costs WHERE status IN ('open', 'partial', 'overdue')"),
    getOne("SELECT COUNT(*) AS pending_count FROM fin_salaries WHERE status IN ('open', 'partial', 'overdue')"),
    getOne("SELECT COUNT(*) AS pending_count FROM fin_ai_expenses WHERE status IN ('open', 'partial', 'overdue')"),
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
      `SELECT id, cost_no, department, cost_type, amount, paid_amount, status, cost_date
       FROM fin_costs
       ORDER BY id DESC
       LIMIT 5`
    ),
    getAll(
      `SELECT id, salary_no, employee_name, department, amount, paid_amount, status, period_month
       FROM fin_salaries
       ORDER BY id DESC
       LIMIT 5`
    ),
    getAll(
      `SELECT id, expense_no, provider_name, service_type, amount, paid_amount, status, period_month
       FROM fin_ai_expenses
       ORDER BY id DESC
       LIMIT 5`
    )
  ]);

  const monthExpense = toAmount(payableExpenseSummary.month_payable_expense || 0)
    + toAmount(costPaidSummary.month_cost_paid || 0)
    + toAmount(salaryPaidSummary.month_salary_paid || 0)
    + toAmount(aiPaidSummary.month_ai_paid || 0);
  const monthBudget = toAmount(budgetSummary.month_budget || 0);
  const monthCost = toAmount(costAccrualSummary.month_cost || 0)
    + toAmount(salaryAccrualSummary.month_salary || 0)
    + toAmount(aiAccrualSummary.month_ai_expense || 0);
  const budgetExecutionRate = monthBudget > 0 ? toAmount((monthCost / monthBudget) * 100) : 0;

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
      monthBudget,
      monthCost,
      budgetExecutionRate,
      monthSalary: toAmount(salaryAccrualSummary.month_salary || 0),
      monthAiExpense: toAmount(aiAccrualSummary.month_ai_expense || 0),
      overBudgetCount: Number(overBudgetSummary.over_budget_count || 0),
      pendingCostCount: Number(pendingCostSummary.pending_count || 0),
      pendingSalaryCount: Number(pendingSalarySummary.pending_count || 0),
      pendingAiExpenseCount: Number(pendingAiSummary.pending_count || 0),
      dueReceivables,
      duePayables,
      latestCosts,
      latestSalaries,
      latestAiExpenses
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

const getBudgetDetailById = async (id) => getOne(
  `SELECT b.*,
          IFNULL(u.used_amount, 0) AS used_amount,
          ROUND(CASE WHEN b.budget_amount > 0 THEN IFNULL(u.used_amount, 0) / b.budget_amount * 100 ELSE 0 END, 2) AS usage_ratio,
          (b.budget_amount - IFNULL(u.used_amount, 0)) AS remain_amount
   FROM fin_budgets b
   LEFT JOIN (
     SELECT department, cost_type, DATE_FORMAT(cost_date, '%Y-%m') AS ym, SUM(amount) AS used_amount
     FROM fin_costs
     GROUP BY department, cost_type, DATE_FORMAT(cost_date, '%Y-%m')
   ) u
     ON u.department = b.department
    AND u.cost_type = b.subject
    AND u.ym = DATE_FORMAT(b.period_month, '%Y-%m')
   WHERE b.id = ?`,
  [id]
);

app.get('/api/budgets', asyncHandler(async (req, res) => {
  await ensureBudgetCostTables();
  await refreshAgingStatus();

  const { status, department, period, keyword, updatedAfter } = req.query;
  const params = [];
  let sql = `SELECT b.*,
                    IFNULL(u.used_amount, 0) AS used_amount,
                    ROUND(CASE WHEN b.budget_amount > 0 THEN IFNULL(u.used_amount, 0) / b.budget_amount * 100 ELSE 0 END, 2) AS usage_ratio,
                    (b.budget_amount - IFNULL(u.used_amount, 0)) AS remain_amount
             FROM fin_budgets b
             LEFT JOIN (
               SELECT department, cost_type, DATE_FORMAT(cost_date, '%Y-%m') AS ym, SUM(amount) AS used_amount
               FROM fin_costs
               GROUP BY department, cost_type, DATE_FORMAT(cost_date, '%Y-%m')
             ) u
               ON u.department = b.department
              AND u.cost_type = b.subject
              AND u.ym = DATE_FORMAT(b.period_month, '%Y-%m')
             WHERE 1=1`;

  if (status) {
    sql += ' AND b.status = ?';
    params.push(status);
  }
  if (department) {
    sql += ' AND b.department = ?';
    params.push(String(department).trim());
  }
  if (period) {
    const periodNorm = normalizePeriodMonth(period).slice(0, 7);
    sql += " AND DATE_FORMAT(b.period_month, '%Y-%m') = ?";
    params.push(periodNorm);
  }
  if (keyword) {
    const kw = `%${String(keyword).trim()}%`;
    sql += ' AND (b.budget_no LIKE ? OR b.department LIKE ? OR b.owner LIKE ? OR b.notes LIKE ?)';
    params.push(kw, kw, kw, kw);
  }
  if (updatedAfter) {
    const at = normalizeDateTimeInput(updatedAfter);
    if (!at) {
      return res.status(400).json({ code: 1, message: 'updatedAfter 格式错误，需 YYYY-MM-DD 或 YYYY-MM-DD HH:mm[:ss]' });
    }
    sql += ' AND b.created_at >= ?';
    params.push(at);
  }

  sql += ' ORDER BY b.period_month DESC, b.id DESC';
  const data = await getAll(sql, params);
  res.json({ code: 0, data });
}));

app.post('/api/budgets', asyncHandler(async (req, res) => {
  await ensureBudgetCostTables();
  const { budgetNo, periodMonth, department, subject, budgetAmount, status, owner, notes } = req.body;
  if (!department || !String(department).trim() || toAmount(budgetAmount) <= 0) {
    return res.status(400).json({ code: 1, message: '预算归属部门与预算金额必填' });
  }

  const allowedStatus = ['draft', 'active', 'closed'];
  const nextStatus = allowedStatus.includes(String(status || '').trim()) ? String(status).trim() : 'active';
  const nextBudgetNo = normalizeBillNo(
    budgetNo,
    `BG-${new Date().toISOString().slice(0, 7).replace('-', '')}-${Date.now().toString().slice(-3)}`
  );

  try {
    const result = await run(
      `INSERT INTO fin_budgets
       (budget_no, period_month, department, subject, budget_amount, status, owner, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        nextBudgetNo,
        normalizePeriodMonth(periodMonth),
        String(department).trim(),
        String(subject || 'operations').trim().slice(0, 32) || 'operations',
        toAmount(budgetAmount),
        nextStatus,
        owner ? String(owner).trim().slice(0, 64) : null,
        notes || null
      ]
    );
    const data = await getBudgetDetailById(result.insertId);
    res.json({ code: 0, message: '预算创建成功', data });
  } catch (error) {
    if (error && error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ code: 1, message: '预算编号已存在' });
    }
    throw error;
  }
}));

app.put('/api/budgets/:id', asyncHandler(async (req, res) => {
  await ensureBudgetCostTables();
  const id = Number(req.params.id);
  const current = await getOne('SELECT * FROM fin_budgets WHERE id = ?', [id]);
  if (!current) {
    return res.status(404).json({ code: 1, message: '预算不存在' });
  }

  const nextAmount = req.body.budgetAmount === undefined ? toAmount(current.budget_amount) : toAmount(req.body.budgetAmount);
  if (nextAmount <= 0) {
    return res.status(400).json({ code: 1, message: '预算金额必须大于0' });
  }

  const allowedStatus = ['draft', 'active', 'closed'];
  const nextStatus = req.body.status === undefined
    ? current.status
    : (allowedStatus.includes(String(req.body.status).trim()) ? String(req.body.status).trim() : null);
  if (!nextStatus) {
    return res.status(400).json({ code: 1, message: '预算状态不合法' });
  }

  await run(
    `UPDATE fin_budgets
     SET period_month = ?, department = ?, subject = ?, budget_amount = ?, status = ?, owner = ?, notes = ?
     WHERE id = ?`,
    [
      req.body.periodMonth === undefined ? current.period_month : normalizePeriodMonth(req.body.periodMonth),
      req.body.department === undefined ? current.department : String(req.body.department).trim(),
      req.body.subject === undefined ? current.subject : (String(req.body.subject || 'operations').trim().slice(0, 32) || 'operations'),
      nextAmount,
      nextStatus,
      req.body.owner === undefined ? current.owner : (req.body.owner ? String(req.body.owner).trim().slice(0, 64) : null),
      req.body.notes === undefined ? current.notes : (req.body.notes || null),
      id
    ]
  );

  const data = await getBudgetDetailById(id);
  res.json({ code: 0, message: '预算更新成功', data });
}));

app.get('/api/costs', asyncHandler(async (req, res) => {
  await ensureBudgetCostTables();
  await refreshAgingStatus();

  const { status, department, costType, keyword, updatedAfter } = req.query;
  const params = [];
  let sql = `SELECT c.*, v.name AS vendor_name
             FROM fin_costs c
             LEFT JOIN fin_vendors v ON v.id = c.vendor_id
             WHERE 1=1`;

  if (status) {
    sql += ' AND c.status = ?';
    params.push(status);
  }
  if (department) {
    sql += ' AND c.department = ?';
    params.push(String(department).trim());
  }
  if (costType) {
    sql += ' AND c.cost_type = ?';
    params.push(String(costType).trim());
  }
  if (keyword) {
    const kw = `%${String(keyword).trim()}%`;
    sql += ' AND (c.cost_no LIKE ? OR c.related_business LIKE ? OR c.owner LIKE ? OR c.notes LIKE ? OR v.name LIKE ?)';
    params.push(kw, kw, kw, kw, kw);
  }
  if (updatedAfter) {
    const at = normalizeDateTimeInput(updatedAfter);
    if (!at) {
      return res.status(400).json({ code: 1, message: 'updatedAfter 格式错误，需 YYYY-MM-DD 或 YYYY-MM-DD HH:mm[:ss]' });
    }
    sql += ' AND c.created_at >= ?';
    params.push(at);
  }

  sql += ' ORDER BY c.id DESC';
  const data = await getAll(sql, params);
  res.json({ code: 0, data });
}));

app.post('/api/costs', asyncHandler(async (req, res) => {
  await ensureBudgetCostTables();
  const { costNo, department, costType, relatedBusiness, vendorId, amount, costDate, dueDate, owner, notes } = req.body;

  if (!department || !String(department).trim() || !costDate || toAmount(amount) <= 0) {
    return res.status(400).json({ code: 1, message: '部门、成本日期、金额必填' });
  }

  const nextVendorId = vendorId ? Number(vendorId) : null;
  if (nextVendorId) {
    const vendor = await ensureVendor(nextVendorId);
    if (!vendor) {
      return res.status(400).json({ code: 1, message: '供应商不存在或不可用' });
    }
  }

  const nextCostNo = normalizeBillNo(
    costNo,
    `CT-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Date.now().toString().slice(-3)}`
  );
  const nextDueDate = dueDate ? toDateString(dueDate) : null;
  const amountDue = toAmount(amount);

  try {
    const result = await run(
      `INSERT INTO fin_costs
       (cost_no, department, cost_type, related_business, vendor_id, amount, paid_amount, cost_date, due_date, status, owner, notes)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
      [
        nextCostNo,
        String(department).trim(),
        String(costType || 'operations').trim().slice(0, 32) || 'operations',
        relatedBusiness ? String(relatedBusiness).trim().slice(0, 64) : null,
        nextVendorId,
        amountDue,
        toDateString(costDate),
        nextDueDate,
        calcCostStatus(amountDue, 0, nextDueDate),
        owner ? String(owner).trim().slice(0, 64) : null,
        notes || null
      ]
    );
    const data = await getOne(
      `SELECT c.*, v.name AS vendor_name
       FROM fin_costs c
       LEFT JOIN fin_vendors v ON v.id = c.vendor_id
       WHERE c.id = ?`,
      [result.insertId]
    );
    res.json({ code: 0, message: '成本单创建成功', data });
  } catch (error) {
    if (error && error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ code: 1, message: '成本单号已存在' });
    }
    throw error;
  }
}));

app.put('/api/costs/:id', asyncHandler(async (req, res) => {
  await ensureBudgetCostTables();
  const id = Number(req.params.id);
  const current = await getOne('SELECT * FROM fin_costs WHERE id = ?', [id]);
  if (!current) {
    return res.status(404).json({ code: 1, message: '成本单不存在' });
  }

  const nextAmount = req.body.amount === undefined ? toAmount(current.amount) : toAmount(req.body.amount);
  if (nextAmount <= 0) {
    return res.status(400).json({ code: 1, message: '成本金额必须大于0' });
  }
  if (nextAmount < toAmount(current.paid_amount)) {
    return res.status(400).json({ code: 1, message: '成本金额不能小于已付款金额' });
  }

  const nextVendorId = req.body.vendorId === undefined
    ? current.vendor_id
    : (req.body.vendorId ? Number(req.body.vendorId) : null);
  if (nextVendorId) {
    const vendor = await ensureVendor(nextVendorId);
    if (!vendor) {
      return res.status(400).json({ code: 1, message: '供应商不存在或不可用' });
    }
  }

  const nextDueDate = req.body.dueDate === undefined
    ? current.due_date
    : (req.body.dueDate ? toDateString(req.body.dueDate) : null);
  const nextCostDate = req.body.costDate === undefined ? current.cost_date : toDateString(req.body.costDate);
  const nextPaid = toAmount(current.paid_amount);

  await run(
    `UPDATE fin_costs
     SET department = ?, cost_type = ?, related_business = ?, vendor_id = ?, amount = ?, cost_date = ?, due_date = ?, status = ?, owner = ?, notes = ?
     WHERE id = ?`,
    [
      req.body.department === undefined ? current.department : String(req.body.department).trim(),
      req.body.costType === undefined ? current.cost_type : (String(req.body.costType || 'operations').trim().slice(0, 32) || 'operations'),
      req.body.relatedBusiness === undefined ? current.related_business : (req.body.relatedBusiness ? String(req.body.relatedBusiness).trim().slice(0, 64) : null),
      nextVendorId,
      nextAmount,
      nextCostDate,
      nextDueDate,
      calcCostStatus(nextAmount, nextPaid, nextDueDate),
      req.body.owner === undefined ? current.owner : (req.body.owner ? String(req.body.owner).trim().slice(0, 64) : null),
      req.body.notes === undefined ? current.notes : (req.body.notes || null),
      id
    ]
  );

  const data = await getOne(
    `SELECT c.*, v.name AS vendor_name
     FROM fin_costs c
     LEFT JOIN fin_vendors v ON v.id = c.vendor_id
     WHERE c.id = ?`,
    [id]
  );
  res.json({ code: 0, message: '成本单更新成功', data });
}));

app.get('/api/costs/:id/payments', asyncHandler(async (req, res) => {
  await ensureBudgetCostTables();
  const id = Number(req.params.id);
  const cost = await getOne('SELECT * FROM fin_costs WHERE id = ?', [id]);
  if (!cost) {
    return res.status(404).json({ code: 1, message: '成本单不存在' });
  }

  const data = await getAll(
    `SELECT cp.*, ca.account_name
     FROM fin_cost_payment_records cp
     JOIN fin_cash_accounts ca ON ca.id = cp.account_id
     WHERE cp.cost_id = ?
     ORDER BY cp.id DESC`,
    [id]
  );
  res.json({ code: 0, data });
}));

app.post('/api/costs/:id/payments', asyncHandler(async (req, res) => {
  await ensureBudgetCostTables();
  const id = Number(req.params.id);
  const { paidAmount, paidDate, method, accountId, notes } = req.body;
  const amount = toAmount(paidAmount);

  if (!accountId || amount <= 0 || !paidDate) {
    return res.status(400).json({ code: 1, message: '付款金额、付款日期、付款账户必填' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [cRows] = await conn.execute('SELECT * FROM fin_costs WHERE id = ? FOR UPDATE', [id]);
    const cost = cRows[0];
    if (!cost) {
      await conn.rollback();
      return res.status(404).json({ code: 1, message: '成本单不存在' });
    }

    const remain = toAmount(cost.amount) - toAmount(cost.paid_amount);
    if (remain <= 0) {
      await conn.rollback();
      return res.status(400).json({ code: 1, message: '该成本单已支付完成' });
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
      `INSERT INTO fin_cost_payment_records (cost_id, account_id, paid_amount, paid_date, method, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, Number(accountId), amount, paidDate, method || 'bank_transfer', notes || null]
    );

    const nextPaid = toAmount(cost.paid_amount) + amount;
    await conn.execute(
      `UPDATE fin_costs
       SET paid_amount = ?, status = ?
       WHERE id = ?`,
      [nextPaid, calcCostStatus(cost.amount, nextPaid, cost.due_date), id]
    );
    await conn.execute('UPDATE fin_cash_accounts SET balance = balance - ? WHERE id = ?', [amount, Number(accountId)]);

    await conn.commit();

    const data = await getOne(
      `SELECT c.*, v.name AS vendor_name
       FROM fin_costs c
       LEFT JOIN fin_vendors v ON v.id = c.vendor_id
       WHERE c.id = ?`,
      [id]
    );
    res.json({ code: 0, message: '成本付款登记成功', data });
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}));

const getSalaryDetailById = async (id) => getOne(
  `SELECT s.*,
          (s.amount - s.paid_amount) AS remain_amount
   FROM fin_salaries s
   WHERE s.id = ?`,
  [id]
);

app.get('/api/salaries', asyncHandler(async (req, res) => {
  await ensureBudgetCostTables();
  await ensureSalaryLedgerSyncedWithOa();
  await refreshAgingStatus();

  const { status, department, period, keyword, updatedAfter } = req.query;
  const params = [];
  let sql = `SELECT s.*,
                    (s.amount - s.paid_amount) AS remain_amount
             FROM fin_salaries s
             WHERE 1=1`;

  if (status) {
    sql += ' AND s.status = ?';
    params.push(status);
  }
  if (department) {
    sql += ' AND s.department = ?';
    params.push(String(department).trim());
  }
  if (period) {
    const periodNorm = normalizePeriodMonth(period).slice(0, 7);
    sql += " AND DATE_FORMAT(s.period_month, '%Y-%m') = ?";
    params.push(periodNorm);
  }
  if (keyword) {
    const kw = `%${String(keyword).trim()}%`;
    sql += ' AND (s.salary_no LIKE ? OR s.employee_name LIKE ? OR s.department LIKE ? OR s.owner LIKE ? OR s.notes LIKE ?)';
    params.push(kw, kw, kw, kw, kw);
  }
  if (updatedAfter) {
    const at = normalizeDateTimeInput(updatedAfter);
    if (!at) {
      return res.status(400).json({ code: 1, message: 'updatedAfter 格式错误，需 YYYY-MM-DD 或 YYYY-MM-DD HH:mm[:ss]' });
    }
    sql += ' AND s.created_at >= ?';
    params.push(at);
  }

  sql += ' ORDER BY s.period_month DESC, s.id DESC';
  const data = await getAll(sql, params);
  res.json({ code: 0, data });
}));

app.post('/api/salaries', asyncHandler(async (req, res) => {
  await ensureBudgetCostTables();
  const {
    salaryNo,
    periodMonth,
    employeeId,
    baseSalary,
    performanceBonus,
    allowance,
    deduction,
    employerCost,
    dueDate,
    owner,
    notes
  } = req.body;

  const nextEmployeeId = Number(employeeId);
  if (!Number.isInteger(nextEmployeeId) || nextEmployeeId <= 0) {
    return res.status(400).json({ code: 1, message: '请选择OA员工' });
  }

  const oaEmployee = await getOaEmployeeById(nextEmployeeId, { includeInactive: true });
  if (!oaEmployee) {
    return res.status(400).json({ code: 1, message: 'OA员工不存在' });
  }

  const amount = calcSalaryAmount({ baseSalary, performanceBonus, allowance, deduction, employerCost });
  if (amount <= 0) {
    return res.status(400).json({ code: 1, message: '薪资应发金额必须大于0' });
  }

  const nextSalaryNo = normalizeBillNo(
    salaryNo,
    `SA-${new Date().toISOString().slice(0, 7).replace('-', '')}-${Date.now().toString().slice(-3)}`
  );
  const nextDueDate = dueDate ? toDateString(dueDate) : addDays(normalizePeriodMonth(periodMonth), 6);

  try {
    const result = await run(
      `INSERT INTO fin_salaries
       (salary_no, period_month, employee_id, employee_name, department, position_title, base_salary, performance_bonus, allowance, deduction, employer_cost, amount, paid_amount, due_date, status, owner, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
      [
        nextSalaryNo,
        normalizePeriodMonth(periodMonth),
        nextEmployeeId,
        String(oaEmployee.name || '').trim().slice(0, 64),
        String(oaEmployee.department || '').trim().slice(0, 64),
        String(oaEmployee.position || '').trim().slice(0, 64) || null,
        toAmount(baseSalary),
        toAmount(performanceBonus),
        toAmount(allowance),
        toAmount(deduction),
        toAmount(employerCost),
        amount,
        nextDueDate,
        calcCostStatus(amount, 0, nextDueDate),
        owner ? String(owner).trim().slice(0, 64) : null,
        notes || null
      ]
    );
    const data = await getSalaryDetailById(result.insertId);
    res.json({ code: 0, message: '薪资单创建成功', data });
  } catch (error) {
    if (error && error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ code: 1, message: '薪资单号已存在' });
    }
    throw error;
  }
}));

app.put('/api/salaries/:id', asyncHandler(async (req, res) => {
  await ensureBudgetCostTables();
  const id = Number(req.params.id);
  const current = await getOne('SELECT * FROM fin_salaries WHERE id = ?', [id]);
  if (!current) {
    return res.status(404).json({ code: 1, message: '薪资单不存在' });
  }

  const nextBase = req.body.baseSalary === undefined ? current.base_salary : req.body.baseSalary;
  const nextBonus = req.body.performanceBonus === undefined ? current.performance_bonus : req.body.performanceBonus;
  const nextAllowance = req.body.allowance === undefined ? current.allowance : req.body.allowance;
  const nextDeduction = req.body.deduction === undefined ? current.deduction : req.body.deduction;
  const nextEmployerCost = req.body.employerCost === undefined ? current.employer_cost : req.body.employerCost;
  const nextAmount = calcSalaryAmount({
    baseSalary: nextBase,
    performanceBonus: nextBonus,
    allowance: nextAllowance,
    deduction: nextDeduction,
    employerCost: nextEmployerCost
  });

  if (nextAmount <= 0) {
    return res.status(400).json({ code: 1, message: '薪资应发金额必须大于0' });
  }
  if (nextAmount < toAmount(current.paid_amount)) {
    return res.status(400).json({ code: 1, message: '薪资应发金额不能低于已发金额' });
  }

  const nextEmployeeId = req.body.employeeId === undefined ? Number(current.employee_id || 0) : Number(req.body.employeeId);
  if (!Number.isInteger(nextEmployeeId) || nextEmployeeId <= 0) {
    return res.status(400).json({ code: 1, message: '薪资人员必须关联OA员工' });
  }
  const oaEmployee = await getOaEmployeeById(nextEmployeeId, { includeInactive: true });
  if (!oaEmployee) {
    return res.status(400).json({ code: 1, message: 'OA员工不存在' });
  }

  const nextDueDate = req.body.dueDate === undefined
    ? current.due_date
    : (req.body.dueDate ? toDateString(req.body.dueDate) : null);

  await run(
    `UPDATE fin_salaries
     SET period_month = ?, employee_id = ?, employee_name = ?, department = ?, position_title = ?, base_salary = ?, performance_bonus = ?, allowance = ?,
         deduction = ?, employer_cost = ?, amount = ?, due_date = ?, status = ?, owner = ?, notes = ?
     WHERE id = ?`,
    [
      req.body.periodMonth === undefined ? current.period_month : normalizePeriodMonth(req.body.periodMonth),
      nextEmployeeId,
      String(oaEmployee.name || '').trim().slice(0, 64),
      String(oaEmployee.department || '').trim().slice(0, 64),
      String(oaEmployee.position || '').trim().slice(0, 64) || null,
      toAmount(nextBase),
      toAmount(nextBonus),
      toAmount(nextAllowance),
      toAmount(nextDeduction),
      toAmount(nextEmployerCost),
      nextAmount,
      nextDueDate,
      calcCostStatus(nextAmount, current.paid_amount, nextDueDate),
      req.body.owner === undefined ? current.owner : (req.body.owner ? String(req.body.owner).trim().slice(0, 64) : null),
      req.body.notes === undefined ? current.notes : (req.body.notes || null),
      id
    ]
  );

  const data = await getSalaryDetailById(id);
  res.json({ code: 0, message: '薪资单更新成功', data });
}));

app.get('/api/salaries/:id/payments', asyncHandler(async (req, res) => {
  await ensureBudgetCostTables();
  const id = Number(req.params.id);
  const salary = await getOne('SELECT * FROM fin_salaries WHERE id = ?', [id]);
  if (!salary) {
    return res.status(404).json({ code: 1, message: '薪资单不存在' });
  }

  const data = await getAll(
    `SELECT sp.*, ca.account_name
     FROM fin_salary_payment_records sp
     JOIN fin_cash_accounts ca ON ca.id = sp.account_id
     WHERE sp.salary_id = ?
     ORDER BY sp.id DESC`,
    [id]
  );
  res.json({ code: 0, data });
}));

app.post('/api/salaries/:id/payments', asyncHandler(async (req, res) => {
  await ensureBudgetCostTables();
  const id = Number(req.params.id);
  const { paidAmount, paidDate, method, accountId, notes } = req.body;
  const amount = toAmount(paidAmount);

  if (!accountId || amount <= 0 || !paidDate) {
    return res.status(400).json({ code: 1, message: '发薪金额、发薪日期、付款账户必填' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [sRows] = await conn.execute('SELECT * FROM fin_salaries WHERE id = ? FOR UPDATE', [id]);
    const salary = sRows[0];
    if (!salary) {
      await conn.rollback();
      return res.status(404).json({ code: 1, message: '薪资单不存在' });
    }

    const remain = toAmount(salary.amount) - toAmount(salary.paid_amount);
    if (remain <= 0) {
      await conn.rollback();
      return res.status(400).json({ code: 1, message: '该薪资单已发放完成' });
    }
    if (amount > remain) {
      await conn.rollback();
      return res.status(400).json({ code: 1, message: `发薪金额不能超过未发金额（${remain}）` });
    }

    const [aRows] = await conn.execute('SELECT * FROM fin_cash_accounts WHERE id = ? FOR UPDATE', [Number(accountId)]);
    const account = aRows[0];
    if (!account || account.status !== 'active') {
      await conn.rollback();
      return res.status(400).json({ code: 1, message: '付款账户不存在或不可用' });
    }
    if (toAmount(account.balance) < amount) {
      await conn.rollback();
      return res.status(400).json({ code: 1, message: '账户余额不足，无法发薪' });
    }

    await conn.execute(
      `INSERT INTO fin_salary_payment_records (salary_id, account_id, paid_amount, paid_date, method, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, Number(accountId), amount, paidDate, method || 'bank_transfer', notes || null]
    );

    const nextPaid = toAmount(salary.paid_amount) + amount;
    await conn.execute(
      `UPDATE fin_salaries
       SET paid_amount = ?, status = ?
       WHERE id = ?`,
      [nextPaid, calcCostStatus(salary.amount, nextPaid, salary.due_date), id]
    );
    await conn.execute('UPDATE fin_cash_accounts SET balance = balance - ? WHERE id = ?', [amount, Number(accountId)]);

    await conn.commit();
    const data = await getSalaryDetailById(id);
    res.json({ code: 0, message: '发薪登记成功', data });
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}));

const getAiExpenseDetailById = async (id) => getOne(
  `SELECT a.*, v.name AS vendor_name,
          (a.amount - a.paid_amount) AS remain_amount
   FROM fin_ai_expenses a
   LEFT JOIN fin_vendors v ON v.id = a.vendor_id
   WHERE a.id = ?`,
  [id]
);

app.get('/api/ai-expenses', asyncHandler(async (req, res) => {
  await ensureBudgetCostTables();
  await refreshAgingStatus();

  const { status, provider, serviceType, period, keyword, updatedAfter } = req.query;
  const params = [];
  let sql = `SELECT a.*, v.name AS vendor_name,
                    (a.amount - a.paid_amount) AS remain_amount
             FROM fin_ai_expenses a
             LEFT JOIN fin_vendors v ON v.id = a.vendor_id
             WHERE 1=1`;

  if (status) {
    sql += ' AND a.status = ?';
    params.push(status);
  }
  if (provider) {
    sql += ' AND a.provider_name = ?';
    params.push(String(provider).trim());
  }
  if (serviceType) {
    sql += ' AND a.service_type = ?';
    params.push(String(serviceType).trim());
  }
  if (period) {
    const periodNorm = normalizePeriodMonth(period).slice(0, 7);
    sql += " AND DATE_FORMAT(a.period_month, '%Y-%m') = ?";
    params.push(periodNorm);
  }
  if (keyword) {
    const kw = `%${String(keyword).trim()}%`;
    sql += ' AND (a.expense_no LIKE ? OR a.provider_name LIKE ? OR a.model_name LIKE ? OR a.owner LIKE ? OR a.notes LIKE ? OR v.name LIKE ?)';
    params.push(kw, kw, kw, kw, kw, kw);
  }
  if (updatedAfter) {
    const at = normalizeDateTimeInput(updatedAfter);
    if (!at) {
      return res.status(400).json({ code: 1, message: 'updatedAfter 格式错误，需 YYYY-MM-DD 或 YYYY-MM-DD HH:mm[:ss]' });
    }
    sql += ' AND a.created_at >= ?';
    params.push(at);
  }

  sql += ' ORDER BY a.period_month DESC, a.id DESC';
  const data = await getAll(sql, params);
  res.json({ code: 0, data });
}));

app.post('/api/ai-expenses', asyncHandler(async (req, res) => {
  await ensureBudgetCostTables();
  const {
    expenseNo,
    periodMonth,
    providerName,
    serviceType,
    modelName,
    usageQty,
    usageUnit,
    unitPrice,
    amount,
    dueDate,
    vendorId,
    owner,
    notes
  } = req.body;

  if (!providerName || !String(providerName).trim()) {
    return res.status(400).json({ code: 1, message: 'AI费用供应商必填' });
  }

  const nextVendorId = vendorId ? Number(vendorId) : null;
  if (nextVendorId) {
    const vendor = await ensureVendor(nextVendorId);
    if (!vendor) {
      return res.status(400).json({ code: 1, message: '供应商不存在或不可用' });
    }
  }

  const totalAmount = calcAiExpenseAmount({ amount, usageQty, unitPrice });
  if (totalAmount <= 0) {
    return res.status(400).json({ code: 1, message: 'AI费用金额必须大于0' });
  }

  const nextExpenseNo = normalizeBillNo(
    expenseNo,
    `AI-${new Date().toISOString().slice(0, 7).replace('-', '')}-${Date.now().toString().slice(-3)}`
  );
  const nextDueDate = dueDate ? toDateString(dueDate) : addDays(normalizePeriodMonth(periodMonth), 5);

  try {
    const result = await run(
      `INSERT INTO fin_ai_expenses
       (expense_no, period_month, provider_name, service_type, model_name, usage_qty, usage_unit, unit_price, amount, paid_amount, due_date, status, vendor_id, owner, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
      [
        nextExpenseNo,
        normalizePeriodMonth(periodMonth),
        String(providerName).trim().slice(0, 64),
        String(serviceType || 'llm_api').trim().slice(0, 32) || 'llm_api',
        modelName ? String(modelName).trim().slice(0, 64) : null,
        Number(usageQty || 0),
        String(usageUnit || 'k_token').trim().slice(0, 24) || 'k_token',
        Number(unitPrice || 0),
        totalAmount,
        nextDueDate,
        calcCostStatus(totalAmount, 0, nextDueDate),
        nextVendorId,
        owner ? String(owner).trim().slice(0, 64) : null,
        notes || null
      ]
    );
    const data = await getAiExpenseDetailById(result.insertId);
    res.json({ code: 0, message: 'AI费用单创建成功', data });
  } catch (error) {
    if (error && error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ code: 1, message: 'AI费用单号已存在' });
    }
    throw error;
  }
}));

app.put('/api/ai-expenses/:id', asyncHandler(async (req, res) => {
  await ensureBudgetCostTables();
  const id = Number(req.params.id);
  const current = await getOne('SELECT * FROM fin_ai_expenses WHERE id = ?', [id]);
  if (!current) {
    return res.status(404).json({ code: 1, message: 'AI费用单不存在' });
  }

  const nextVendorId = req.body.vendorId === undefined
    ? current.vendor_id
    : (req.body.vendorId ? Number(req.body.vendorId) : null);
  if (nextVendorId) {
    const vendor = await ensureVendor(nextVendorId);
    if (!vendor) {
      return res.status(400).json({ code: 1, message: '供应商不存在或不可用' });
    }
  }

  const nextUsageQty = req.body.usageQty === undefined ? current.usage_qty : req.body.usageQty;
  const nextUnitPrice = req.body.unitPrice === undefined ? current.unit_price : req.body.unitPrice;
  const nextAmount = calcAiExpenseAmount({
    amount: req.body.amount === undefined ? current.amount : req.body.amount,
    usageQty: nextUsageQty,
    unitPrice: nextUnitPrice
  });

  if (nextAmount <= 0) {
    return res.status(400).json({ code: 1, message: 'AI费用金额必须大于0' });
  }
  if (nextAmount < toAmount(current.paid_amount)) {
    return res.status(400).json({ code: 1, message: 'AI费用金额不能小于已付款金额' });
  }

  const nextDueDate = req.body.dueDate === undefined
    ? current.due_date
    : (req.body.dueDate ? toDateString(req.body.dueDate) : null);

  await run(
    `UPDATE fin_ai_expenses
     SET period_month = ?, provider_name = ?, service_type = ?, model_name = ?, usage_qty = ?, usage_unit = ?, unit_price = ?,
         amount = ?, due_date = ?, status = ?, vendor_id = ?, owner = ?, notes = ?
     WHERE id = ?`,
    [
      req.body.periodMonth === undefined ? current.period_month : normalizePeriodMonth(req.body.periodMonth),
      req.body.providerName === undefined ? current.provider_name : String(req.body.providerName).trim().slice(0, 64),
      req.body.serviceType === undefined ? current.service_type : (String(req.body.serviceType || 'llm_api').trim().slice(0, 32) || 'llm_api'),
      req.body.modelName === undefined ? current.model_name : (req.body.modelName ? String(req.body.modelName).trim().slice(0, 64) : null),
      Number(nextUsageQty || 0),
      req.body.usageUnit === undefined ? current.usage_unit : (String(req.body.usageUnit || 'k_token').trim().slice(0, 24) || 'k_token'),
      Number(nextUnitPrice || 0),
      nextAmount,
      nextDueDate,
      calcCostStatus(nextAmount, current.paid_amount, nextDueDate),
      nextVendorId,
      req.body.owner === undefined ? current.owner : (req.body.owner ? String(req.body.owner).trim().slice(0, 64) : null),
      req.body.notes === undefined ? current.notes : (req.body.notes || null),
      id
    ]
  );

  const data = await getAiExpenseDetailById(id);
  res.json({ code: 0, message: 'AI费用单更新成功', data });
}));

app.get('/api/ai-expenses/:id/payments', asyncHandler(async (req, res) => {
  await ensureBudgetCostTables();
  const id = Number(req.params.id);
  const aiExpense = await getOne('SELECT * FROM fin_ai_expenses WHERE id = ?', [id]);
  if (!aiExpense) {
    return res.status(404).json({ code: 1, message: 'AI费用单不存在' });
  }

  const data = await getAll(
    `SELECT ap.*, ca.account_name
     FROM fin_ai_payment_records ap
     JOIN fin_cash_accounts ca ON ca.id = ap.account_id
     WHERE ap.ai_expense_id = ?
     ORDER BY ap.id DESC`,
    [id]
  );
  res.json({ code: 0, data });
}));

app.post('/api/ai-expenses/:id/payments', asyncHandler(async (req, res) => {
  await ensureBudgetCostTables();
  const id = Number(req.params.id);
  const { paidAmount, paidDate, method, accountId, notes } = req.body;
  const amount = toAmount(paidAmount);

  if (!accountId || amount <= 0 || !paidDate) {
    return res.status(400).json({ code: 1, message: '付款金额、付款日期、付款账户必填' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [aExpenseRows] = await conn.execute('SELECT * FROM fin_ai_expenses WHERE id = ? FOR UPDATE', [id]);
    const aiExpense = aExpenseRows[0];
    if (!aiExpense) {
      await conn.rollback();
      return res.status(404).json({ code: 1, message: 'AI费用单不存在' });
    }

    const remain = toAmount(aiExpense.amount) - toAmount(aiExpense.paid_amount);
    if (remain <= 0) {
      await conn.rollback();
      return res.status(400).json({ code: 1, message: '该AI费用单已支付完成' });
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
      `INSERT INTO fin_ai_payment_records (ai_expense_id, account_id, paid_amount, paid_date, method, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, Number(accountId), amount, paidDate, method || 'bank_transfer', notes || null]
    );

    const nextPaid = toAmount(aiExpense.paid_amount) + amount;
    await conn.execute(
      `UPDATE fin_ai_expenses
       SET paid_amount = ?, status = ?
       WHERE id = ?`,
      [nextPaid, calcCostStatus(aiExpense.amount, nextPaid, aiExpense.due_date), id]
    );
    await conn.execute('UPDATE fin_cash_accounts SET balance = balance - ? WHERE id = ?', [amount, Number(accountId)]);

    await conn.commit();
    const data = await getAiExpenseDetailById(id);
    res.json({ code: 0, message: 'AI费用付款登记成功', data });
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}));

app.use('/api/expenses', (req, res) => {
  res.status(410).json({ code: 1, message: '报销申请与审批已下线，请使用预算管理与成本管理模块' });
});

app.post('/api/sync/finance-auto', asyncHandler(async (req, res) => {
  const scope = String(req.body.scope || 'all').trim();
  if (!['all', 'crm', 'erp'].includes(scope)) {
    return res.status(400).json({ code: 1, message: 'scope 仅支持 all / crm / erp' });
  }

  const data = await syncFinanceAuto(scope);
  res.json({ code: 0, message: '联动同步完成', data });
}));

app.post('/api/sync/salary-oa', asyncHandler(async (req, res) => {
  const createMissing = req.body.createMissing !== false;
  const periodMonth = req.body.periodMonth;
  const data = await ensureSalaryLedgerSyncedWithOa({ force: true, createMissing, periodMonth });
  res.json({ code: 0, message: '薪资台账与OA员工同步完成', data });
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
    await ensureSyncProgressColumns();
    await ensureBudgetCostTables();
    await getOne('SELECT 1 AS ok');
    console.log(`🗄️ FIN 已连接 MySQL: ${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`);
  } catch (error) {
    console.error('❌ FIN MySQL 连接失败:', error.message);
  }
  console.log(`💰 FIN API 已启动: http://0.0.0.0:${PORT}`);
  console.log(`📈 Dashboard: http://0.0.0.0:${PORT}/api/dashboard`);
});
