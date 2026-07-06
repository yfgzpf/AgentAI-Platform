import sqlite3

conn = sqlite3.connect('test.db')
cursor = conn.cursor()

cursor.execute('''
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        name TEXT,
        age INTEGER
    )
''')

test_users = [
    (1, '张三', 28),
    (2, '李四', 35),
    (3, '王五', 42),
]

cursor.executemany('INSERT OR REPLACE INTO users VALUES (?,?,?)', test_users)
conn.commit()
conn.close()

print('Test database created successfully')
