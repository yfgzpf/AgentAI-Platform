#!/usr/bin/env python3
"""
GitHub Skill Handler
Automate GitHub workflows: issues, PRs, releases, commits
"""

import json
import sys
import os
import re
from urllib.request import Request, urlopen
from urllib.error import HTTPError


def github_api(path: str, method: str = "GET", data: dict = None) -> dict:
    """Call GitHub API."""
    token = os.environ.get('GITHUB_TOKEN')
    if not token:
        return {'success': False, 'error': 'GITHUB_TOKEN not set'}
    
    url = f"https://api.github.com{path}"
    headers = {
        'Authorization': f'token {token}',
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'AgentAI-GitHub-Skill'
    }
    
    try:
        if data:
            import urllib.request
            req = Request(url, method=method, headers=headers)
            req.add_header('Content-Type', 'application/json')
            response = urlopen(req, data=json.dumps(data).encode())
        else:
            req = Request(url, method=method, headers=headers)
            response = urlopen(req)
        
        return {
            'success': True,
            'data': json.loads(response.read().decode())
        }
    except HTTPError as e:
        return {
            'success': False,
            'error': f'HTTP {e.code}: {e.read().decode()[:200]}'
        }
    except Exception as e:
        return {'success': False, 'error': str(e)}


def parse_repo(repo_str: str) -> tuple:
    """Parse owner/repo from string."""
    # Handle full URL or just owner/repo
    if 'github.com' in repo_str:
        match = re.search(r'github\.com/([^/]+)/([^/]+)', repo_str)
        if match:
            return match.group(1), match.group(2).replace('.git', '')
    
    parts = repo_str.split('/')
    if len(parts) == 2:
        return parts[0], parts[1]
    
    # Try to get from git remote
    return None, None


def create_issue(owner: str, repo: str, title: str, body: str = None, 
                 labels: list = None, assignees: list = None) -> dict:
    """Create GitHub Issue."""
    data = {
        'title': title,
        'body': body or '',
    }
    if labels:
        data['labels'] = labels
    if assignees:
        data['assignees'] = assignees
    
    return github_api(f'/repos/{owner}/{repo}/issues', 'POST', data)


def list_issues(owner: str, repo: str, state: str = 'open', limit: int = 10) -> dict:
    """List GitHub Issues."""
    return github_api(f'/repos/{owner}/{repo}/issues?state={state}&per_page={limit}')


def get_pr(owner: str, repo: str, pr_number: int) -> dict:
    """Get PR details."""
    return github_api(f'/repos/{owner}/{repo}/pulls/{pr_number}')


def list_prs(owner: str, repo: str, state: str = 'open', limit: int = 10) -> dict:
    """List open PRs."""
    return github_api(f'/repos/{owner}/{repo}/pulls?state={state}&per_page={limit}')


def get_commits(owner: str, repo: str, branch: str = 'main', limit: int = 10) -> dict:
    """Get recent commits."""
    # Try main first, then master
    result = github_api(f'/repos/{owner}/{repo}/commits?sha={branch}&per_page={limit}')
    if not result['success'] and branch == 'main':
        result = github_api(f'/repos/{owner}/{repo}/commits?sha=master&per_page={limit}')
    return result


def create_release(owner: str, repo: str, tag: str, name: str = None, 
                   body: str = None, draft: bool = True) -> dict:
    """Create GitHub Release."""
    data = {
        'tag_name': tag,
        'name': name or tag,
        'body': body or '',
        'draft': draft,
        'prerelease': False
    }
    return github_api(f'/repos/{owner}/{repo}/releases', 'POST', data)


def generate_changelog(owner: str, repo: str, since_tag: str = None) -> str:
    """Generate changelog from commits."""
    result = get_commits(owner, repo)
    if not result['success']:
        return f"Error: {result.get('error')}"
    
    commits = result['data']
    if not commits:
        return "No commits found"
    
    # Categorize commits
    features = []
    fixes = []
    other = []
    
    for commit in commits:
        msg = commit['commit']['message'].split('\n')[0].lower()
        if any(kw in msg for kw in ['feat', 'feature', 'add', 'new']):
            features.append(commit)
        elif any(kw in msg for kw in ['fix', 'bug', 'repair', 'correct']):
            fixes.append(commit)
        else:
            other.append(commit)
    
    lines = ['## Changelog\n']
    
    if features:
        lines.append('### ✨ Features')
        for c in features[:5]:
            msg = c['commit']['message'].split('\n')[0]
            lines.append(f"- {msg} (@{c['author']['login'] if c['author'] else 'unknown'})")
        lines.append('')
    
    if fixes:
        lines.append('### 🐛 Bug Fixes')
        for c in fixes[:5]:
            msg = c['commit']['message'].split('\n')[0]
            lines.append(f"- {msg} (@{c['author']['login'] if c['author'] else 'unknown'})")
        lines.append('')
    
    if other:
        lines.append('### 📝 Other Changes')
        for c in other[:3]:
            msg = c['commit']['message'].split('\n')[0]
            lines.append(f"- {msg}")
    
    return '\n'.join(lines)


def main():
    """Main entry point."""
    try:
        input_data = json.load(sys.stdin)
        
        action = input_data.get('action')
        repo = input_data.get('repo') or input_data.get('repository')
        
        if not action:
            print(json.dumps({'success': False, 'output': 'Missing action parameter'}))
            return
        
        # Try to detect repo from cwd if not provided
        if not repo:
            try:
                import subprocess
                remote = subprocess.check_output(['git', 'remote', 'get-url', 'origin'], 
                                                stderr=subprocess.DEVNULL).decode().strip()
                owner, repo_name = parse_repo(remote)
                if owner and repo_name:
                    repo = f"{owner}/{repo_name}"
            except:
                pass
        
        if not repo:
            print(json.dumps({
                'success': False, 
                'output': 'Missing repo parameter and could not detect from git remote'
            }))
            return
        
        owner, repo_name = parse_repo(repo)
        if not owner or not repo_name:
            print(json.dumps({'success': False, 'output': f'Invalid repo format: {repo}'}))
            return
        
        # Execute action
        if action == 'create_issue':
            result = create_issue(
                owner, repo_name,
                input_data.get('title'),
                input_data.get('body'),
                input_data.get('labels'),
                input_data.get('assignees')
            )
            if result['success']:
                issue = result['data']
                output = f"✅ Issue created: #{issue['number']} - {issue['title']}\nURL: {issue['html_url']}"
            else:
                output = f"❌ Failed: {result.get('error')}"
        
        elif action == 'list_issues':
            result = list_issues(owner, repo_name, input_data.get('state', 'open'))
            if result['success']:
                issues = result['data']
                lines = [f"📋 Open Issues ({len(issues)}):\n"]
                for i in issues[:10]:
                    lines.append(f"  #{i['number']}: {i['title']} ({i['state']})")
                output = '\n'.join(lines)
            else:
                output = f"❌ Failed: {result.get('error')}"
        
        elif action == 'get_pr':
            pr_num = input_data.get('pr_number') or input_data.get('number')
            if not pr_num:
                output = "❌ Missing pr_number"
            else:
                result = get_pr(owner, repo_name, int(pr_num))
                if result['success']:
                    pr = result['data']
                    output = f"📥 PR #{pr['number']}: {pr['title']}\n"
                    output += f"Author: @{pr['user']['login']}\n"
                    output += f"State: {pr['state']}\n"
                    output += f"Branch: {pr['head']['ref']} → {pr['base']['ref']}\n"
                    output += f"URL: {pr['html_url']}\n\n"
                    output += f"Body:\n{pr['body'][:500] if pr['body'] else 'No description'}"
                else:
                    output = f"❌ Failed: {result.get('error')}"
        
        elif action == 'list_prs':
            result = list_prs(owner, repo_name)
            if result['success']:
                prs = result['data']
                lines = [f"🔀 Open PRs ({len(prs)}):\n"]
                for p in prs[:10]:
                    lines.append(f"  #{p['number']}: {p['title']} by @{p['user']['login']}")
                output = '\n'.join(lines)
            else:
                output = f"❌ Failed: {result.get('error')}"
        
        elif action == 'get_commits':
            result = get_commits(owner, repo_name, input_data.get('branch', 'main'))
            if result['success']:
                commits = result['data']
                lines = [f"📝 Recent Commits:\n"]
                for c in commits[:5]:
                    msg = c['commit']['message'].split('\n')[0]
                    author = c['commit']['author']['name']
                    lines.append(f"  - {msg[:60]} ({author})")
                output = '\n'.join(lines)
            else:
                output = f"❌ Failed: {result.get('error')}"
        
        elif action == 'create_release':
            # Generate changelog first
            changelog = generate_changelog(owner, repo_name)
            
            tag = input_data.get('tag') or input_data.get('version')
            if not tag:
                output = "❌ Missing tag/version"
            else:
                result = create_release(
                    owner, repo_name,
                    tag,
                    input_data.get('name'),
                    input_data.get('body') or changelog,
                    input_data.get('draft', True)
                )
                if result['success']:
                    rel = result['data']
                    output = f"🚀 Release created: {rel['tag_name']}\n"
                    output += f"Name: {rel['name']}\n"
                    output += f"Draft: {rel['draft']}\n"
                    output += f"URL: {rel['html_url']}\n\n"
                    output += f"Changelog:\n{changelog}"
                else:
                    output = f"❌ Failed: {result.get('error')}"
        
        elif action == 'generate_changelog':
            changelog = generate_changelog(owner, repo_name, input_data.get('since_tag'))
            output = f"📝 Generated Changelog:\n\n{changelog}"
        
        else:
            output = f"❌ Unknown action: {action}"
        
        print(json.dumps({
            'success': '❌' not in output,
            'output': output
        }))
        
    except Exception as e:
        print(json.dumps({
            'success': False,
            'output': f'Error: {str(e)}'
        }))


if __name__ == '__main__':
    main()
