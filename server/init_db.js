const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const dbConfig = {
  host: process.env.DB_HOST || '192.168.11.19',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'evanevan2025',
  multipleStatements: true,
  charset: 'utf8mb4'
};

const dbName = process.env.DB_NAME || 'cnnbgptFIN';
const sqlPath = path.resolve(__dirname, '../database/fin_system_mysql.sql');

const run = async () => {
  if (!fs.existsSync(sqlPath)) {
    throw new Error(`SQL 文件不存在: ${sqlPath}`);
  }

  const sql = fs.readFileSync(sqlPath, 'utf8')
    .replace(/CREATE DATABASE IF NOT EXISTS `cnnbgptFIN`/g, `CREATE DATABASE IF NOT EXISTS \`${dbName}\``)
    .replace(/USE `cnnbgptFIN`;/g, `USE \`${dbName}\`;`);

  const conn = await mysql.createConnection(dbConfig);
  try {
    await conn.query(sql);
    console.log(`✅ FIN MySQL 初始化完成: ${dbConfig.host}:${dbConfig.port}/${dbName}`);
  } finally {
    await conn.end();
  }
};

run().catch((error) => {
  console.error('❌ FIN MySQL 初始化失败:', error.message);
  process.exit(1);
});
