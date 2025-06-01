# PDF Generator for Cloudflare Workers

A Cloudflare Workers service to generate PDFs from HTML ✨

This project provides an API that generates PDF files from HTML content using Cloudflare Workers and Puppeteer. The API is protected with Bearer authentication.

## Features 🌟

- Serverless PDF generation service running on Cloudflare Workers
- High-quality HTML-to-PDF conversion using Puppeteer
- Authentication with API keys
- Customizable PDF output options (page size, background printing, etc.)
- Fully TypeScript supported

## Requirements 📋

- Node.js (latest stable version)
- Cloudflare account
- Cloudflare Workers (plan that supports PDF generation features)

## Installation ⚙️

Install dependencies:

```bash
npm install
```

## Development 💻

Start the local development server:

```bash
npm run dev
```

## Deployment 🚀

Set up secrets (first time only):

```bash
npx wrangler secret put API_KEY
```

Deploy to Cloudflare Workers:

```bash
npm run deploy
```

## Usage 🔍

### Example Request

```bash
curl -X POST https://your-worker-url.workers.dev \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "html": "<h1>Hello World</h1><p>This is a test PDF</p>",
    "pdfOptions": {
      "format": "A4",
      "printBackground": true
    }
  }' \
  --output output.pdf
```

### Request Format

```typescript
{
  "html": string,       // HTML content to be converted to PDF
  "pdfOptions": {       // Options (optional)
    "format": "A4" | "A3" | "Letter" | "Legal",  // Page size
    "printBackground": boolean  // Whether to print background
  }
}
```

### Response

On success, a PDF file is returned with the `application/pdf` content type.

On error, a JSON response is returned:

```json
{
  "error": "Error message",
  "details": "Additional details (if available)"
}
```

## Testing 🧪

### Run tests

```bash
npm run test
```

## License 📄

MIT License

---

Created: June 1, 2025
