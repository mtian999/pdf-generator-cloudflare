# Browser API Rate Limit Fix

## Problem

You were hitting the **Cloudflare Browser Rendering API rate limit** (429 error), which is different from your application's rate limiting. The Browser API has its own limits on how many browser instances you can launch.

## Root Causes

1. **No tracking of Browser API rate limits** - When the Browser API returned 429, the code would keep trying
2. **No backoff mechanism** - Failed requests would immediately retry
3. **Cache cleanup issues** - `setInterval` doesn't work reliably in Workers
4. **Unbounded cache growth** - No maximum size limit on the rate limit cache

## Fixes Applied

### 1. Browser API Rate Limit Tracking

Added a global tracker that blocks all browser launch attempts when the API is rate limited:

```typescript
let browserApiRateLimitUntil = 0; // Tracks when Browser API will be available again
```

When a 429 error is detected from the Browser API:

- Sets `browserApiRateLimitUntil` to 60 seconds in the future
- All subsequent requests fail fast with proper retry-after information
- No wasted attempts to launch browsers during the cooldown period

### 2. Improved Error Detection

Enhanced the error checking to catch rate limit errors more reliably:

```typescript
if (errorMessage.includes("429") || errorMessage.toLowerCase().includes("rate limit")) {
  browserApiRateLimitUntil = Date.now() + 60000;
  // Return proper 429 response with accurate retry-after
}
```

### 3. Better Cache Management

Fixed the cache cleanup to work properly in Workers:

- **Lazy cleanup**: Runs every 5 minutes when requests come in (not with setInterval)
- **Size limit**: Maximum 1000 entries to prevent unbounded growth
- **LRU eviction**: When cache is full, removes oldest entries first

### 4. Accurate Retry-After Headers

Now calculates the actual remaining time until the Browser API is available:

```typescript
const retryAfter = Math.max(1, Math.ceil((browserApiRateLimitUntil - Date.now()) / 1000));
```

## How It Works Now

1. **First 429 from Browser API**:

   - Sets 60-second cooldown
   - Returns 429 to client with `Retry-After: 60`

2. **Subsequent requests during cooldown**:

   - Fail immediately (no wasted API calls)
   - Return accurate remaining time in `Retry-After` header

3. **After cooldown expires**:
   - Normal operation resumes
   - Browser launches are attempted again

## Testing

To test the fix:

```bash
# Deploy the updated code
npx wrangler deploy

# Make requests until you hit the limit
# You should see proper 429 responses with accurate retry-after times
```

## Monitoring

Watch for these log messages:

- `"Browser API rate limit hit, blocking requests for 60 seconds"` - API limit reached
- `"Rate limit cache exceeded 1000 entries..."` - Cache cleanup triggered

## Browser API Limits

Cloudflare Browser Rendering API limits vary by plan:

- **Free**: Very limited (exact limits not publicly documented)
- **Paid**: Higher limits based on your plan
- **Workers Paid**: 2 million requests/month included

Consider:

- Upgrading your Cloudflare plan if you need higher limits
- Implementing request queuing on the client side
- Caching PDF results if the same content is requested frequently

## Next Steps

If you continue to hit rate limits frequently:

1. **Add PDF caching**: Cache generated PDFs in R2 or KV
2. **Queue system**: Implement a job queue for PDF generation
3. **Upgrade plan**: Consider Cloudflare Workers Paid or higher tiers
4. **Reduce browser launches**: Reuse pages instead of creating new browsers
