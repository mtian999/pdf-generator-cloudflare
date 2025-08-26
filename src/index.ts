import puppeteer, { Browser, PDFOptions } from "@cloudflare/puppeteer";
import { z, ZodError } from "zod";

interface Env {
  MYBROWSER: Fetcher;
  API_KEY: string;
  TAILWIND_CDN: string;
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

export default {
  async fetch(request, env, ctx): Promise<Response> {
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

    try {
      const body = await request.text();
      const { html, pdfOptions } = requestSchema.parse(JSON.parse(body));

      const browser = await puppeteer.launch(env.MYBROWSER);
      const pdf = await generatePDF(env, browser, html, pdfOptions);
      browser.close();

      const response = new Response(pdf, {
        headers: {
          "Content-Type": "application/pdf",
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
  await page.close();

  return pdfBuffer;
}
