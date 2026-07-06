---
name: database-skill
description: Database query and management skill. Execute SQL queries, analyze data, and generate reports from MySQL, PostgreSQL, and SQLite databases.
description_zh: "数据库查询与管理技能，支持 MySQL/PostgreSQL/SQLite 的 SQL 执行、数据分析和报表生成"
description_en: "Database query and management for MySQL/PostgreSQL/SQLite with SQL execution and reporting"
version: 1.0.0
metadata:
  category: data
  tags:
    - database
    - sql
    - mysql
    - postgresql
    - sqlite
    - analytics
    - reporting
  author: AgentAI Team
  requires:
    bins:
      - python3
    python_packages:
      - pymysql
      - psycopg2-binary
      - sqlite3
  parallelSafe: true
  riskLevel: medium
---

# Database Skill 🗄️

Execute SQL queries and analyze data from various databases.

## Features

- **Multi-database support**: MySQL, PostgreSQL, SQLite
- **SQL execution**: Run SELECT, INSERT, UPDATE, DELETE queries
- **Data analysis**: Automatic statistics and insights
- **Report generation**: Export results to CSV/JSON/Excel
- **Schema inspection**: View table structures and relationships
- **Query optimization**: Basic query performance suggestions

## Use Cases

### 1. Data Query
```
User: "查询最近 30 天的订单数据"
→ database-skill: {
  "connection": "mysql://user:pass@localhost/shop",
  "query": "SELECT * FROM orders WHERE created_at > DATE_SUB(NOW(), INTERVAL 30 DAY)"
}
```

### 2. Data Analysis
```
User: "分析用户增长趋势"
→ database-skill: {
  "connection": "postgresql://user:pass@localhost/app",
  "query": "SELECT DATE(created_at) as date, COUNT(*) as new_users FROM users GROUP BY DATE(created_at) ORDER BY date",
  "analyze": true
}
```

### 3. Report Generation
```
User: "生成销售报表"
→ database-skill: {
  "connection": "sqlite:///data/sales.db",
  "query": "SELECT product, SUM(amount) as total FROM sales GROUP BY product",
  "export": "csv"
}
```

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| connection | string | Yes | Database connection string |
| query | string | Yes | SQL query to execute |
| analyze | boolean | No | Enable automatic analysis (default: false) |
| export | string | No | Export format: csv/json/excel (default: none) |
| limit | number | No | Max rows to return (default: 1000) |

## Connection String Format

- **MySQL**: `mysql://user:password@host:port/database`
- **PostgreSQL**: `postgresql://user:password@host:port/database`
- **SQLite**: `sqlite:///path/to/database.db`

## Safety

- Read-only queries by default for safety
- Write operations require explicit confirmation
- Connection strings are not logged
- Query timeout: 30 seconds

## Examples

### Basic Query
```json
{
  "connection": "sqlite:///example.db",
  "query": "SELECT * FROM users LIMIT 10"
}
```

### With Analysis
```json
{
  "connection": "mysql://root:pass@localhost/mydb",
  "query": "SELECT age, COUNT(*) FROM users GROUP BY age",
  "analyze": true,
  "export": "csv"
}
```

### Schema Inspection
```json
{
  "connection": "postgresql://user:pass@localhost/db",
  "query": "__SCHEMA__"
}
```
