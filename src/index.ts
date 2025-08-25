import puppeteer, { Browser, PDFOptions } from "@cloudflare/puppeteer";
import { z, ZodError } from "zod";

interface Env {
  MYBROWSER: Fetcher;
  API_KEY: string;
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

export default {
  async fetch(request, env, ctx): Promise<Response> {
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
        status: 405,
        headers: {
          "Content-Type": "application/json",
          Allow: "POST",
        },
      });
    }

    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized: Bearer token required" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const token = authHeader.split("Bearer ")[1];
    if (token !== process.env.API_KEY) {
      return new Response(JSON.stringify({ error: "Unauthorized: Invalid token" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const body = await request.text();
      const { html, pdfOptions } = requestSchema.parse(JSON.parse(body));

      const browser = await puppeteer.launch(env.MYBROWSER);
      const pdf = await generatePDF(browser, html, pdfOptions);
      browser.close();

      return new Response(pdf, {
        headers: {
          "Content-Type": "application/pdf",
        },
      });
    } catch (error) {
      if (error instanceof SyntaxError) {
        return new Response(JSON.stringify({ error: "Invalid JSON format" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (error instanceof ZodError) {
        return new Response(JSON.stringify({ error: "Invalid input", details: error.errors }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      console.error(error);
      return new Response(JSON.stringify({ error: "Internal Server Error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  },
} satisfies ExportedHandler<Env>;

async function generatePDF(browser: Browser, html: string, options?: PDFOptions): Promise<Buffer> {
  const { format = "A4", printBackground = true } = options || {};

  const page = await browser.newPage();
  await page.setContent(html);
  const pdfBuffer = await page.pdf({
    format,
    printBackground,
  });
  await page.close();

  return pdfBuffer;
}
