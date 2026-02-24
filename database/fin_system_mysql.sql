CREATE DATABASE IF NOT EXISTS `cnnbgptFIN`
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
USE `cnnbgptFIN`;

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS `fin_ai_payment_records`;
DROP TABLE IF EXISTS `fin_salary_payment_records`;
DROP TABLE IF EXISTS `fin_payment_records`;
DROP TABLE IF EXISTS `fin_receipt_records`;
DROP TABLE IF EXISTS `fin_cost_payment_records`;
DROP TABLE IF EXISTS `fin_ai_expenses`;
DROP TABLE IF EXISTS `fin_salaries`;
DROP TABLE IF EXISTS `fin_costs`;
DROP TABLE IF EXISTS `fin_budgets`;
DROP TABLE IF EXISTS `fin_payables`;
DROP TABLE IF EXISTS `fin_receivables`;
DROP TABLE IF EXISTS `fin_cash_accounts`;
DROP TABLE IF EXISTS `fin_vendors`;
DROP TABLE IF EXISTS `fin_customers`;
SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE `fin_customers` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(128) NOT NULL,
  `customer_type` VARCHAR(16) NOT NULL DEFAULT 'tob',
  `contact_person` VARCHAR(64) DEFAULT NULL,
  `phone` VARCHAR(32) DEFAULT NULL,
  `industry` VARCHAR(64) DEFAULT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_fin_customers_name` (`name`),
  KEY `idx_fin_customers_type` (`customer_type`)
) ENGINE=InnoDB;

CREATE TABLE `fin_vendors` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(128) NOT NULL,
  `category` VARCHAR(32) NOT NULL DEFAULT 'service',
  `contact_person` VARCHAR(64) DEFAULT NULL,
  `phone` VARCHAR(32) DEFAULT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_fin_vendors_name` (`name`)
) ENGINE=InnoDB;

CREATE TABLE `fin_cash_accounts` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `account_name` VARCHAR(64) NOT NULL,
  `bank_name` VARCHAR(64) DEFAULT NULL,
  `account_no` VARCHAR(64) DEFAULT NULL,
  `currency` VARCHAR(8) NOT NULL DEFAULT 'CNY',
  `balance` DECIMAL(14,2) NOT NULL DEFAULT 0,
  `status` VARCHAR(20) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_fin_cash_account_name` (`account_name`)
) ENGINE=InnoDB;

CREATE TABLE `fin_receivables` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `bill_no` VARCHAR(32) NOT NULL,
  `customer_id` INT UNSIGNED NOT NULL,
  `biz_type` VARCHAR(16) NOT NULL DEFAULT 'tob',
  `product_name` VARCHAR(128) DEFAULT NULL,
  `source_ref` VARCHAR(64) DEFAULT NULL,
  `amount_due` DECIMAL(12,2) NOT NULL,
  `amount_received` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `due_date` DATE NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'open',
  `source_progress_ratio` DECIMAL(5,2) NOT NULL DEFAULT 0,
  `source_progress_status` VARCHAR(24) NOT NULL DEFAULT 'unknown',
  `status_strategy` VARCHAR(32) NOT NULL DEFAULT 'standard',
  `owner` VARCHAR(64) DEFAULT NULL,
  `notes` TEXT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_fin_receivable_bill_no` (`bill_no`),
  KEY `idx_fin_receivable_customer` (`customer_id`),
  KEY `idx_fin_receivable_status` (`status`),
  CONSTRAINT `fk_fin_receivable_customer` FOREIGN KEY (`customer_id`) REFERENCES `fin_customers` (`id`)
) ENGINE=InnoDB;

CREATE TABLE `fin_payables` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `bill_no` VARCHAR(32) NOT NULL,
  `vendor_id` INT UNSIGNED NOT NULL,
  `category` VARCHAR(32) NOT NULL DEFAULT 'service',
  `source_ref` VARCHAR(64) DEFAULT NULL,
  `amount_due` DECIMAL(12,2) NOT NULL,
  `amount_paid` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `due_date` DATE NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'open',
  `source_progress_ratio` DECIMAL(5,2) NOT NULL DEFAULT 0,
  `source_progress_status` VARCHAR(24) NOT NULL DEFAULT 'unknown',
  `status_strategy` VARCHAR(32) NOT NULL DEFAULT 'standard',
  `owner` VARCHAR(64) DEFAULT NULL,
  `notes` TEXT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_fin_payable_bill_no` (`bill_no`),
  KEY `idx_fin_payable_vendor` (`vendor_id`),
  KEY `idx_fin_payable_status` (`status`),
  CONSTRAINT `fk_fin_payable_vendor` FOREIGN KEY (`vendor_id`) REFERENCES `fin_vendors` (`id`)
) ENGINE=InnoDB;

CREATE TABLE `fin_budgets` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `budget_no` VARCHAR(32) NOT NULL,
  `period_month` DATE NOT NULL,
  `department` VARCHAR(64) NOT NULL,
  `subject` VARCHAR(32) NOT NULL DEFAULT 'operations',
  `budget_amount` DECIMAL(12,2) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'active',
  `owner` VARCHAR(64) DEFAULT NULL,
  `notes` TEXT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_fin_budget_no` (`budget_no`),
  KEY `idx_fin_budget_period` (`period_month`),
  KEY `idx_fin_budget_department` (`department`),
  KEY `idx_fin_budget_status` (`status`)
) ENGINE=InnoDB;

CREATE TABLE `fin_costs` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `cost_no` VARCHAR(32) NOT NULL,
  `department` VARCHAR(64) NOT NULL,
  `cost_type` VARCHAR(32) NOT NULL DEFAULT 'operations',
  `related_business` VARCHAR(64) DEFAULT NULL,
  `vendor_id` INT UNSIGNED DEFAULT NULL,
  `amount` DECIMAL(12,2) NOT NULL,
  `paid_amount` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `cost_date` DATE NOT NULL,
  `due_date` DATE DEFAULT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'open',
  `owner` VARCHAR(64) DEFAULT NULL,
  `notes` TEXT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_fin_cost_no` (`cost_no`),
  KEY `idx_fin_cost_date` (`cost_date`),
  KEY `idx_fin_cost_department` (`department`),
  KEY `idx_fin_cost_status` (`status`),
  KEY `idx_fin_cost_vendor` (`vendor_id`),
  CONSTRAINT `fk_fin_cost_vendor` FOREIGN KEY (`vendor_id`) REFERENCES `fin_vendors` (`id`)
) ENGINE=InnoDB;

CREATE TABLE `fin_cost_payment_records` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `cost_id` INT UNSIGNED NOT NULL,
  `account_id` INT UNSIGNED NOT NULL,
  `paid_amount` DECIMAL(12,2) NOT NULL,
  `paid_date` DATE NOT NULL,
  `method` VARCHAR(20) NOT NULL DEFAULT 'bank_transfer',
  `notes` VARCHAR(255) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_fin_cost_payment_cost` (`cost_id`),
  KEY `idx_fin_cost_payment_account` (`account_id`),
  KEY `idx_fin_cost_payment_date` (`paid_date`),
  CONSTRAINT `fk_fin_cost_payment_cost` FOREIGN KEY (`cost_id`) REFERENCES `fin_costs` (`id`),
  CONSTRAINT `fk_fin_cost_payment_account` FOREIGN KEY (`account_id`) REFERENCES `fin_cash_accounts` (`id`)
) ENGINE=InnoDB;

CREATE TABLE `fin_salaries` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `salary_no` VARCHAR(32) NOT NULL,
  `period_month` DATE NOT NULL,
  `employee_id` INT UNSIGNED DEFAULT NULL,
  `employee_name` VARCHAR(64) NOT NULL,
  `department` VARCHAR(64) NOT NULL,
  `position_title` VARCHAR(64) DEFAULT NULL,
  `base_salary` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `performance_bonus` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `allowance` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `deduction` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `employer_cost` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `amount` DECIMAL(12,2) NOT NULL,
  `paid_amount` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `due_date` DATE DEFAULT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'open',
  `owner` VARCHAR(64) DEFAULT NULL,
  `notes` TEXT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_fin_salary_no` (`salary_no`),
  KEY `idx_fin_salary_period` (`period_month`),
  KEY `idx_fin_salary_employee` (`employee_id`),
  KEY `idx_fin_salary_department` (`department`),
  KEY `idx_fin_salary_status` (`status`)
) ENGINE=InnoDB;

CREATE TABLE `fin_salary_payment_records` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `salary_id` INT UNSIGNED NOT NULL,
  `account_id` INT UNSIGNED NOT NULL,
  `paid_amount` DECIMAL(12,2) NOT NULL,
  `paid_date` DATE NOT NULL,
  `method` VARCHAR(20) NOT NULL DEFAULT 'bank_transfer',
  `notes` VARCHAR(255) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_fin_salary_payment_salary` (`salary_id`),
  KEY `idx_fin_salary_payment_account` (`account_id`),
  KEY `idx_fin_salary_payment_date` (`paid_date`),
  CONSTRAINT `fk_fin_salary_payment_salary` FOREIGN KEY (`salary_id`) REFERENCES `fin_salaries` (`id`),
  CONSTRAINT `fk_fin_salary_payment_account` FOREIGN KEY (`account_id`) REFERENCES `fin_cash_accounts` (`id`)
) ENGINE=InnoDB;

CREATE TABLE `fin_ai_expenses` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `expense_no` VARCHAR(32) NOT NULL,
  `period_month` DATE NOT NULL,
  `provider_name` VARCHAR(64) NOT NULL,
  `service_type` VARCHAR(32) NOT NULL DEFAULT 'llm_api',
  `model_name` VARCHAR(64) DEFAULT NULL,
  `usage_qty` DECIMAL(18,4) NOT NULL DEFAULT 0,
  `usage_unit` VARCHAR(24) NOT NULL DEFAULT 'k_token',
  `unit_price` DECIMAL(12,6) NOT NULL DEFAULT 0,
  `amount` DECIMAL(12,2) NOT NULL,
  `paid_amount` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `due_date` DATE DEFAULT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'open',
  `vendor_id` INT UNSIGNED DEFAULT NULL,
  `owner` VARCHAR(64) DEFAULT NULL,
  `notes` TEXT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_fin_ai_expense_no` (`expense_no`),
  KEY `idx_fin_ai_period` (`period_month`),
  KEY `idx_fin_ai_status` (`status`),
  KEY `idx_fin_ai_provider` (`provider_name`),
  KEY `idx_fin_ai_vendor` (`vendor_id`),
  CONSTRAINT `fk_fin_ai_vendor` FOREIGN KEY (`vendor_id`) REFERENCES `fin_vendors` (`id`)
) ENGINE=InnoDB;

CREATE TABLE `fin_ai_payment_records` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `ai_expense_id` INT UNSIGNED NOT NULL,
  `account_id` INT UNSIGNED NOT NULL,
  `paid_amount` DECIMAL(12,2) NOT NULL,
  `paid_date` DATE NOT NULL,
  `method` VARCHAR(20) NOT NULL DEFAULT 'bank_transfer',
  `notes` VARCHAR(255) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_fin_ai_payment_expense` (`ai_expense_id`),
  KEY `idx_fin_ai_payment_account` (`account_id`),
  KEY `idx_fin_ai_payment_date` (`paid_date`),
  CONSTRAINT `fk_fin_ai_payment_expense` FOREIGN KEY (`ai_expense_id`) REFERENCES `fin_ai_expenses` (`id`),
  CONSTRAINT `fk_fin_ai_payment_account` FOREIGN KEY (`account_id`) REFERENCES `fin_cash_accounts` (`id`)
) ENGINE=InnoDB;

CREATE TABLE `fin_receipt_records` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `receivable_id` INT UNSIGNED NOT NULL,
  `account_id` INT UNSIGNED NOT NULL,
  `received_amount` DECIMAL(12,2) NOT NULL,
  `received_date` DATE NOT NULL,
  `method` VARCHAR(20) NOT NULL DEFAULT 'bank_transfer',
  `notes` VARCHAR(255) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_fin_receipt_receivable` (`receivable_id`),
  KEY `idx_fin_receipt_account` (`account_id`),
  KEY `idx_fin_receipt_date` (`received_date`),
  CONSTRAINT `fk_fin_receipt_receivable` FOREIGN KEY (`receivable_id`) REFERENCES `fin_receivables` (`id`),
  CONSTRAINT `fk_fin_receipt_account` FOREIGN KEY (`account_id`) REFERENCES `fin_cash_accounts` (`id`)
) ENGINE=InnoDB;

CREATE TABLE `fin_payment_records` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `payable_id` INT UNSIGNED NOT NULL,
  `account_id` INT UNSIGNED NOT NULL,
  `paid_amount` DECIMAL(12,2) NOT NULL,
  `paid_date` DATE NOT NULL,
  `method` VARCHAR(20) NOT NULL DEFAULT 'bank_transfer',
  `notes` VARCHAR(255) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_fin_payment_payable` (`payable_id`),
  KEY `idx_fin_payment_account` (`account_id`),
  KEY `idx_fin_payment_date` (`paid_date`),
  CONSTRAINT `fk_fin_payment_payable` FOREIGN KEY (`payable_id`) REFERENCES `fin_payables` (`id`),
  CONSTRAINT `fk_fin_payment_account` FOREIGN KEY (`account_id`) REFERENCES `fin_cash_accounts` (`id`)
) ENGINE=InnoDB;

INSERT INTO `fin_customers` (`name`, `customer_type`, `contact_person`, `phone`, `industry`) VALUES
  ('华东智造集团', 'tob', '陈总', '13910000001', '智能制造'),
  ('星河传媒有限公司', 'tob', '刘经理', '13910000002', '文化传媒'),
  ('南城商业运营集团', 'tob', '唐总监', '13910000008', '商业地产'),
  ('张先生', 'toc', '张先生', '13910000003', '个人用户'),
  ('王女士', 'toc', '王女士', '13910000004', '个人用户');

INSERT INTO `fin_vendors` (`name`, `category`, `contact_person`, `phone`) VALUES
  ('智联硬件供应链', 'hardware', '宋工', '13811000011'),
  ('深算云服务有限公司', 'cloud', '杜经理', '13811000012'),
  ('蓝图外包设计工作室', 'design', '邓老师', '13811000013'),
  ('鹏程实施服务有限公司', 'implementation', '马工', '13811000014'),
  ('远见企业咨询中心', 'consulting', '郭顾问', '13811000015'),
  ('OpenAI API Platform', 'ai_service', 'API Billing', '13811000016'),
  ('火山引擎方舟', 'ai_service', '方舟商务', '13811000017');

INSERT INTO `fin_cash_accounts` (`account_name`, `bank_name`, `account_no`, `currency`, `balance`) VALUES
  ('工行基本户', '中国工商银行深圳高新支行', '4400-1023-8899', 'CNY', 1250000.00),
  ('招行运营户', '招商银行南山科技园支行', '7550-8821-3301', 'CNY', 680000.00),
  ('支付宝企业账户', '支付宝', 'PAROS-ALIPAY-01', 'CNY', 120000.00);

INSERT INTO `fin_receivables` (`bill_no`, `customer_id`, `biz_type`, `product_name`, `source_ref`, `amount_due`, `amount_received`, `due_date`, `status`, `owner`, `notes`) VALUES
  ('AR-202602-001', 1, 'tob', 'AI老板机 + 实施服务', 'CRM-ORD-001', 596000.00, 198000.00, DATE_ADD(CURDATE(), INTERVAL 18 DAY), 'partial', '周九', '总部与两家分公司分期部署，二期验收后回款。'),
  ('AR-202602-002', 2, 'tob', 'AI看片机内容质检项目', 'CRM-ORD-005', 256000.00, 0.00, DATE_ADD(CURDATE(), INTERVAL 7 DAY), 'open', '孙八', '合同已签，等待客户首付款流程。'),
  ('AR-202602-003', 4, 'toc', 'AI养老机家庭套装', 'CRM-ORD-009', 16800.00, 16800.00, DATE_SUB(CURDATE(), INTERVAL 3 DAY), 'received', '周九', '一次性全款。');

INSERT INTO `fin_receipt_records` (`receivable_id`, `account_id`, `received_amount`, `received_date`, `method`, `notes`) VALUES
  (1, 1, 198000.00, DATE_SUB(CURDATE(), INTERVAL 12 DAY), 'bank_transfer', '项目首付款'),
  (3, 3, 16800.00, DATE_SUB(CURDATE(), INTERVAL 5 DAY), 'online', '线上支付全款');

INSERT INTO `fin_payables` (`bill_no`, `vendor_id`, `category`, `source_ref`, `amount_due`, `amount_paid`, `due_date`, `status`, `owner`, `notes`) VALUES
  ('AP-202602-001', 1, 'hardware', 'ERP-PO-1008', 320000.00, 120000.00, DATE_ADD(CURDATE(), INTERVAL 10 DAY), 'partial', '李七', 'AI审核机边缘计算设备批次采购。'),
  ('AP-202602-002', 2, 'cloud', 'ERP-PO-1011', 85000.00, 0.00, DATE_ADD(CURDATE(), INTERVAL 5 DAY), 'open', '李七', '云资源月账单待支付。'),
  ('AP-202602-003', 3, 'design', 'ERP-PO-1006', 48000.00, 48000.00, DATE_SUB(CURDATE(), INTERVAL 4 DAY), 'paid', '孙八', '品牌与交付文档视觉设计外包。');

INSERT INTO `fin_payment_records` (`payable_id`, `account_id`, `paid_amount`, `paid_date`, `method`, `notes`) VALUES
  (1, 2, 120000.00, DATE_SUB(CURDATE(), INTERVAL 8 DAY), 'bank_transfer', '采购预付款'),
  (3, 1, 48000.00, DATE_SUB(CURDATE(), INTERVAL 6 DAY), 'bank_transfer', '设计外包结算');

INSERT INTO `fin_budgets` (`budget_no`, `period_month`, `department`, `subject`, `budget_amount`, `status`, `owner`, `notes`) VALUES
  ('BG-202602-001', DATE_FORMAT(CURDATE(), '%Y-%m-01'), '咨询事业部', 'consulting', 160000.00, 'active', '李七', '咨询项目差旅、专家支持与交付活动预算。'),
  ('BG-202602-002', DATE_FORMAT(CURDATE(), '%Y-%m-01'), '研发中心', 'rnd', 280000.00, 'active', '周九', '模型迭代、测试样机与算力资源预算。'),
  ('BG-202602-003', DATE_FORMAT(CURDATE(), '%Y-%m-01'), '实施交付部', 'implementation', 190000.00, 'active', '孙八', '项目上线实施、驻场与培训预算。'),
  ('BG-202602-004', DATE_FORMAT(CURDATE(), '%Y-%m-01'), '销售中心', 'sales', 110000.00, 'draft', '钱六', '渠道拓展与客户演示活动预算。');

INSERT INTO `fin_costs` (`cost_no`, `department`, `cost_type`, `related_business`, `vendor_id`, `amount`, `paid_amount`, `cost_date`, `due_date`, `status`, `owner`, `notes`) VALUES
  ('CT-202602-001', '研发中心', 'hardware', 'AI看片机样机迭代', 1, 86000.00, 30000.00, DATE_SUB(CURDATE(), INTERVAL 6 DAY), DATE_ADD(CURDATE(), INTERVAL 9 DAY), 'partial', '周九', '样机主板与边缘计算模组采购。'),
  ('CT-202602-002', '咨询事业部', 'travel', '华东智造项目调研', NULL, 12500.00, 12500.00, DATE_SUB(CURDATE(), INTERVAL 10 DAY), DATE_SUB(CURDATE(), INTERVAL 2 DAY), 'paid', '朱剑', '客户访谈差旅与住宿。'),
  ('CT-202602-003', '实施交付部', 'implementation', '南城商业上线支持', 4, 42000.00, 0.00, DATE_SUB(CURDATE(), INTERVAL 2 DAY), DATE_ADD(CURDATE(), INTERVAL 12 DAY), 'open', '孙八', '驻场实施外包费用。'),
  ('CT-202602-004', '销售中心', 'marketing', 'AI老板机巡展活动', NULL, 18000.00, 8000.00, DATE_SUB(CURDATE(), INTERVAL 4 DAY), DATE_ADD(CURDATE(), INTERVAL 8 DAY), 'partial', '钱六', '会场与物料支出。');

INSERT INTO `fin_cost_payment_records` (`cost_id`, `account_id`, `paid_amount`, `paid_date`, `method`, `notes`) VALUES
  (1, 2, 30000.00, DATE_SUB(CURDATE(), INTERVAL 5 DAY), 'bank_transfer', '样机采购首付款'),
  (2, 1, 12500.00, DATE_SUB(CURDATE(), INTERVAL 8 DAY), 'bank_transfer', '调研成本结清'),
  (4, 3, 8000.00, DATE_SUB(CURDATE(), INTERVAL 3 DAY), 'online', '巡展活动预付款');

INSERT INTO `fin_salaries` (`salary_no`, `period_month`, `employee_id`, `employee_name`, `department`, `position_title`, `base_salary`, `performance_bonus`, `allowance`, `deduction`, `employer_cost`, `amount`, `paid_amount`, `due_date`, `status`, `owner`, `notes`) VALUES
  ('SA-202602-001', DATE_FORMAT(CURDATE(), '%Y-%m-01'), 4, '张三', '技术研发部', '技术经理', 28000.00, 6000.00, 1200.00, 800.00, 4500.00, 38900.00, 38900.00, DATE_ADD(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 5 DAY), 'paid', '李七', '研发线核心骨干绩效结算。'),
  ('SA-202602-002', DATE_FORMAT(CURDATE(), '%Y-%m-01'), 10, '周九', '市场营销部', '运营专员', 36000.00, 9000.00, 1800.00, 1200.00, 6600.00, 52200.00, 20000.00, DATE_ADD(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 7 DAY), 'partial', '李七', '含模型平台值班补贴。'),
  ('SA-202602-003', DATE_FORMAT(CURDATE(), '%Y-%m-01'), 9, '孙八', '市场营销部', '市场总监', 22000.00, 5000.00, 900.00, 600.00, 4100.00, 31400.00, 0.00, DATE_ADD(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 8 DAY), 'open', '李七', '项目上线节点绩效待发放。');

INSERT INTO `fin_salary_payment_records` (`salary_id`, `account_id`, `paid_amount`, `paid_date`, `method`, `notes`) VALUES
  (1, 1, 38900.00, DATE_SUB(CURDATE(), INTERVAL 6 DAY), 'bank_transfer', '咨询线工资发放'),
  (2, 2, 20000.00, DATE_SUB(CURDATE(), INTERVAL 4 DAY), 'bank_transfer', '研发线阶段发薪');

INSERT INTO `fin_ai_expenses` (`expense_no`, `period_month`, `provider_name`, `service_type`, `model_name`, `usage_qty`, `usage_unit`, `unit_price`, `amount`, `paid_amount`, `due_date`, `status`, `vendor_id`, `owner`, `notes`) VALUES
  ('AI-202602-001', DATE_FORMAT(CURDATE(), '%Y-%m-01'), 'OpenAI API Platform', 'llm_api', 'gpt-4.1', 18500.0000, 'k_token', 0.620000, 11470.00, 11470.00, DATE_SUB(CURDATE(), INTERVAL 2 DAY), 'paid', 6, '周九', '多模型路由主通道调用账单。'),
  ('AI-202602-002', DATE_FORMAT(CURDATE(), '%Y-%m-01'), '火山引擎方舟', 'inference_gpu', 'doubao-pro-32k', 320.0000, 'gpu_hour', 18.000000, 5760.00, 2000.00, DATE_ADD(CURDATE(), INTERVAL 4 DAY), 'partial', 7, '周九', '推理集群弹性GPU账单。'),
  ('AI-202602-003', DATE_FORMAT(CURDATE(), '%Y-%m-01'), 'DeepSeek 开放平台', 'llm_api', 'deepseek-v3', 24000.0000, 'k_token', 0.280000, 6720.00, 0.00, DATE_ADD(CURDATE(), INTERVAL 9 DAY), 'open', NULL, '周九', '备用模型通道与压测消耗。');

INSERT INTO `fin_ai_payment_records` (`ai_expense_id`, `account_id`, `paid_amount`, `paid_date`, `method`, `notes`) VALUES
  (1, 2, 11470.00, DATE_SUB(CURDATE(), INTERVAL 3 DAY), 'bank_transfer', '主通道API月结'),
  (2, 1, 2000.00, DATE_SUB(CURDATE(), INTERVAL 1 DAY), 'bank_transfer', '推理GPU预付款');
