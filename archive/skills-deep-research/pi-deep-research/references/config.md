# Research Configuration

## Depth Levels

### Quick
```yaml
depth: quick
max_searches: 3
max_sources: 5
confidence_threshold: 60
time_budget: "2 minutes"
strategy: "Direct search → extract → report"
use_cases:
  - Simple factual questions
  - "What is X?" queries
  - Quick verification
```

### Standard (default)
```yaml
depth: standard
max_searches: 6
max_sources: 10
confidence_threshold: 75
time_budget: "5 minutes"
strategy: "Plan → search → reflect → fill gaps → report"
use_cases:
  - Technology comparisons
  - "Should I use X or Y?"
  - Feature investigations
```

### Deep
```yaml
depth: deep
max_searches: 10
max_sources: 15
confidence_threshold: 85
time_budget: "10 minutes"
strategy: "Decompose → parallel search → cross-reference → iterate → comprehensive report"
use_cases:
  - Architecture decisions
  - Competitive analysis
  - Technology evaluations
```

### Exhaustive
```yaml
depth: exhaustive
max_searches: 20
max_sources: 30
confidence_threshold: 95
time_budget: "20 minutes"
strategy: "Full decomposition → systematic search → multi-hop reasoning → verify all claims → detailed report with appendices"
use_cases:
  - Academic literature reviews
  - Comprehensive market research
  - Security audits
  - Due diligence reports
```

## Source Credibility Tiers

```yaml
tier_1_authoritative:
  weight: 1.0
  examples:
    - Official documentation
    - Peer-reviewed papers (arXiv, ACM, IEEE)
    - Official announcements / press releases
    - Government / regulatory sources

tier_2_reliable:
  weight: 0.8
  examples:
    - Established tech blogs (InfoQ, The Verge, Ars Technica)
    - Developer blogs from known engineers
    - Conference talks / proceedings
    - Well-maintained GitHub repos (>1k stars)

tier_3_community:
  weight: 0.5
  examples:
    - Stack Overflow answers (high vote count)
    - Reddit discussions (verified claims only)
    - Medium / Dev.to articles
    - Forum posts

tier_4_unverified:
  weight: 0.2
  examples:
    - Anonymous blog posts
    - Social media posts (unverified accounts)
    - SEO-optimized content farms
    - Undated or unsigned content
```

## Confidence Scoring

For each sub-question, track confidence:

```
confidence = (source_count_weight × 0.3) + (source_quality_weight × 0.4) + (consistency_weight × 0.3)

source_count_weight:
  1 source  → 0.3
  2 sources → 0.6
  3+ sources → 1.0

source_quality_weight:
  tier_1 only → 1.0
  tier_1 + tier_2 → 0.85
  tier_2 only → 0.7
  tier_3+ only → 0.4

consistency_weight:
  all sources agree → 1.0
  minor differences → 0.7
  contradictions → 0.3
```
