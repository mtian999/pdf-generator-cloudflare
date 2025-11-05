import puppeteer, { Browser, PDFOptions } from "@cloudflare/puppeteer";
import { z, ZodError } from "zod";

interface Env {
  MYBROWSER: Fetcher;
  API_KEY: string;
  TAILWIND_CDN: string;
  RATE_LIMIT_KV: KVNamespace; // 用于存储速率限制数据
}

interface ExecutionContext {
  waitUntil(promise: Promise<any>): void;
  passThroughOnException(): void;
}

const requestSchema = z.object({
  html: z.string(),
  pdfOptions: z
    .object({
      format: z.enum(["A4", "A3", "Letter", "Legal"]).optional(),
      printBackground: z.boolean().optional(),
    })
    .optional(),
});

// 允许的源列表，根据你的实际需求修改
const allowedOrigins = ["http://localhost:3000", "https://www.getinvoify.com"];

// 处理 OPTIONS 预检请求
function handleOptions(request: Request, allowedOrigin: string): Response {
  const headers = {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400", // 缓存预检结果 24 小时
    "Access-Control-Allow-Credentials": "true",
  };
  return new Response(null, { headers });
}

// 为响应添加 CORS 头
function addCorsHeaders(response: Response, allowedOrigin: string): Response {
  response.headers.set("Access-Control-Allow-Origin", allowedOrigin);
  response.headers.set("Access-Control-Allow-Credentials", "true");
  response.headers.set("Access-Control-Expose-Headers", "*");
  return response;
}

// 速率限制配置
const RATE_LIMIT_CONFIG = {
  maxRequests: 20, // 时间窗口内最大请求数
  windowMs: 60000, // 时间窗口（毫秒），60000 = 1分钟
};

// 内存缓存，减少 KV 写入次数（注意：Workers 可能随时重启，此缓存不保证持久）
const rateLimitCache = new Map<string, { count: number; resetTime: number; lastSync: number }>();
let lastCleanupTime = 0;

// Browser 连接池（尽力而为，Worker 重启时会丢失）
let cachedBrowser: Browser | null = null;
let browserLastUsed = 0;
const BROWSER_IDLE_TIMEOUT = 60000; // 60 秒无使用后关闭

// 惰性清理过期的缓存条目（在每次请求时检查，而不是用 setInterval）
function cleanupExpiredCacheIfNeeded() {
  const now = Date.now();
  const CLEANUP_INTERVAL = 300000; // 5 分钟

  // 只在距离上次清理超过 5 分钟时才执行
  if (now - lastCleanupTime < CLEANUP_INTERVAL) {
    return;
  }

  lastCleanupTime = now;
  for (const [key, value] of rateLimitCache.entries()) {
    if (now > value.resetTime + 60000) {
      // 过期 1 分钟后删除
      rateLimitCache.delete(key);
    }
  }
}

// 获取或创建 Browser 实例（尽力而为的连接池，完全依赖主动检查）
async function getBrowser(env: Env): Promise<Browser> {
  const now = Date.now();

  // 主动检查并清理过期的 browser（每次请求时检查）
  if (cachedBrowser && now - browserLastUsed >= BROWSER_IDLE_TIMEOUT) {
    console.log("Browser idle timeout reached, closing...");
    try {
      await cachedBrowser.close();
    } catch (err) {
      console.warn("Failed to close idle browser:", err);
    }
    cachedBrowser = null;
  }

  // 检查是否有缓存的 browser 且未超时
  if (cachedBrowser) {
    try {
      // 验证 browser 是否仍然可用
      await cachedBrowser.version();
      browserLastUsed = now;
      return cachedBrowser;
    } catch (err) {
      // Browser 已失效（可能是远程会话超时），清理引用
      console.warn("Cached browser is no longer valid, creating new one:", err);
      cachedBrowser = null;
    }
  }

  // 创建新的 browser 实例
  console.log("Creating new browser instance");
  cachedBrowser = await puppeteer.launch(env.MYBROWSER);
  browserLastUsed = now;
  return cachedBrowser;
}

// 检查速率限制（优化版：减少 KV 写入 + 容错处理）
async function checkRateLimit(
  env: Env,
  ctx: ExecutionContext,
  identifier: string
): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
  const key = `ratelimit:${identifier}`;
  const now = Date.now();
  const SYNC_INTERVAL = 30000; // 每 30 秒同步一次到 KV，大幅减少写入次数

  // 先检查内存缓存
  let cached = rateLimitCache.get(key);

  // 只有在缓存不存在时才从 KV 读取，如果缓存存在但已过期，则重置计数
  if (!cached) {
    try {
      const data = (await env.RATE_LIMIT_KV.get(key, "json")) as { count: number; resetTime: number } | null;

      if (data && now <= data.resetTime) {
        // KV 中有有效数据，使用它
        cached = { ...data, lastSync: now };
        rateLimitCache.set(key, cached);
      } else {
        // KV 中没有数据或已过期，创建新的时间窗口
        const resetTime = now + RATE_LIMIT_CONFIG.windowMs;
        cached = { count: 0, resetTime, lastSync: now };
        rateLimitCache.set(key, cached);
      }
    } catch (kvError) {
      // KV 读取失败（可能超出额度），使用纯内存模式降级
      console.error("KV read error (quota exceeded?), falling back to memory-only mode:", kvError);
      const resetTime = now + RATE_LIMIT_CONFIG.windowMs;
      cached = { count: 0, resetTime, lastSync: now };
      rateLimitCache.set(key, cached);
    }
  } else if (now > cached.resetTime) {
    // 缓存存在但时间窗口已过期，重置计数
    cached.count = 0;
    cached.resetTime = now + RATE_LIMIT_CONFIG.windowMs;
    cached.lastSync = now;
  }

  // 增加计数
  cached.count++;

  // 检查是否超过限制
  if (cached.count > RATE_LIMIT_CONFIG.maxRequests) {
    // 超过限制，恢复计数并拒绝请求
    cached.count--;
    return { allowed: false, remaining: 0, resetTime: cached.resetTime };
  }

  const shouldSync = now - cached.lastSync > SYNC_INTERVAL;
  const isNearLimit = cached.count >= RATE_LIMIT_CONFIG.maxRequests * 0.8; // 达到80%阈值
  const isFirstRequest = cached.count === 1;

  // 在以下情况同步到 KV：
  // 1. 第一个请求（确保 KV 中有数据）
  // 2. 达到同步间隔（正常流量）
  // 3. 接近限制阈值（防止机器人在30秒内绕过限制）
  if (isFirstRequest || shouldSync || isNearLimit) {
    cached.lastSync = now;
    const kvWritePromise = env.RATE_LIMIT_KV.put(
      key,
      JSON.stringify({ count: cached.count, resetTime: cached.resetTime }),
      {
        expirationTtl: Math.ceil((cached.resetTime - now) / 1000) + 60, // 多加60秒防止提前过期
      }
    ).catch((err) => console.error("KV write error (quota exceeded?):", err));

    // 对于第一个请求和接近限制的情况，等待 KV 写入完成以确保数据一致性
    if (isFirstRequest || isNearLimit) {
      await kvWritePromise;
    } else {
      // 正常同步间隔，使用 waitUntil 确保异步写入完成
      ctx.waitUntil(kvWritePromise);
    }
  }

  return {
    allowed: true,
    remaining: RATE_LIMIT_CONFIG.maxRequests - cached.count,
    resetTime: cached.resetTime,
  };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // 获取请求源并检查是否在允许列表中
    const origin = request.headers.get("Origin");
    const allowedOrigin = origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0];

    // 处理预检请求
    if (request.method === "OPTIONS") {
      return handleOptions(request, allowedOrigin);
    }

    if (request.method !== "POST") {
      const response = new Response(JSON.stringify({ error: "Method Not Allowed" }), {
        status: 405,
        headers: {
          "Content-Type": "application/json",
          Allow: "POST",
        },
      });
      return addCorsHeaders(response, allowedOrigin);
    }

    const authHeader = request.headers.get("Authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      const response = new Response(JSON.stringify({ error: "Unauthorized: Bearer token required" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
      return addCorsHeaders(response, allowedOrigin);
    }

    const token = authHeader.split("Bearer ")[1];
    if (token !== env.API_KEY) {
      const response = new Response(JSON.stringify({ error: "Unauthorized: Invalid token" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
      return addCorsHeaders(response, allowedOrigin);
    }

    // 惰性清理过期缓存（每 5 分钟执行一次）
    cleanupExpiredCacheIfNeeded();

    // 速率限制检查（基于 IP 地址）
    const clientIP = request.headers.get("CF-Connecting-IP") || "unknown";
    const rateLimitResult = await checkRateLimit(env, ctx, clientIP);

    if (!rateLimitResult.allowed) {
      const retryAfter = Math.max(1, Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000));
      const response = new Response(
        JSON.stringify({
          error: "Too Many Requests",
          message: `Rate limit exceeded. Try again in ${retryAfter} seconds.`,
          retryAfter,
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": retryAfter.toString(),
            "X-RateLimit-Limit": RATE_LIMIT_CONFIG.maxRequests.toString(),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": new Date(rateLimitResult.resetTime).toISOString(),
          },
        }
      );
      return addCorsHeaders(response, allowedOrigin);
    }

    try {
      const body = await request.text();
      const { html, pdfOptions } = requestSchema.parse(JSON.parse(body));

      const browser = await getBrowser(env);
      const pdf = await generatePDF(env, browser, html, pdfOptions);

      const response = new Response(pdf, {
        headers: {
          "Content-Type": "application/pdf",
          "X-RateLimit-Limit": RATE_LIMIT_CONFIG.maxRequests.toString(),
          "X-RateLimit-Remaining": rateLimitResult.remaining.toString(),
          "X-RateLimit-Reset": new Date(rateLimitResult.resetTime).toISOString(),
        },
      });
      return addCorsHeaders(response, allowedOrigin);
    } catch (error) {
      if (error instanceof SyntaxError) {
        const response = new Response(JSON.stringify({ error: "Invalid JSON format" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
        return addCorsHeaders(response, allowedOrigin);
      }
      if (error instanceof ZodError) {
        const response = new Response(JSON.stringify({ error: "Invalid input", details: error.errors }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
        return addCorsHeaders(response, allowedOrigin);
      }

      console.error(error);
      const response = new Response(JSON.stringify({ error: "Internal Server Error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
      return addCorsHeaders(response, allowedOrigin);
    }
  },
} satisfies ExportedHandler<Env>;

async function generatePDF(env: Env, browser: Browser, html: string, options?: PDFOptions): Promise<Buffer> {
  const { format = "A4", printBackground = true } = options || {};

  const page = await browser.newPage();

  try {
    // 设置页面内容
    await page.setContent(html, {
      waitUntil: ["networkidle0", "load", "domcontentloaded"],
      timeout: 30000,
    });

    // 添加 Tailwind CSS
    try {
      await page.addStyleTag({
        url: env.TAILWIND_CDN,
      });
    } catch (styleError) {
      console.warn("Failed to load Tailwind CSS:", styleError);
      // 继续执行，不阻止 PDF 生成
    }

    const pdfBuffer = await page.pdf({
      format,
      printBackground,
    });

    return pdfBuffer;
  } finally {
    // 确保 page 总是被关闭
    await page.close();
  }
}
