#!/usr/bin/env python3
"""
Chart Generator Skill
Generate beautiful SVG charts from data
"""

import json
import sys
import math
from typing import List, Dict, Any


def generate_bar_chart(data: Dict, title: str = "", width: int = 680, height: int = 400, 
                       horizontal: bool = False) -> str:
    """Generate SVG bar chart."""
    labels = data.get('labels', [])
    values = data.get('values', [])
    
    if not labels or not values:
        return "<text x='50%' y='50%' text-anchor='middle'>No data</text>"
    
    # Colors
    colors = ['#4A90D9', '#50C878', '#F5A623', '#E85D75', '#9B59B6', 
              '#1ABC9C', '#34495E', '#E74C3C', '#3498DB', '#2ECC71']
    
    # Calculate dimensions
    margin = {'top': 60, 'right': 40, 'bottom': 80, 'left': 80}
    chart_w = width - margin['left'] - margin['right']
    chart_h = height - margin['top'] - margin['bottom']
    
    max_val = max(values) if values else 1
    
    # Generate bars
    bars = []
    if horizontal:
        bar_height = chart_h / len(values) * 0.7
        gap = chart_h / len(values) * 0.3
        
        for i, (label, value) in enumerate(zip(labels, values)):
            bar_w = (value / max_val) * chart_w
            y = margin['top'] + i * (bar_height + gap) + gap/2
            color = colors[i % len(colors)]
            
            bars.append(f'''
                <rect x="{margin['left']}" y="{y}" width="{bar_w}" height="{bar_height}" 
                      fill="{color}" rx="4"/>
                <text x="{margin['left'] - 10}" y="{y + bar_height/2}" 
                      text-anchor="end" font-size="12" fill="#333">{label}</text>
                <text x="{margin['left'] + bar_w + 5}" y="{y + bar_height/2}" 
                      font-size="11" fill="#666">{value}</text>
            ''')
    else:
        bar_width = chart_w / len(values) * 0.7
        gap = chart_w / len(values) * 0.3
        
        for i, (label, value) in enumerate(zip(labels, values)):
            bar_h = (value / max_val) * chart_h
            x = margin['left'] + i * (bar_width + gap) + gap/2
            y = margin['top'] + chart_h - bar_h
            color = colors[i % len(colors)]
            
            bars.append(f'''
                <rect x="{x}" y="{y}" width="{bar_width}" height="{bar_h}" 
                      fill="{color}" rx="4"/>
                <text x="{x + bar_width/2}" y="{y - 5}" 
                      text-anchor="middle" font-size="11" fill="#666">{value}</text>
                <text x="{x + bar_width/2}" y="{height - margin['bottom'] + 20}" 
                      text-anchor="middle" font-size="11" fill="#333" transform="rotate(-30 {x + bar_width/2} {height - margin['bottom'] + 20})">{label}</text>
            ''')
    
    # Y-axis grid lines
    grid_lines = []
    for i in range(6):
        y_val = max_val * i / 5
        y_pos = margin['top'] + chart_h - (y_val / max_val) * chart_h
        grid_lines.append(f'''
            <line x1="{margin['left']}" y1="{y_pos}" x2="{width - margin['right']}" y2="{y_pos}" 
                  stroke="#E0E0E0" stroke-width="1"/>
            <text x="{margin['left'] - 10}" y="{y_pos + 4}" 
                  text-anchor="end" font-size="10" fill="#999">{int(y_val)}</text>
        ''')
    
    svg = f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="100%" height="{height}">
    <rect width="100%" height="100%" fill="#FAFAFA"/>
    <text x="{width/2}" y="30" text-anchor="middle" font-size="16" font-weight="bold" fill="#333">{title}</text>
    {''.join(grid_lines)}
    {''.join(bars)}
    <line x1="{margin['left']}" y1="{margin['top']}" x2="{margin['left']}" y2="{height - margin['bottom']}" stroke="#333" stroke-width="2"/>
    <line x1="{margin['left']}" y1="{height - margin['bottom']}" x2="{width - margin['right']}" y2="{height - margin['bottom']}" stroke="#333" stroke-width="2"/>
</svg>'''
    
    return svg


def generate_line_chart(data: Dict, title: str = "", width: int = 680, height: int = 400) -> str:
    """Generate SVG line chart."""
    labels = data.get('labels', [])
    values = data.get('values', [])
    
    if not labels or not values:
        return "<text x='50%' y='50%' text-anchor='middle'>No data</text>"
    
    margin = {'top': 60, 'right': 40, 'bottom': 80, 'left': 80}
    chart_w = width - margin['left'] - margin['right']
    chart_h = height - margin['top'] - margin['bottom']
    
    max_val = max(values) if values else 1
    min_val = min(values) if values else 0
    val_range = max_val - min_val if max_val != min_val else 1
    
    # Generate points
    points = []
    for i, value in enumerate(values):
        x = margin['left'] + (i / (len(values) - 1)) * chart_w if len(values) > 1 else margin['left'] + chart_w / 2
        y = margin['top'] + chart_h - ((value - min_val) / val_range) * chart_h
        points.append(f"{x},{y}")
    
    # Create polyline
    polyline = f'<polyline points="{" ".join(points)}" fill="none" stroke="#4A90D9" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>'
    
    # Add dots
    dots = []
    for i, (label, value) in enumerate(zip(labels, values)):
        x = margin['left'] + (i / (len(values) - 1)) * chart_w if len(values) > 1 else margin['left'] + chart_w / 2
        y = margin['top'] + chart_h - ((value - min_val) / val_range) * chart_h
        dots.append(f'''
            <circle cx="{x}" cy="{y}" r="5" fill="#4A90D9" stroke="white" stroke-width="2"/>
            <text x="{x}" y="{y - 10}" text-anchor="middle" font-size="10" fill="#333">{value}</text>
            <text x="{x}" y="{height - margin['bottom'] + 20}" text-anchor="middle" font-size="11" fill="#666" transform="rotate(-30 {x} {height - margin['bottom'] + 20})">{label}</text>
        ''')
    
    # Y-axis grid
    grid_lines = []
    for i in range(6):
        y_val = min_val + val_range * i / 5
        y_pos = margin['top'] + chart_h - (y_val - min_val) / val_range * chart_h
        grid_lines.append(f'''
            <line x1="{margin['left']}" y1="{y_pos}" x2="{width - margin['right']}" y2="{y_pos}" stroke="#E0E0E0" stroke-width="1"/>
            <text x="{margin['left'] - 10}" y="{y_pos + 4}" text-anchor="end" font-size="10" fill="#999">{int(y_val)}</text>
        ''')
    
    svg = f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="100%" height="{height}">
    <rect width="100%" height="100%" fill="#FAFAFA"/>
    <text x="{width/2}" y="30" text-anchor="middle" font-size="16" font-weight="bold" fill="#333">{title}</text>
    {''.join(grid_lines)}
    {polyline}
    {''.join(dots)}
    <line x1="{margin['left']}" y1="{margin['top']}" x2="{margin['left']}" y2="{height - margin['bottom']}" stroke="#333" stroke-width="2"/>
    <line x1="{margin['left']}" y1="{height - margin['bottom']}" x2="{width - margin['right']}" y2="{height - margin['bottom']}" stroke="#333" stroke-width="2"/>
</svg>'''
    
    return svg


def generate_pie_chart(data: Dict, title: str = "", width: int = 680, height: int = 400) -> str:
    """Generate SVG pie chart."""
    labels = data.get('labels', [])
    values = data.get('values', [])
    
    if not labels or not values:
        return "<text x='50%' y='50%' text-anchor='middle'>No data</text>"
    
    colors = ['#4A90D9', '#50C878', '#F5A623', '#E85D75', '#9B59B6', 
              '#1ABC9C', '#34495E', '#E74C3C', '#3498DB', '#2ECC71']
    
    total = sum(values)
    center_x = width / 3
    center_y = height / 2
    radius = min(width, height) / 3
    
    # Generate pie slices
    slices = []
    legend = []
    start_angle = 0
    
    for i, (label, value) in enumerate(zip(labels, values)):
        angle = (value / total) * 360
        end_angle = start_angle + angle
        
        # Calculate path
        x1 = center_x + radius * math.cos(math.radians(start_angle))
        y1 = center_y + radius * math.sin(math.radians(start_angle))
        x2 = center_x + radius * math.cos(math.radians(end_angle))
        y2 = center_y + radius * math.sin(math.radians(end_angle))
        
        large_arc = 1 if angle > 180 else 0
        
        path = f"M {center_x} {center_y} L {x1} {y1} A {radius} {radius} 0 {large_arc} 1 {x2} {y2} Z"
        color = colors[i % len(colors)]
        
        slices.append(f'<path d="{path}" fill="{color}" stroke="white" stroke-width="2"/>')
        
        # Legend
        percentage = (value / total) * 100
        legend_y = 80 + i * 25
        legend.append(f'''
            <rect x="{width * 0.65}" y="{legend_y - 10}" width="15" height="15" fill="{color}" rx="2"/>
            <text x="{width * 0.65 + 25}" y="{legend_y + 2}" font-size="12" fill="#333">{label}: {value} ({percentage:.1f}%)</text>
        ''')
        
        start_angle = end_angle
    
    svg = f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="100%" height="{height}">
    <rect width="100%" height="100%" fill="#FAFAFA"/>
    <text x="{width/2}" y="30" text-anchor="middle" font-size="16" font-weight="bold" fill="#333">{title}</text>
    {''.join(slices)}
    {''.join(legend)}
</svg>'''
    
    return svg


def main():
    """Main entry point."""
    try:
        input_data = json.load(sys.stdin)
        
        chart_type = input_data.get('type', 'bar')
        data = input_data.get('data', {})
        title = input_data.get('title', '')
        width = input_data.get('width', 680)
        height = input_data.get('height', 400)
        
        # Parse data from various formats
        if 'labels' not in data or 'values' not in data:
            # Try to parse from raw_data
            raw = input_data.get('raw_data', [])
            if raw:
                if isinstance(raw[0], dict):
                    # List of dicts
                    keys = list(raw[0].keys())
                    if len(keys) >= 2:
                        data['labels'] = [str(r.get(keys[0])) for r in raw]
                        data['values'] = [float(r.get(keys[1], 0)) for r in raw]
                elif isinstance(raw[0], (list, tuple)):
                    # List of tuples
                    data['labels'] = [str(r[0]) for r in raw]
                    data['values'] = [float(r[1]) for r in raw]
        
        if not data.get('labels') or not data.get('values'):
            print(json.dumps({
                'success': False,
                'output': 'Missing data. Provide labels and values, or raw_data.'
            }))
            return
        
        # Generate chart
        if chart_type == 'bar':
            svg = generate_bar_chart(data, title, width, height)
        elif chart_type == 'horizontal-bar':
            svg = generate_bar_chart(data, title, width, height, horizontal=True)
        elif chart_type == 'line':
            svg = generate_line_chart(data, title, width, height)
        elif chart_type == 'pie':
            svg = generate_pie_chart(data, title, width, height)
        else:
            svg = generate_bar_chart(data, title, width, height)
        
        output = f"✅ Generated {chart_type} chart with {len(data['values'])} data points"
        
        print(json.dumps({
            'success': True,
            'output': output,
            'data': {
                '__type': 'widget',
                'title': title or f'{chart_type.title()} Chart',
                'contentType': 'svg',
                'content': svg,
                'width': width,
                'height': height
            }
        }))
        
    except Exception as e:
        print(json.dumps({
            'success': False,
            'output': f'Error: {str(e)}'
        }))


if __name__ == '__main__':
    main()
