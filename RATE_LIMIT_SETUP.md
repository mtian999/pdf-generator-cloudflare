# 速率限制设置指南

## 已实现的功能

✅ 基于 IP 地址的速率限制
✅ 可配置的请求频率限制（默认：1 分钟内最多 10 个请求）
✅ 标准的 HTTP 429 响应和 Retry-After 头
✅ 速率限制信息在响应头中返回

## 设置步骤

### 1. 创建 KV Namespace

在终端运行以下命令创建 KV namespace：

```bash
# 生产环境
npx wrangler kv namespace create "RATE_LIMIT_KV"

# 开发环境（可选）
npx wrangler kv namespace create "RATE_LIMIT_KV" --preview
```

命令会返回类似这样的输出：

```
🌀 Creating namespace with title "pdf-generator-cloudflare-RATE_LIMIT_KV"
✨ Success!
Add the following to your configuration file in your kv_namespaces array:
{ binding = "RATE_LIMIT_KV", id = "abc123def456..." }
```

### 2. 更新 wrangler.jsonc

将返回的 `id` 复制到 `wrangler.jsonc` 文件中：

```jsonc
"kv_namespaces": [
  {
    "binding": "RATE_LIMIT_KV",
    "id": "你的实际KV_ID" // 替换这里
  }
]
```

### 3. 调整速率限制配置

在 `src/index.ts` 中修改 `RATE_LIMIT_CONFIG`：

```typescript
const RATE_LIMIT_CONFIG = {
  maxRequests: 10, // 修改为你需要的最大请求数
  windowMs: 60000, // 修改时间窗口（毫秒）
};
```

常用配置示例：

- **严格限制**: `maxRequests: 5, windowMs: 60000` (1 分钟 5 次)
- **中等限制**: `maxRequests: 20, windowMs: 60000` (1 分钟 20 次)
- **宽松限制**: `maxRequests: 100, windowMs: 60000` (1 分钟 100 次)
- **按小时限制**: `maxRequests: 1000, windowMs: 3600000` (1 小时 1000 次)

### 4. 部署

```bash
npx wrangler deploy
```

## 响应头说明

成功的请求会包含以下响应头：

```
X-RateLimit-Limit: 10           # 时间窗口内允许的最大请求数
X-RateLimit-Remaining: 7        # 剩余可用请求数
X-RateLimit-Reset: 2025-11-05T10:30:00.000Z  # 限制重置时间
```

被限制的请求会返回 429 状态码：

```json
{
  "error": "Too Many Requests",
  "message": "Rate limit exceeded. Try again in 45 seconds.",
  "retryAfter": 45
}
```

## 进阶选项

### 基于 Token 而非 IP 限制

如果你想基于 API token 而不是 IP 地址限制，修改这一行：

```typescript
// 当前（基于 IP）
const clientIP = request.headers.get("CF-Connecting-IP") || "unknown";
const rateLimitResult = await checkRateLimit(env, clientIP);

// 改为（基于 Token）
const rateLimitResult = await checkRateLimit(env, token);
```

### 不同用户不同限制

可以为不同的 token 设置不同的限制：

```typescript
const RATE_LIMITS = {
  "premium-token": { maxRequests: 100, windowMs: 60000 },
  default: { maxRequests: 10, windowMs: 60000 },
};

const config = RATE_LIMITS[token] || RATE_LIMITS["default"];
```

## 监控和调试

查看 KV 中的速率限制数据：

```bash
# 列出所有 keys
npx wrangler kv key list --namespace-id=YOUR_KV_ID

# 查看特定 IP 的限制状态
npx wrangler kv key get "ratelimit:1.2.3.4" --namespace-id=YOUR_KV_ID
```

## 成本说明

Cloudflare Workers KV 定价：

- 免费套餐：每天 100,000 次读取，1,000 次写入
- 超出后：$0.50 / 百万次读取，$5.00 / 百万次写入

每个请求会产生 1-2 次 KV 操作（读+写），对于大多数应用来说免费额度足够使用。
