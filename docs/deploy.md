# cnnbgptFIN 部署说明

## 1. 前置条件
- Node.js 18+
- MySQL 8+
- 可访问 CRM/ERP 数据库（若启用自动联动）

## 2. 初始化
```bash
cp .env.example .env
cd server
npm install
cd ..
```

## 3. 启动方式
### 本地开发
```bash
./start-fin.sh
```

### 指定参数启动（命令行优先）
```bash
INIT_DB_ON_START=0 API_PORT=3301 PORTAL_PORT=5301 ADMIN_PORT=5302 ./start-fin.sh
```

## 4. 联动配置建议
如果 FIN 与 CRM/ERP 在同一数据库实例，可只改库名：
- `CRM_DB_NAME=cnnbgptCRM`
- `ERP_DB_NAME=cnnbgptERP`

如果不在同一实例，请分别配置 `CRM_DB_HOST`、`ERP_DB_HOST` 等变量。

## 5. 发布检查清单
- `GET /api/health` 返回 `{ code: 0 }`
- `GET /api/dashboard` 可返回数据
- Admin 页面可正常创建应收/应付/预算/成本/薪资/AI费用
- `POST /api/sync/finance-auto` 执行成功

## 6. 备份建议
- 至少每日备份 FIN 库
- 与 CRM/ERP 同步任务前后建议做一次快照备份

## 7. 故障回滚
- 停止服务
- 回滚到最近可用 SQL 备份
- `INIT_DB_ON_START=0` 重新启动验证
