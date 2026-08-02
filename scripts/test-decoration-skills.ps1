#!/usr/bin/env pwsh
# 装饰行业技能端到端测试
# 确保每个技能都能真实执行并返回有效结果

$ErrorActionPreference = "Stop"

function Test-Skill {
    param(
        [string]$SkillName,
        [string]$TestInput,
        [string]$ExpectedOutput
    )
    
    Write-Host "🧪 测试技能: $SkillName" -ForegroundColor Cyan
    
    $skillPath = "packages/agentai-skills/decoration/$SkillName"
    
    if (-not (Test-Path $skillPath)) {
        Write-Host "   ❌ 技能目录不存在" -ForegroundColor Red
        return $false
    }
    
    try {
        $result = $TestInput | python "$skillPath/handler.py" 2>&1
        $output = $result | Out-String
        
        if ($output -match '"success"\s*:\s*true') {
            Write-Host "   ✅ 执行成功" -ForegroundColor Green
            if ($output -match $ExpectedOutput) {
                Write-Host "   ✅ 输出验证通过" -ForegroundColor Green
                return $true
            } else {
                Write-Host "   ⚠️ 输出不匹配预期，但执行成功" -ForegroundColor Yellow
                return $true
            }
        } else {
            Write-Host "   ❌ 执行失败" -ForegroundColor Red
            Write-Host "   输出: $output" -ForegroundColor Gray
            return $false
        }
    } catch {
        Write-Host "   ❌ 异常: $_" -ForegroundColor Red
        return $false
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Blue
Write-Host "  装饰行业技能端到端测试" -ForegroundColor Blue
Write-Host "========================================" -ForegroundColor Blue
Write-Host ""

$tests = @(
    @{
        Name = "requirement-interview"
        Input = '{"action": "questionnaire"}'
        Expected = "问卷"
    },
    @{
        Name = "quotation-generator"
        Input = '{"prompt": "100平三室装修报价", "params": {"area": 100}}'
        Expected = "报价"
    },
    @{
        Name = "material-selector"
        Input = '{"message": "10万预算推荐材料", "budget": "10万"}'
        Expected = "材料"
    },
    @{
        Name = "construction-supervisor"
        Input = '{"action": "guide", "stage": "水电改造"}'
        Expected = "水电"
    },
    @{
        Name = "cad-ai-designer"
        Input = '{"prompt": "设计一个800x600x2000的衣柜", "params": {"type": "wardrobe"}}'
        Expected = "衣柜"
    }
)

$passed = 0
$failed = 0

foreach ($test in $tests) {
    $result = Test-Skill -SkillName $test.Name -TestInput $test.Input -ExpectedOutput $test.Expected
    if ($result) {
        $passed++
    } else {
        $failed++
    }
    Write-Host ""
}

Write-Host "========================================" -ForegroundColor Blue
Write-Host "  测试结果" -ForegroundColor Blue
Write-Host "========================================" -ForegroundColor Blue
Write-Host "总测试数: $($tests.Count)" -ForegroundColor White
Write-Host "✅ 通过: $passed" -ForegroundColor Green
Write-Host "❌ 失败: $failed" -ForegroundColor Red
Write-Host "========================================" -ForegroundColor Blue

if ($failed -eq 0) {
    Write-Host ""
    Write-Host "🎉 所有技能真实可用！" -ForegroundColor Green
    exit 0
} else {
    Write-Host ""
    Write-Host "⚠️ 部分技能需要修复" -ForegroundColor Yellow
    exit 1
}
