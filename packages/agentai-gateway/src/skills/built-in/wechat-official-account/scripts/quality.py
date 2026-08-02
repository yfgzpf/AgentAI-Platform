"""
WeChat Official Account Quality Check Scripts
===============================================
This module provides functions for checking article quality and removing AI fingerprints.
"""

import re
from typing import Dict, List, Any

# AI Fingerprint Words to remove
AI_FINGERPRINT_WORDS = [
    "值得注意的是", "综上所述", "首先", "其次", "最后",
    "需要指出的是", "让我们", "在这个过程中", "总的来说",
    "不难发现", "由此可见", "换句话说", "具体来说",
    "事实上", "本文将", "接下来", "总而言之",
    "毫无疑问", "显而易见", "不言而喻", "众所周知"
]

def check_deai(article_text: str, threshold: int = 3) -> Dict[str, Any]:
    """Check for AI fingerprint words in article."""
    found = []
    for word in AI_FINGERPRINT_WORDS:
        if word in article_text:
            found.append(word)
    
    return {
        "pass": len(found) <= threshold,
        "found": found,
        "count": len(found),
        "threshold": threshold
    }

def quality_gate(article_text: str, config: Dict[str, Any]) -> Dict[str, Any]:
    """Validate article quality against configurable thresholds."""
    results = {}
    
    # Length check
    length = len(article_text)
    results["length"] = {
        "pass": config.get("min_length", 800) <= length <= config.get("max_length", 2000),
        "value": length
    }
    
    # Hook check (first 150 chars must have hook)
    first_150 = article_text[:150]
    has_hook = any([
        "?" in first_150 or "？" in first_150,  # Question mark
        bool(re.search(r'\d+', first_150)),  # Number
        any(w in first_150 for w in ["但", "却", "居然", "竟然", "没想到"])  # Conflict words
    ])
    results["hook"] = {"pass": has_hook}
    
    # Table check
    table_count = article_text.count("|---")
    results["tables"] = {
        "pass": table_count >= config.get("min_tables", 2),
        "value": table_count
    }
    
    # ABCD ending check
    last_500 = article_text[-500:]
    has_abcd = all(f"{letter}." in last_500 or f"{letter}、" in last_500 
                   for letter in ["A", "B", "C", "D"])
    results["abcd_ending"] = {"pass": has_abcd}
    
    # Overall pass
    all_pass = all(r["pass"] for r in results.values())
    return {"pass": all_pass, "details": results}
