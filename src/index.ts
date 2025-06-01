import puppeteer, { Browser, PDFOptions } from "@cloudflare/puppeteer";
import { z, ZodError } from "zod";

interface Env {
  MYBROWSER: Fetcher;
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
      if (error instanceof ZodError) {
        return new Response(JSON.stringify({ error: "Invalid input", details: error.errors }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
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
  const pdfBuffer = await page.pdf(options);
  await page.close();

  return pdfBuffer;
}
