#!/usr/bin/env python3
"""
Database Skill Handler
Execute SQL queries and analyze data from various databases.
"""

import json
import sys
import re
import sqlite3
from urllib.parse import urlparse
from typing import Dict, Any, List, Optional


def parse_connection_string(conn_str: str) -> Dict[str, Any]:
    """Parse database connection string."""
    if conn_str.startswith('sqlite:///'):
        return {'type': 'sqlite', 'path': conn_str[10:]}
    
    # mysql://user:pass@host:port/db
    # postgresql://user:pass@host:port/db
    match = re.match(r'(\w+)://([^:]+):([^@]+)@([^:/]+)(?::(\d+))?/(.+)', conn_str)
    if match:
        return {
            'type': match.group(1),
            'user': match.group(2),
            'password': match.group(3),
            'host': match.group(4),
            'port': int(match.group(5)) if match.group(5) else None,
            'database': match.group(6)
        }
    
    raise ValueError(f"Invalid connection string: {conn_str}")


def execute_sqlite_query(config: Dict, query: str, limit: int = 1000) -> Dict[str, Any]:
    """Execute query on SQLite database."""
    try:
        conn = sqlite3.connect(config['path'])
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        # Add LIMIT if not present
        if 'LIMIT' not in query.upper():
            query = f"{query} LIMIT {limit}"
        
        cursor.execute(query)
        
        # Check if it's a SELECT query
        if query.strip().upper().startswith('SELECT'):
            rows = cursor.fetchall()
            columns = [description[0] for description in cursor.description]
            data = [dict(zip(columns, row)) for row in rows]
            
            return {
                'success': True,
                'rows': len(data),
                'columns': columns,
                'data': data[:limit]
            }
        else:
            conn.commit()
            return {
                'success': True,
                'message': f"Query executed successfully. Rows affected: {cursor.rowcount}"
            }
            
    except Exception as e:
        return {'success': False, 'error': str(e)}
    finally:
        conn.close()


def get_sqlite_schema(config: Dict) -> Dict[str, Any]:
    """Get SQLite database schema."""
    try:
        conn = sqlite3.connect(config['path'])
        cursor = conn.cursor()
        
        # Get all tables
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = [row[0] for row in cursor.fetchall()]
        
        schema = {}
        for table in tables:
            cursor.execute(f"PRAGMA table_info({table})")
            columns = [{'name': row[1], 'type': row[2]} for row in cursor.fetchall()]
            schema[table] = columns
        
        conn.close()
        return {'success': True, 'tables': tables, 'schema': schema}
        
    except Exception as e:
        return {'success': False, 'error': str(e)}


def analyze_data(data: List[Dict], columns: List[str]) -> Dict[str, Any]:
    """Perform basic data analysis."""
    if not data:
        return {'message': 'No data to analyze'}
    
    analysis = {
        'total_rows': len(data),
        'columns_analysis': {}
    }
    
    for col in columns:
        values = [row.get(col) for row in data if row.get(col) is not None]
        
        col_analysis = {
            'non_null_count': len(values),
            'null_count': len(data) - len(values)
        }
        
        # Try numeric analysis
        try:
            numeric_values = [float(v) for v in values if isinstance(v, (int, float, str))]
            if numeric_values:
                col_analysis.update({
                    'type': 'numeric',
                    'min': min(numeric_values),
                    'max': max(numeric_values),
                    'avg': sum(numeric_values) / len(numeric_values)
                })
        except:
            # Treat as categorical
            unique_values = set(str(v) for v in values)
            col_analysis.update({
                'type': 'categorical',
                'unique_values': len(unique_values),
                'sample_values': list(unique_values)[:5]
            })
        
        analysis['columns_analysis'][col] = col_analysis
    
    return analysis


def export_data(data: List[Dict], format_type: str) -> str:
    """Export data to various formats."""
    if format_type == 'json':
        return json.dumps(data, indent=2, ensure_ascii=False)
    
    elif format_type == 'csv':
        if not data:
            return ""
        columns = list(data[0].keys())
        lines = [','.join(columns)]
        for row in data:
            lines.append(','.join(str(row.get(col, '')) for col in columns))
        return '\n'.join(lines)
    
    else:
        raise ValueError(f"Unsupported export format: {format_type}")


def main():
    """Main entry point."""
    try:
        # Read input from stdin
        input_data = json.load(sys.stdin)
        
        connection = input_data.get('connection')
        query = input_data.get('query')
        analyze = input_data.get('analyze', False)
        export_format = input_data.get('export')
        limit = input_data.get('limit', 1000)
        
        if not connection or not query:
            print(json.dumps({
                'success': False,
                'output': 'Missing required parameters: connection and query'
            }))
            return
        
        # Parse connection string
        config = parse_connection_string(connection)
        
        # Handle schema inspection
        if query == '__SCHEMA__':
            if config['type'] == 'sqlite':
                result = get_sqlite_schema(config)
            else:
                result = {'success': False, 'error': 'Schema inspection not yet implemented for this database type'}
            
            print(json.dumps(result))
            return
        
        # Execute query
        if config['type'] == 'sqlite':
            result = execute_sqlite_query(config, query, limit)
        else:
            result = {'success': False, 'error': f"Database type '{config['type']}' not yet implemented. Only SQLite is supported in this version."}
        
        if not result.get('success'):
            print(json.dumps(result))
            return
        
        # Perform analysis if requested
        if analyze and 'data' in result:
            result['analysis'] = analyze_data(result['data'], result.get('columns', []))
        
        # Export if requested
        if export_format and 'data' in result:
            try:
                exported = export_data(result['data'], export_format)
                result['export'] = {
                    'format': export_format,
                    'size': len(exported),
                    'preview': exported[:500] + '...' if len(exported) > 500 else exported
                }
            except Exception as e:
                result['export_error'] = str(e)
        
        # Format output
        output_lines = []
        if 'data' in result:
            output_lines.append(f"Query returned {result['rows']} rows")
            output_lines.append(f"Columns: {', '.join(result.get('columns', []))}")
            
            # Show sample data
            if result['data']:
                output_lines.append("\nSample data (first 5 rows):")
                for i, row in enumerate(result['data'][:5]):
                    output_lines.append(f"  {i+1}. {json.dumps(row, ensure_ascii=False)}")
            
            if 'analysis' in result:
                output_lines.append(f"\nAnalysis: {json.dumps(result['analysis'], indent=2, ensure_ascii=False)}")
            
            if 'export' in result:
                output_lines.append(f"\nExported to {result['export']['format']}: {result['export']['size']} bytes")
                output_lines.append(f"Preview:\n{result['export']['preview']}")
        else:
            output_lines.append(result.get('message', 'Query executed'))
        
        result['output'] = '\n'.join(output_lines)
        print(json.dumps(result))
        
    except Exception as e:
        print(json.dumps({
            'success': False,
            'output': f'Error: {str(e)}'
        }))


if __name__ == '__main__':
    main()
