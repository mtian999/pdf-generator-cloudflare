import { Fetcher } from "@cloudflare/puppeteer";

interface Env {
  MYBROWSER: Fetcher;
  API_KEY: string;
}

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}
