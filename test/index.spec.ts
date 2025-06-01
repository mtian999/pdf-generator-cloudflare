import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, vi, beforeEach } from "vitest";
import worker from "../src/index";
import puppeteer from "@cloudflare/puppeteer";

// Setup mock
vi.mock("@cloudflare/puppeteer", () => {
  // Mock PDF content using Uint8Array
  const encoder = new TextEncoder();
  const pdfContent = encoder.encode("mocked pdf content");

  const mockPage = {
    setContent: vi.fn().mockResolvedValue(undefined),
    pdf: vi.fn().mockResolvedValue(pdfContent),
    close: vi.fn().mockResolvedValue(undefined),
  };

  const mockBrowser = {
    newPage: vi.fn().mockResolvedValue(mockPage),
    close: vi.fn().mockResolvedValue(undefined),
  };

  return {
    default: {
      launch: vi.fn().mockResolvedValue(mockBrowser),
    },
  };
});

// For now, you'll need to do something like this to get a correctly-typed
// `Request` to pass to `worker.fetch()`.
const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

// API key config
const API_KEY = "test-api-key";

describe("PDF Generator API", () => {
  beforeEach(() => {
    // Set environment variables
    env.API_KEY = API_KEY;
    env.MYBROWSER = {} as any; // Mock for Fetcher type

    // Reset mocks
    vi.clearAllMocks();
  });

  it("should generate and return a PDF for valid request", async () => {
    const requestBody = {
      html: "<h1>Test HTML</h1>",
      pdfOptions: {
        format: "A4",
        printBackground: true,
      },
    };

    const request = new IncomingRequest("http://example.com", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(requestBody),
    });

    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    // Check response status and headers
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");

    // Verify mocks were called correctly
    expect(puppeteer.launch).toHaveBeenCalledWith(env.MYBROWSER);
    const puppeteerInstance = await puppeteer.launch(env.MYBROWSER);
    const page = await puppeteerInstance.newPage();

    expect(page.setContent).toHaveBeenCalledWith("<h1>Test HTML</h1>");
    expect(page.pdf).toHaveBeenCalledWith({
      format: "A4",
      printBackground: true,
    });
    expect(page.close).toHaveBeenCalled();
    expect(puppeteerInstance.close).toHaveBeenCalled();

    // Verify response body
    const responseBuffer = await response.arrayBuffer();
    const decoder = new TextDecoder();
    expect(decoder.decode(responseBuffer)).toBe("mocked pdf content");
  });

  it("should return 405 Method Not Allowed for GET requests", async () => {
    const request = new IncomingRequest("http://example.com", {
      method: "GET",
    });

    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(405);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(response.headers.get("Allow")).toBe("POST");

    const responseJson = await response.json();
    expect(responseJson).toEqual({ error: "Method Not Allowed" });
  });

  it("should return 401 Unauthorized when no auth token is provided", async () => {
    const requestBody = {
      html: "<h1>Test HTML</h1>",
    };

    const request = new IncomingRequest("http://example.com", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(401);
    expect(response.headers.get("Content-Type")).toBe("application/json");

    const responseJson = await response.json();
    expect(responseJson).toEqual({ error: "Unauthorized: Bearer token required" });
  });

  it("should return 401 Unauthorized when invalid token is provided", async () => {
    const requestBody = {
      html: "<h1>Test HTML</h1>",
    };

    const request = new IncomingRequest("http://example.com", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer wrong-api-key",
      },
      body: JSON.stringify(requestBody),
    });

    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(401);
    expect(response.headers.get("Content-Type")).toBe("application/json");

    const responseJson = await response.json();
    expect(responseJson).toEqual({ error: "Unauthorized: Invalid token" });
  });
});
