/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import puppeteer, { Browser, PDFOptions } from '@cloudflare/puppeteer';
import { z, ZodError } from 'zod';

interface Env {
	MYBROWSER: Fetcher;
}

const requestSchema = z.object({
	html: z.string(),
	pdfOptions: z
		.object({
			format: z.enum(['A4', 'A3', 'Letter', 'Legal']).optional(),
			printBackground: z.boolean().optional(),
		})
		.optional(),
});

export default {
	async fetch(request, env, ctx): Promise<Response> {
		try {
			const body = await request.text();
			const { html, pdfOptions } = requestSchema.parse(JSON.parse(body));

			const browser = await puppeteer.launch(env.MYBROWSER);
			const pdf = await generatePDF(browser, html, pdfOptions);
			browser.close();

			return new Response(pdf, {
				headers: {
					'Content-Type': 'application/pdf',
				},
			});
		} catch (error) {
			if (error instanceof ZodError) {
				return new Response(JSON.stringify({ error: 'Invalid input', details: error.errors }), {
					status: 400,
					headers: { 'Content-Type': 'application/json' },
				});
			}
			return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
				status: 500,
				headers: { 'Content-Type': 'application/json' },
			});
		}
	},
} satisfies ExportedHandler<Env>;

async function generatePDF(browser: Browser, html: string, options?: PDFOptions): Promise<Buffer> {
	const { format = 'A4', printBackground = true } = options || {};

	const page = await browser.newPage();
	await page.setContent(html);
	const pdfBuffer = await page.pdf(options);
	await page.close();

	return pdfBuffer;
}
