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

interface Env {
	MYBROWSER: Fetcher;
}

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const body = await request.text();
		const jsonBody = body ? JSON.parse(body) : {};
		const html = jsonBody.html;
		const options: PDFOptions = {
			format: jsonBody.format || 'A4',
			printBackground: jsonBody.printBackground !== undefined ? jsonBody.printBackground : true,
		};

		const browser = await puppeteer.launch(env.MYBROWSER);
		const pdf = await generatePDF(browser, html, options);
		browser.close();

		return new Response(pdf, {
			headers: {
				'Content-Type': 'application/pdf',
			},
		});
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
