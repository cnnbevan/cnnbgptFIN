#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="${ROOT_DIR}/server"
ENV_FILE="${ROOT_DIR}/.env"

FIN_ENV_KEYS=(
  DB_HOST
  DB_PORT
  DB_USER
  DB_PASSWORD
  DB_NAME
  CRM_DB_HOST
  CRM_DB_PORT
  CRM_DB_USER
  CRM_DB_PASSWORD
  CRM_DB_NAME
  ERP_DB_HOST
  ERP_DB_PORT
  ERP_DB_USER
  ERP_DB_PASSWORD
  ERP_DB_NAME
  API_PORT
  PORT
  API_BASE
  PORTAL_BASE
  PORTAL_PORT
  ADMIN_PORT
  BIND_HOST
  INIT_DB_ON_START
)

# 命令行环境变量优先：先记录外部传入值，加载 .env 后再恢复这些值。
for key in "${FIN_ENV_KEYS[@]}"; do
  pre_set_var="__FIN_PRE_SET_${key}"
  pre_val_var="__FIN_PRE_VAL_${key}"
  if [ "${!key+x}" = "x" ]; then
    printf -v "${pre_set_var}" '%s' "1"
    printf -v "${pre_val_var}" '%s' "${!key}"
  else
    printf -v "${pre_set_var}" '%s' "0"
  fi
done

if [ -f "${ENV_FILE}" ]; then
  set -a
  # shellcheck disable=SC1090
  . "${ENV_FILE}"
  set +a
fi

for key in "${FIN_ENV_KEYS[@]}"; do
  pre_set_var="__FIN_PRE_SET_${key}"
  pre_val_var="__FIN_PRE_VAL_${key}"
  if [ "${!pre_set_var}" = "1" ]; then
    export "${key}=${!pre_val_var}"
  fi
done

DB_HOST="${DB_HOST:-192.168.11.19}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-root}"
DB_PASSWORD="${DB_PASSWORD:-evanevan2025}"
DB_NAME="${DB_NAME:-cnnbgptFIN}"
API_PORT="${API_PORT:-${PORT:-3301}}"
API_BASE="${API_BASE:-}"
PORTAL_BASE="${PORTAL_BASE:-}"
PORTAL_PORT="${PORTAL_PORT:-5301}"
ADMIN_PORT="${ADMIN_PORT:-5302}"
BIND_HOST="${BIND_HOST:-0.0.0.0}"
INIT_DB_ON_START="${INIT_DB_ON_START:-1}"

if ! command -v python3 >/dev/null 2>&1; then
  echo "[ERROR] 未检测到 python3，请先安装。"
  exit 1
fi

if [ ! -d "${SERVER_DIR}" ]; then
  echo "[ERROR] 未找到 FIN 后端目录: ${SERVER_DIR}"
  exit 1
fi

if [ ! -d "${SERVER_DIR}/node_modules" ] || [ ! -d "${SERVER_DIR}/node_modules/mysql2" ] || [ ! -d "${SERVER_DIR}/node_modules/dotenv" ]; then
  echo "[INFO] 安装 FIN 后端依赖..."
  (cd "${SERVER_DIR}" && npm install)
fi

cat > "${ROOT_DIR}/client/portal/config.js" <<CONFIG
window.__FIN_CONFIG__ = {
  API_BASE: "${API_BASE}",
  API_PORT: ${API_PORT},
  PORTAL_BASE: "${PORTAL_BASE}"
};
CONFIG

cat > "${ROOT_DIR}/client/admin/config.js" <<CONFIG
window.__FIN_CONFIG__ = {
  API_BASE: "${API_BASE}",
  API_PORT: ${API_PORT},
  PORTAL_BASE: "${PORTAL_BASE}"
};
CONFIG

if [ "${INIT_DB_ON_START}" = "1" ]; then
  echo "[INFO] 初始化 FIN MySQL 数据库..."
  (
    cd "${SERVER_DIR}"
    DB_HOST="${DB_HOST}" DB_PORT="${DB_PORT}" DB_USER="${DB_USER}" DB_PASSWORD="${DB_PASSWORD}" DB_NAME="${DB_NAME}" API_PORT="${API_PORT}" PORT="${API_PORT}" npm run init-db
  )
else
  echo "[INFO] 跳过 FIN 数据库初始化（INIT_DB_ON_START=${INIT_DB_ON_START}）。"
fi

cleanup() {
  set +e
  if [ -n "${API_PID:-}" ]; then
    kill "${API_PID}" >/dev/null 2>&1
  fi
  if [ -n "${PORTAL_PID:-}" ]; then
    kill "${PORTAL_PID}" >/dev/null 2>&1
  fi
  if [ -n "${ADMIN_PID:-}" ]; then
    kill "${ADMIN_PID}" >/dev/null 2>&1
  fi
}
trap cleanup INT TERM EXIT

echo "[INFO] 启动 FIN API..."
(
  cd "${SERVER_DIR}"
  DB_HOST="${DB_HOST}" DB_PORT="${DB_PORT}" DB_USER="${DB_USER}" DB_PASSWORD="${DB_PASSWORD}" DB_NAME="${DB_NAME}" API_PORT="${API_PORT}" PORT="${API_PORT}" npm start
) &
API_PID=$!

echo "[INFO] 启动 FIN Portal 静态服务..."
python3 -m http.server "${PORTAL_PORT}" --bind "${BIND_HOST}" --directory "${ROOT_DIR}/client/portal" &
PORTAL_PID=$!

echo "[INFO] 启动 FIN Admin 静态服务..."
python3 -m http.server "${ADMIN_PORT}" --bind "${BIND_HOST}" --directory "${ROOT_DIR}/client/admin" &
ADMIN_PID=$!

echo "[OK] FIN 已启动"
echo "  Portal: http://localhost:${PORTAL_PORT}/"
echo "  Admin : http://localhost:${ADMIN_PORT}/"
echo "  API   : http://localhost:${API_PORT}/api/dashboard"
echo "  Bind  : ${BIND_HOST}"
echo ""
echo "局域网访问示例："
echo "  http://<你的IP>:${PORTAL_PORT}/"
echo "  http://<你的IP>:${ADMIN_PORT}/"
echo ""
echo "按 Ctrl+C 停止服务。"
wait
