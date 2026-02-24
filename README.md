# cnnbgptFIN

帕罗思AI事务所财务管理系统（FIN）。

面向科技公司日常财务场景，覆盖：
- 应收管理（开单、回款登记、逾期识别）
- 应付管理（开单、付款登记、余额校验）
- 预算管理（按部门/科目编制、执行率跟踪、超预算识别）
- 成本管理（成本建单、付款登记、状态自动更新）
- 薪资管理（薪资建单、发薪登记、发放进度跟踪）
- AI费用管理（模型/API/GPU等费用建单、付款登记、台账追踪）
- 资金账户管理（余额变动联动）
- 基础资料（客户、供应商）
- CRM/ERP 自动联动（按来源单据自动生成应收/应付骨架）

## 目录结构
- `database/fin_system_mysql.sql`：FIN 数据库结构和演示数据
- `server/server.js`：FIN API
- `server/init_db.js`：数据库初始化脚本
- `client/portal/index.html`：业务前台
- `client/admin/index.html`：管理后台
- `start-fin.sh`：一键启动（API + Portal + Admin）

## 快速启动
```bash
cp .env.example .env
cd server && npm install
cd ..
./start-fin.sh
```

默认地址：
- Portal: `http://localhost:5301/`
- Admin: `http://localhost:5302/`
- API: `http://localhost:3301/`
- Dashboard: `http://localhost:3301/api/dashboard`

## 环境变量
核心变量（`.env`）：
- `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME`
- `API_PORT`（默认 3301）
- `PORTAL_PORT`（默认 5301）
- `ADMIN_PORT`（默认 5302）
- `INIT_DB_ON_START`（`1` 启动时重建库；`0` 跳过）

联动数据源（可选，未配置时默认同主库地址）：
- CRM：`CRM_DB_HOST` `CRM_DB_PORT` `CRM_DB_USER` `CRM_DB_PASSWORD` `CRM_DB_NAME`
- ERP：`ERP_DB_HOST` `ERP_DB_PORT` `ERP_DB_USER` `ERP_DB_PASSWORD` `ERP_DB_NAME`
- OA：`OA_DB_HOST` `OA_DB_PORT` `OA_DB_USER` `OA_DB_PASSWORD` `OA_DB_NAME`

说明：`start-fin.sh` 已实现“命令行环境变量优先于 .env”。

## 关键接口
- 健康检查：`GET /api/health`
- 看板：`GET /api/dashboard`
- 应收：`GET /api/receivables` `POST /api/receivables` `POST /api/receivables/:id/receipts`
- 应付：`GET /api/payables` `POST /api/payables` `POST /api/payables/:id/payments`
- 预算：`GET /api/budgets` `POST /api/budgets` `PUT /api/budgets/:id`
- 成本：`GET /api/costs` `POST /api/costs` `PUT /api/costs/:id` `POST /api/costs/:id/payments`
- OA员工：`GET /api/oa-employees`
- 薪资：`GET /api/salaries` `POST /api/salaries` `PUT /api/salaries/:id` `POST /api/salaries/:id/payments`（新增/编辑必须传 `employeeId`，并映射 OA 员工）
- AI费用：`GET /api/ai-expenses` `POST /api/ai-expenses` `PUT /api/ai-expenses/:id` `POST /api/ai-expenses/:id/payments`
- 资金账户：`GET /api/cash-accounts` `POST /api/cash-accounts` `PUT /api/cash-accounts/:id`
- 流水：`GET /api/receipts` `GET /api/payments`
- 联动同步：`POST /api/sync/finance-auto`
- 薪资/OA同步：`POST /api/sync/salary-oa`（支持按期间自动补齐 OA 在职员工薪资台账骨架，参数：`periodMonth`、`createMissing`）
- 报销接口：`/api/expenses` 已下线（返回 410）

## CRM/ERP 自动联动
后台入口：Admin 首页“业务联动同步”。

同步范围：
- `scope=crm`：仅同步 CRM 订单 -> FIN 应收
- `scope=erp`：仅同步 ERP 销售单/采购单 -> FIN 应收/应付
- `scope=all`：全部同步

示例：
```bash
curl -X POST http://127.0.0.1:3301/api/sync/finance-auto \
  -H 'Content-Type: application/json' \
  -d '{"scope":"all"}'
```

幂等规则：按 `source_ref` 更新，不重复创建。

## 常见问题
1. 启动报端口占用
- 用根目录脚本：`../stop-all.sh`

2. 启动时报 MySQL 连接失败
- 检查 `.env` 的数据库地址和账号
- 确认 `DB_NAME`、`CRM_DB_NAME`、`ERP_DB_NAME` 可访问

3. 同步接口失败
- 检查 CRM/ERP 数据库连接参数
- 确认 CRM/ERP 库中订单表存在且有数据
