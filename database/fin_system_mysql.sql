CREATE DATABASE IF NOT EXISTS `cnnbgptFIN`
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
USE `cnnbgptFIN`;

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS `fin_payment_records`;
DROP TABLE IF EXISTS `fin_receipt_records`;
DROP TABLE IF EXISTS `fin_expenses`;
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

CREATE TABLE `fin_expenses` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `expense_no` VARCHAR(32) NOT NULL,
  `department` VARCHAR(64) NOT NULL,
  `applicant` VARCHAR(64) NOT NULL,
  `category` VARCHAR(32) NOT NULL DEFAULT 'other',
  `related_business` VARCHAR(64) DEFAULT NULL,
  `amount` DECIMAL(12,2) NOT NULL,
  `expense_date` DATE NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
  `payment_account_id` INT UNSIGNED DEFAULT NULL,
  `reimbursed_at` DATETIME DEFAULT NULL,
  `notes` TEXT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_fin_expense_no` (`expense_no`),
  KEY `idx_fin_expense_status` (`status`),
  KEY `idx_fin_expense_date` (`expense_date`),
  CONSTRAINT `fk_fin_expense_account` FOREIGN KEY (`payment_account_id`) REFERENCES `fin_cash_accounts` (`id`)
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
  ('远见企业咨询中心', 'consulting', '郭顾问', '13811000015');

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

INSERT INTO `fin_expenses` (`expense_no`, `department`, `applicant`, `category`, `related_business`, `amount`, `expense_date`, `status`, `payment_account_id`, `reimbursed_at`, `notes`) VALUES
  ('EX-202602-001', '咨询事业部', '朱剑', 'travel', '华东智造项目调研', 6800.00, DATE_SUB(CURDATE(), INTERVAL 9 DAY), 'reimbursed', 1, DATE_SUB(CURDATE(), INTERVAL 7 DAY), '差旅交通与住宿。'),
  ('EX-202602-002', '研发中心', '周九', 'equipment', 'AI看片机样机测试', 12800.00, DATE_SUB(CURDATE(), INTERVAL 3 DAY), 'approved', NULL, NULL, '测试设备与配件采购。'),
  ('EX-202602-003', '实施交付部', '孙八', 'meals', '客户上线周支持', 980.00, DATE_SUB(CURDATE(), INTERVAL 1 DAY), 'pending', NULL, NULL, '上线值守餐补。');
