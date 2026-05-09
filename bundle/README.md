# nichedigger

`nichedigger` 是关键词挖掘专用 Bundle，用于把以下能力串成一个可执行流水线：

- `seo-strategy`
- `keyword-research`
- `competitor-analysis`
- `content-gap-analysis`
- `serp-analysis`
- `keyword-value-reviewer-v2`

## 一键入口

- 脚本：`Bundles/nichedigger/cil/run-nichedigger.ps1`

## 用法

```powershell
& "Bundles/nichedigger/cil/run-nichedigger.ps1" `
  -Brand "arousen" `
  -Website "https://arousen.com"
```

可选参数（关键）：

- `-SyncToFeishu $true/$false` 是否回写飞书（默认开启）
- `-SkipDataForSEO` 临时跳过 DataForSEO
- `-LocationCode` 主地区（默认 `2840`）
- `-FallbackLocationCodes` KD缺失时的兜底地区（默认 `0`）

## 输出

默认输出目录：

- `workspace/keyword-mining/<brand>/`

关键结果文件：

- `competitors-auto.txt` 自动发现的竞品候选
- `keywords-candidates.csv` 候选关键词池
- `keywords-top200.csv` Top200 关键词（最终）
- `run-summary.json` 运行摘要

飞书追踪表（自动创建/复用）：

- 表名：`nichedigger-<brand>`
- 追踪字段：`status/content_status/publish_status/data_status/score/strategy_line` 等
- 用于持续跟踪“词是否已做、做在哪、当前数据状态”

## 评分逻辑说明（策略感知）

- 脚本先从品牌策略文档自动抽取竞品候选，再扩词与打分。
- 不同策略线使用不同权重，避免与策略目标冲突：
  - `intercept_competitor`：不使用品牌贴合度惩罚
  - `brand_defense`：品牌相关权重更高
  - `education` / `category_capture`：平衡意图、难度、差距
- 若配置了 `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD`，会调用 `keyword-value-reviewer` 增强打分。
- KD覆盖不足时，`keyword-value-reviewer` 会尝试 `FallbackLocationCodes`，并用 `competition_index` 作为 KD 代理兜底。
