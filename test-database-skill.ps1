# Test database-skill

# Create test database
$testDbPath = "f:\agentai-platform\test.db"

# Create test data using Python
$pythonScript = @"
import sqlite3
import json

# Create test database
conn = sqlite3.connect('$testDbPath')
cursor = conn.cursor()

# Create users table
cursor.execute('''
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        name TEXT,
        email TEXT,
        age INTEGER,
        created_at TEXT
    )
''')

# Insert test data
test_users = [
    (1, '张三', 'zhangsan@example.com', 28, '2024-01-15'),
    (2, '李四', 'lisi@example.com', 35, '2024-02-20'),
    (3, '王五', 'wangwu@example.com', 42, '2024-03-10'),
    (4, '赵六', 'zhaoliu@example.com', 25, '2024-04-05'),
    (5, '钱七', 'qianqi@example.com', 31, '2024-05-12'),
]

cursor.executemany('INSERT OR REPLACE INTO users VALUES (?,?,?,?,?)', test_users)
conn.commit()
conn.close()

print('Test database created successfully')
"@

$pythonScript | python3

# Test 1: Basic query
Write-Host "`n=== Test 1: Basic Query ===" -ForegroundColor Green
$test1 = @{
    connection = "sqlite:///$testDbPath"
    query = "SELECT * FROM users LIMIT 3"
} | ConvertTo-Json

$result1 = $test1 | python3 f:\agentai-platform\packages\agentai-skills\data\database-skill\handler.py
Write-Host $result1

# Test 2: Query with analysis
Write-Host "`n=== Test 2: Query with Analysis ===" -ForegroundColor Green
$test2 = @{
    connection = "sqlite:///$testDbPath"
    query = "SELECT age FROM users"
    analyze = $true
} | ConvertTo-Json

$result2 = $test2 | python3 f:\agentai-platform\packages\agentai-skills\data\database-skill\handler.py
Write-Host $result2

# Test 3: Export to CSV
Write-Host "`n=== Test 3: Export to CSV ===" -ForegroundColor Green
$test3 = @{
    connection = "sqlite:///$testDbPath"
    query = "SELECT * FROM users"
    export = "csv"
} | ConvertTo-Json

$result3 = $test3 | python3 f:\agentai-platform\packages\agentai-skills\data\database-skill\handler.py
Write-Host $result3

# Test 4: Schema inspection
Write-Host "`n=== Test 4: Schema Inspection ===" -ForegroundColor Green
$test4 = @{
    connection = "sqlite:///$testDbPath"
    query = "__SCHEMA__"
} | ConvertTo-Json

$result4 = $test4 | python3 f:\agentai-platform\packages\agentai-skills\data\database-skill\handler.py
Write-Host $result4

Write-Host "`n=== All tests completed ===" -ForegroundColor Cyan
